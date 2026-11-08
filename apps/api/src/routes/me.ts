import { Elysia, t } from 'elysia';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { invites, passkeys, users, waitlist, isUniqueViolation, rows, scalar } from '@anti/db';
import { DISPLAY_NAME_MAX, formatInviteCode } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError, rethrowDb } from '../lib/errors';
import { authPlugin, clearSessionCookie, requireSeated, requireUser, type CookieJar } from '../plugins/auth';
import type { Auth } from '../lib/sessions';
import { saveChallenge, takeChallenge } from '../lib/challenges';
import { registrationOptions, verifyRegistration } from '../lib/webauthn';
import { generateInviteCode } from '../lib/crypto';

/** Queue standing. `priority` 'reinstating' = former member (seat is offered, paid); 'new' = invitee (seated free). */
type Waitlist = { position: number; total: number; priority: 'reinstating' | 'new'; offeredUntil: string | null };
/** Present while flagged: the member keeps the seat by contributing `required` times before `graceEndsAt`. */
type Lurker = { flaggedAt: string; graceEndsAt: string; contributions: number; required: number };
/** reason: 'inactive' | 'lurker_grace_expired' | 'waitlist_decay' (see run_lifecycle). */
type Archived = { reason: string; wasMember: boolean };

export const meRoutes = (deps: Deps) => {
  const { db, cfg } = deps;

  async function profile(userId: string) {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new ApiError(401, 'unauthenticated');
    let invitedBy: { handle: string } | null = null;
    if (u.invitedBy) {
      const [inv] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, u.invitedBy)).limit(1);
      if (inv) invitedBy = inv;
    }
    let wl: Waitlist | null = null;
    if (u.state === 'waitlisted' || u.state === 'archived') {
      const [me] = await db.select().from(waitlist).where(eq(waitlist.userId, userId)).limit(1);
      if (me) {
        const [ahead] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(waitlist)
          .where(or(
            lt(waitlist.priority, me.priority),
            and(eq(waitlist.priority, me.priority), lt(waitlist.enqueuedAt, me.enqueuedAt)),
          ));
        const total = await scalar<number>(db, sql`select count(*)::int from waitlist where offered_at is null`);
        const open = !!me.offerExpiresAt && me.offerExpiresAt.getTime() > Date.now();
        wl = {
          position: (ahead?.n ?? 0) + 1,
          total: Number(total ?? 0),
          priority: me.priority === 0 ? 'reinstating' : 'new',
          offeredUntil: open ? me.offerExpiresAt!.toISOString() : null,
        };
      }
    }
    let lurker: Lurker | null = null;
    if (u.state === 'flagged_lurker' && u.lurkerFlaggedAt) {
      const [r] = await rows<{ grace: number; required: number; done: number }>(db, sql`
        select setting_int('lurker_grace_days') as grace, setting_int('lurker_min_contributions') as required,
               (select count(*)::int from contributions where user_id = ${userId}::uuid and at >= ${u.lurkerFlaggedAt.toISOString()}::timestamptz) as done`);
      lurker = {
        flaggedAt: u.lurkerFlaggedAt.toISOString(),
        graceEndsAt: new Date(u.lurkerFlaggedAt.getTime() + Number(r!.grace) * 86_400_000).toISOString(),
        contributions: Number(r!.done),
        required: Number(r!.required),
      };
    }
    let archived: Archived | null = null;
    if (u.state === 'archived') {
      const reason = await scalar<string>(db, sql`
        select reason from user_state_events where user_id = ${userId}::uuid and to_state = 'archived'
         order by id desc limit 1`);
      archived = { reason: reason ?? 'unknown', wasMember: !!u.activatedAt };
    }
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: u.id, handle: u.handle, displayName: u.displayName, bio: u.bio, state: u.state, role: u.role,
      invitedBy, activatedAt: iso(u.activatedAt), lastSeenAt: iso(u.lastSeenAt),
      lurkerExemptUntil: iso(u.lurkerExemptUntil), waitlist: wl, lurker, archived,
    };
  }

  return new Elysia({ prefix: '/me' })
    .use(authPlugin(deps))
    .get('/', ({ auth }) => profile(requireUser(auth).user.id))
    .patch(
      '/',
      async ({ auth, body }) => {
        const a = requireUser(auth);
        const patch: { displayName?: string; bio?: string } = {};
        if (body.displayName !== undefined) {
          const d = body.displayName.trim();
          if (d.length < 1 || d.length > DISPLAY_NAME_MAX) {
            throw new ApiError(400, 'display_name_invalid', `Display name must be 1-${DISPLAY_NAME_MAX} characters.`);
          }
          patch.displayName = d;
        }
        if (body.bio !== undefined) patch.bio = body.bio.trim();
        if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, a.user.id));
        return profile(a.user.id);
      },
      { body: t.Object({ displayName: t.Optional(t.String({ maxLength: 200 })), bio: t.Optional(t.String({ maxLength: 160 })) }) },
    )
    .delete('/', async ({ auth, cookie }) => {
      const a = requireUser(auth);
      try {
        await db.execute(sql`select delete_account(${a.user.id}::uuid)`);
      } catch (e) {
        rethrowDb(e);
      }
      clearSessionCookie(cookie as CookieJar);
      return { ok: true };
    })
    .get('/passkeys', async ({ auth }) => {
      const a = requireUser(auth);
      const rows = await db.select().from(passkeys).where(eq(passkeys.userId, a.user.id)).orderBy(asc(passkeys.createdAt));
      return rows.map((p) => ({
        id: p.id, deviceLabel: p.deviceLabel, createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
      }));
    })
    .post('/passkeys/options', async ({ auth }) => {
      const a = requireUser(auth);
      const existing = await db.select().from(passkeys).where(eq(passkeys.userId, a.user.id));
      const options = await registrationOptions(cfg, a.user, existing);
      const challengeId = await saveChallenge(db, { challenge: options.challenge, purpose: 'add_passkey', userId: a.user.id });
      return { challengeId, options };
    })
    .post(
      '/passkeys/verify',
      async ({ auth, body }) => {
        const a = requireUser(auth);
        const ch = await takeChallenge(db, body.challengeId, 'add_passkey');
        if (ch.userId !== a.user.id) throw new ApiError(400, 'challenge_invalid');
        const reg = await verifyRegistration(cfg, body.response, ch.challenge);
        try {
          await db.insert(passkeys).values({
            id: reg.id, userId: a.user.id, publicKey: reg.publicKey, counter: reg.counter, transports: reg.transports,
            deviceLabel: body.deviceLabel?.trim().slice(0, 60) || null,
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw new ApiError(409, 'passkey_exists', 'That passkey is already registered.');
          throw e;
        }
        return { id: reg.id };
      },
      { body: t.Object({ challengeId: t.String(), response: t.Any(), deviceLabel: t.Optional(t.String({ maxLength: 100 })) }) },
    )
    .delete('/passkeys/:id', async ({ auth, params }) => {
      const a = requireUser(auth);
      await db.transaction(async (tx) => {
        // lock the user row so concurrent deletes cannot both pass the count check
        await tx.execute(sql`select id from users where id = ${a.user.id}::uuid for update`);
        const mine = await tx.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, a.user.id));
        if (!mine.some((p) => p.id === params.id)) throw new ApiError(404, 'not_found');
        if (mine.length <= 1) throw new ApiError(409, 'last_passkey', 'You cannot remove your only passkey.');
        await tx.delete(passkeys).where(and(eq(passkeys.id, params.id), eq(passkeys.userId, a.user.id)));
      });
      return { ok: true };
    })
    .get('/invites', async ({ auth }) => {
      const a = requireSeated(auth);
      const rows = await db
        .select({
          createdAt: invites.createdAt, expiresAt: invites.expiresAt, redeemedAt: invites.redeemedAt,
          revokedAt: invites.revokedAt, redeemedByHandle: users.handle,
        })
        .from(invites)
        .leftJoin(users, eq(users.id, invites.redeemedBy))
        .where(eq(invites.createdBy, a.user.id))
        .orderBy(desc(invites.createdAt));
      const now = Date.now();
      return rows.map((r) => ({
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
        redeemedBy: r.redeemedAt && r.redeemedByHandle ? { handle: r.redeemedByHandle } : null,
        status: r.redeemedAt ? 'redeemed' : r.revokedAt ? 'revoked' : r.expiresAt.getTime() <= now ? 'expired' : 'open',
      }));
    })
    .post('/invites', async ({ auth }) => {
      const a: Auth = requireSeated(auth);
      const code = generateInviteCode();
      try {
        const expires = await scalar<Date | string>(db, sql`select create_invite(${a.user.id}::uuid, ${code})`);
        return { code: formatInviteCode(code), expiresAt: new Date(expires as string | Date).toISOString() };
      } catch (e) {
        rethrowDb(e);
      }
    })
    .post('/waitlist/rejoin', async ({ auth }) => {
      const a = requireUser(auth);
      if (a.user.state !== 'archived') throw new ApiError(409, 'rejoin_not_applicable', 'Only archived accounts can rejoin the queue.');
      try {
        await db.execute(sql`select rejoin_queue(${a.user.id}::uuid)`);
      } catch (e) {
        rethrowDb(e);
      }
      return { ok: true };
    });
};
