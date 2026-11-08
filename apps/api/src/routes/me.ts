import { Elysia, t } from 'elysia';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { invites, passkeys, users, waitlist, isUniqueViolation, rows, scalar } from '@anti/db';
import { DISPLAY_NAME_MAX, GENDERS, MIN_AGE, formatInviteCode } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError, rethrowDb } from '../lib/errors';
import { authPlugin, clearSessionCookie, requireSeated, requireUser, type CookieJar } from '../plugins/auth';
import type { Auth } from '../lib/sessions';
import { saveChallenge, takeChallenge } from '../lib/challenges';
import { registrationOptions, verifyRegistration } from '../lib/webauthn';
import { generateInviteCode } from '../lib/crypto';
import { checkAbout, checkBirthday, closeAccount } from '../lib/account';
import { interestsOf } from './interests';

/** Queue standing. `priority` 'reinstating' = former member (seat is offered, paid); 'new' = invitee (seated free). */
type Waitlist = { position: number; total: number; priority: 'reinstating' | 'new'; offeredUntil: string | null };
/** Present while flagged: the member keeps the seat by contributing `required` times before `graceEndsAt`. */
type Lurker = { flaggedAt: string; graceEndsAt: string; contributions: number; required: number };
/** reason: 'inactive' | 'lurker_grace_expired' | 'waitlist_decay' (see run_lifecycle). */
type Archived = { reason: string; wasMember: boolean };

export const meRoutes = (deps: Deps) => {
  const { db, cfg, storage } = deps;
  const genderSchema = t.Union(GENDERS.map((g) => t.Literal(g)));

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
      // setup (RFC §10.3): until it is done the app shows only the setup page
      setupNeeded: !u.setupDoneAt, gender: u.gender, birthday: u.birthday, birthdayPublic: u.birthdayPublic,
      interests: await interestsOf(db, u.id),
    };
  }

  return new Elysia({ prefix: '/me' })
    .use(authPlugin(deps))
    .get('/', ({ auth }) => profile(requireUser(auth).user.id))
    .patch(
      '/',
      async ({ auth, body }) => {
        const a = requireUser(auth);
        const patch: { displayName?: string; bio?: string; gender?: (typeof GENDERS)[number]; birthdayPublic?: boolean } = {};
        if (body.displayName !== undefined) {
          const d = body.displayName.trim();
          if (d.length < 1 || d.length > DISPLAY_NAME_MAX) {
            throw new ApiError(400, 'display_name_invalid', `Display name must be 1-${DISPLAY_NAME_MAX} characters.`);
          }
          patch.displayName = d;
        }
        if (body.bio !== undefined) patch.bio = body.bio.trim();
        // gender can change any time (the face redraws); the birthday cannot (admins can correct it)
        if (body.gender !== undefined) patch.gender = body.gender;
        if (body.birthdayPublic !== undefined) patch.birthdayPublic = body.birthdayPublic;
        if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, a.user.id));
        return profile(a.user.id);
      },
      {
        body: t.Object({
          displayName: t.Optional(t.String({ maxLength: 200 })), bio: t.Optional(t.String({ maxLength: 160 })),
          gender: t.Optional(genderSchema), birthdayPublic: t.Optional(t.Boolean()),
        }),
      },
    )
    .delete('/', async ({ auth, cookie }) => {
      const a = requireUser(auth);
      try {
        await closeAccount(db, storage, a.user.id, 'self_delete', a.user.id);
      } catch (e) {
        rethrowDb(e);
      }
      clearSessionCookie(cookie as CookieJar);
      return { ok: true };
    })

    /**
     * "Finish your profile" (RFC §10.3, Q9/Q17): six things that tick themselves from what the
     * member has actually done. It nudges, it never blocks; closing it is saved to the account.
     */
    .get('/checklist', async ({ auth }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      const [r] = await rows<Record<'headline' | 'skills' | 'project' | 'post' | 'pick' | 'interests', boolean>>(db, sql`
        select
          coalesce((select headline <> '' from portfolios where user_id = ${uid}::uuid), false) as headline,
          coalesce((select jsonb_array_length(skills) > 0 from portfolios where user_id = ${uid}::uuid), false) as skills,
          exists (select 1 from projects where user_id = ${uid}::uuid and draft = false) as project,
          exists (select 1 from posts where author_id = ${uid}::uuid and deleted_at is null) as post,
          exists (select 1 from suggestions where author_id = ${uid}::uuid and deleted_at is null) as pick,
          exists (select 1 from user_interests where user_id = ${uid}::uuid) as interests`);
      const items = { headline: !!r?.headline, skills: !!r?.skills, project: !!r?.project, post: !!r?.post, pick: !!r?.pick, interests: !!r?.interests };
      // hiding lasts until the next daily reminder (jobs.ts "checklist"): then the window is back
      const dismissed = !!a.user.checklistDismissedAt && !(await scalar<boolean>(db, sql`
        select exists (select 1 from notifications where user_id = ${uid}::uuid and kind = 'checklist_reminder'
                         and created_at > ${a.user.checklistDismissedAt}::timestamptz)`));
      return { items, dismissed };
    })

    .post('/checklist/dismiss', async ({ auth }) => {
      const a = requireSeated(auth);
      await db.update(users).set({ checklistDismissedAt: new Date() }).where(eq(users.id, a.user.id));
      return { dismissed: true };
    })

    // What the setup page starts from: whatever is already there (an About written earlier).
    .get('/setup', async ({ auth }) => {
      const a = requireUser(auth);
      const [p] = await rows<{ about: string | null }>(db, sql`select about from portfolios where user_id = ${a.user.id}::uuid`);
      return { about: p?.about ?? '', gender: a.user.gender, birthday: a.user.birthday };
    })

    /**
     * Finish setup: About you (the portfolio's About), gender, birthday. Under MIN_AGE the account
     * is closed instead, but only with confirmUnderage (the app asks "is that right?" first);
     * the birthday is never saved then. Not a contribution for the lurker rule.
     */
    .put('/setup', async ({ auth, body, cookie }) => {
      const a = requireUser(auth);
      const b = checkBirthday(body.birthday);
      if (b.age < MIN_AGE) {
        if (!body.confirmUnderage) throw new ApiError(409, 'underage', `That birthday makes you ${b.age}. You have to be ${MIN_AGE} or older.`);
        await closeAccount(db, storage, a.user.id, 'underage', a.user.id);
        clearSessionCookie(cookie as CookieJar);
        return { closed: true as const };
      }
      const about = checkAbout(body.about);
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into portfolios (user_id, about, updated_at) values (${a.user.id}::uuid, ${about}, now())
          on conflict (user_id) do update set about = excluded.about, updated_at = now()`);
        await tx.execute(sql`update users set gender = ${body.gender}::gender, birthday = ${b.iso}::date,
          setup_done_at = coalesce(setup_done_at, now()) where id = ${a.user.id}::uuid`);
      });
      return profile(a.user.id);
    }, {
      body: t.Object({
        about: t.String({ maxLength: 6000 }), gender: genderSchema, birthday: t.String({ maxLength: 20 }),
        confirmUnderage: t.Optional(t.Boolean()),
      }),
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
