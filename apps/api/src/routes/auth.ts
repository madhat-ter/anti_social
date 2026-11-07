import { Elysia, t } from 'elysia';
import { eq, sql } from 'drizzle-orm';
import { passkeys, sessions, users, isUniqueViolation, scalar } from '@anti/db';
import { validateHandle, DISPLAY_NAME_MAX, normalizeInviteCode, isWellFormedInviteCode } from '@anti/shared';
import type { UserState } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError, rethrowDb } from '../lib/errors';
import { authPlugin, clearSessionCookie, setSessionCookie, type CookieJar } from '../plugins/auth';
import { createSession, revokeSession } from '../lib/sessions';
import { saveChallenge, takeChallenge } from '../lib/challenges';
import {
  authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration,
} from '../lib/webauthn';
import {
  generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode, verifyRecoveryCode,
} from '../lib/crypto';
import { checkInvite } from './invites';

const challengeBody = t.Object({ challengeId: t.String(), response: t.Any() });

let dummyHash: Promise<string> | undefined;

export const authRoutes = (deps: Deps) => {
  const { db, cfg } = deps;

  async function startSession(
    cookie: CookieJar, headers: Record<string, string | undefined>, userId: string,
  ): Promise<{ sessionToken?: string }> {
    const mobile = headers['x-client'] === 'mobile';
    const token = await createSession(db, userId, mobile ? 'mobile' : 'web');
    setSessionCookie(cookie, token, cfg.cookieSecure);
    return mobile ? { sessionToken: token } : {};
  }

  return new Elysia({ prefix: '/auth' })
    .use(authPlugin(deps))
    .post(
      '/register/options',
      async ({ body }) => {
        const code = normalizeInviteCode(body.code);
        const handle = body.handle.trim();
        const displayName = body.displayName.trim();
        if (!(await checkInvite(db, code))) throw new ApiError(400, 'invite_invalid', 'Invite code is invalid, used, or expired.');
        const bad = validateHandle(handle);
        if (bad) throw new ApiError(400, 'handle_invalid', bad);
        if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX) {
          throw new ApiError(400, 'display_name_invalid', `Display name must be 1-${DISPLAY_NAME_MAX} characters.`);
        }
        const taken = await scalar<boolean>(db, sql`select exists (select 1 from users where lower(handle) = lower(${handle}))`);
        if (taken) throw new ApiError(409, 'handle_taken', 'That handle is taken.');

        const userId = crypto.randomUUID();
        const options = await registrationOptions(cfg, { id: userId, handle, displayName });
        const challengeId = await saveChallenge(db, {
          challenge: options.challenge, purpose: 'register', data: { code, handle, displayName, userId },
        });
        return { challengeId, options };
      },
      { body: t.Object({ code: t.String({ maxLength: 64 }), handle: t.String({ maxLength: 64 }), displayName: t.String({ maxLength: 200 }) }) },
    )
    .post(
      '/register/verify',
      async ({ body, cookie, headers }) => {
        const ch = await takeChallenge(db, body.challengeId, 'register');
        const data = ch.data as { code: string; handle: string; displayName: string; userId: string };
        const reg = await verifyRegistration(cfg, body.response, ch.challenge);
        const recovery = generateRecoveryCode();
        const recoveryCodeHash = await hashRecoveryCode(recovery.normalized);

        let state: UserState;
        try {
          state = await db.transaction(async (tx) => {
            await tx.insert(users).values({
              id: data.userId, handle: data.handle, displayName: data.displayName,
              state: 'waitlisted', recoveryCodeHash,
            });
            await tx.insert(passkeys).values({
              id: reg.id, userId: data.userId, publicKey: reg.publicKey, counter: reg.counter, transports: reg.transports,
            });
            const s = await scalar<UserState>(tx as never, sql`select redeem_invite(${data.code}, ${data.userId}::uuid)`);
            return s as UserState;
          });
        } catch (e) {
          if (isUniqueViolation(e)) {
            const msg = JSON.stringify((e as { cause?: unknown }).cause ?? '') + String((e as Error).message);
            if (/passkeys/.test(msg)) throw new ApiError(409, 'passkey_exists', 'That passkey is already registered.');
            throw new ApiError(409, 'handle_taken', 'That handle is taken.');
          }
          rethrowDb(e);
        }
        const extra = await startSession(cookie as CookieJar, headers, data.userId);
        return { state, recoveryCode: recovery.display, ...extra };
      },
      { body: challengeBody },
    )
    .post('/login/options', async () => {
      const options = await authenticationOptions(cfg);
      const challengeId = await saveChallenge(db, { challenge: options.challenge, purpose: 'login' });
      return { challengeId, options };
    })
    .post(
      '/login/verify',
      async ({ body, cookie, headers }) => {
        const ch = await takeChallenge(db, body.challengeId, 'login');
        const credId = (body.response as { id?: unknown } | null)?.id;
        if (typeof credId !== 'string') throw new ApiError(401, 'passkey_invalid');
        const [row] = await db
          .select({ passkey: passkeys, user: users })
          .from(passkeys)
          .innerJoin(users, eq(users.id, passkeys.userId))
          .where(eq(passkeys.id, credId))
          .limit(1);
        if (!row) throw new ApiError(401, 'passkey_invalid');
        const info = await verifyAuthentication(cfg, body.response, ch.challenge, row.passkey);
        if (row.user.state === 'banned' || row.user.state === 'deleted') {
          throw new ApiError(403, 'account_unavailable', 'This account is unavailable.');
        }
        await db.update(passkeys).set({ counter: info.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, credId));
        const extra = await startSession(cookie as CookieJar, headers, row.user.id);
        return { state: row.user.state, ...extra };
      },
      { body: challengeBody },
    )
    .post(
      '/recover/options',
      async ({ body }) => {
        const fail = () => new ApiError(401, 'recovery_failed', 'Handle or recovery code is incorrect.');
        const code = normalizeRecoveryCode(body.recoveryCode);
        const [user] = await db.select().from(users).where(sql`lower(${users.handle}) = lower(${body.handle.trim()})`).limit(1);
        if (!user || user.state === 'banned' || user.state === 'deleted') {
          dummyHash ??= hashRecoveryCode('DUMMY');
          await verifyRecoveryCode(code, await dummyHash);
          throw fail();
        }
        if (!(await verifyRecoveryCode(code, user.recoveryCodeHash))) throw fail();
        const options = await registrationOptions(cfg, { id: user.id, handle: user.handle, displayName: user.displayName });
        const challengeId = await saveChallenge(db, { challenge: options.challenge, purpose: 'recover', userId: user.id });
        return { challengeId, options };
      },
      { body: t.Object({ handle: t.String({ maxLength: 64 }), recoveryCode: t.String({ maxLength: 128 }) }) },
    )
    .post(
      '/recover/verify',
      async ({ body, cookie, headers }) => {
        const ch = await takeChallenge(db, body.challengeId, 'recover');
        if (!ch.userId) throw new ApiError(400, 'challenge_invalid');
        const userId = ch.userId;
        const reg = await verifyRegistration(cfg, body.response, ch.challenge);
        const recovery = generateRecoveryCode();
        const recoveryCodeHash = await hashRecoveryCode(recovery.normalized);
        try {
          await db.transaction(async (tx) => {
            const { sessions } = await import('@anti/db');
            await tx.delete(passkeys).where(eq(passkeys.userId, userId));
            await tx.delete(sessions).where(eq(sessions.userId, userId));
            await tx.insert(passkeys).values({
              id: reg.id, userId, publicKey: reg.publicKey, counter: reg.counter, transports: reg.transports,
            });
            await tx.update(users).set({ recoveryCodeHash }).where(eq(users.id, userId));
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new ApiError(409, 'passkey_exists', 'That passkey is already registered.');
          throw e;
        }
        const extra = await startSession(cookie as CookieJar, headers, userId);
        return { recoveryCode: recovery.display, ...extra };
      },
      { body: challengeBody },
    )
    .post('/logout', async ({ auth, cookie }) => {
      if (auth) await revokeSession(db, auth.tokenHash);
      clearSessionCookie(cookie as CookieJar);
      return { ok: true };
    });
};

