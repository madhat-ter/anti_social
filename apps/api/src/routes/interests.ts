import { Elysia, t } from 'elysia';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isUniqueViolation, rows, type Db } from '@anti/db';
import { INTERESTS_MAX } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { hit } from '../lib/ratelimit';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * Interests (RFC §10.5): one shared list of tags (seeded in functions.sql) that members pick on
 * their profile, up to INTERESTS_MAX. Collabs and events carry the same tags, so "people who
 * might fit" is simply the overlap. Anyone can add a missing one (so nobody is left out); it joins
 * the shared list for everyone. Admins remove ones that should not be there.
 */
export async function interestsOf(db: Db, userId: string): Promise<string[]> {
  const r = await rows<{ interest: string }>(db, sql`
    select ui.interest from user_interests ui join interests i on i.slug = ui.interest
     where ui.user_id = ${userId}::uuid order by i.label`);
  return r.map((x) => x.interest);
}

/** Tidy a typed label: single spaces, trimmed, first letter capitalised. Throws when unusable. */
export function cleanLabel(raw: string): string {
  const s = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 30) throw new ApiError(400, 'interest_invalid', 'An interest is 2 to 30 characters.');
  if (!/^[\p{L}\p{M}\p{N} &'+./-]+$/u.test(s) || !/[\p{L}\p{N}]/u.test(s) || /:\/\/|www\./i.test(s)) {
    throw new ApiError(400, 'interest_invalid', 'Use letters, numbers and spaces (a few symbols like & and - are fine).');
  }
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/**
 * "Street food" → "street-food"; accents dropped ("Café" → "cafe"). Labels in other scripts have no
 * ASCII to keep, so they get a stable short id from the lowercased label instead.
 */
export function interestSlug(label: string): string {
  const ascii = label.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  if (ascii.length >= 2 && ascii.length * 2 >= label.replace(/\s/g, '').length) return ascii;
  return `x-${createHash('sha256').update(label.toLocaleLowerCase()).digest('hex').slice(0, 10)}`;
}

/** The interest with this slug or (case-insensitively) this label, if any. */
async function existing(db: Db, slug: string, label: string) {
  const [r] = await rows<{ slug: string; label: string }>(db, sql`
    select slug, label from interests where slug = ${slug} or lower(label) = lower(${label}) limit 1`);
  return r ?? null;
}

const requireOps = (a: ReturnType<typeof requireSeated>) => { if (a.user.role !== 'ops') throw new ApiError(404, 'not_found'); };

export const interestRoutes = (deps: Deps) => {
  const { db } = deps;
  return new Elysia()
    .use(authPlugin(deps))

    .get('/interests', async ({ auth }) => {
      requireSeated(auth);
      const items = await rows<{ slug: string; label: string }>(db, sql`select slug, label from interests order by lower(label)`);
      return { items };
    })

    /**
     * Any member adds a missing interest. If it is already there (same tag or same name), you get
     * that one back instead of a duplicate. 5 new ones a day.
     */
    .post('/interests', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const label = cleanLabel(body.label);
      const slug = interestSlug(label);
      const found = await existing(db, slug, label);
      if (found) return { ...found, added: false };
      await hit(db, 'interestAdd', a.user.id);
      try {
        await db.execute(sql`insert into interests (slug, label, created_by) values (${slug}, ${label}, ${a.user.id}::uuid)`);
      } catch (e) {
        if (isUniqueViolation(e)) return { ...(await existing(db, slug, label))!, added: false };
        throw e;
      }
      return { slug, label, added: true };
    }, { body: t.Object({ label: t.String({ maxLength: 120 }) }) })

    /** Replace your interests (an empty list clears them). */
    .put('/me/interests', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const picked = [...new Set(body.interests)];
      if (picked.length > INTERESTS_MAX) throw new ApiError(400, 'interests_invalid', `Pick up to ${INTERESTS_MAX} interests.`);
      if (picked.length) {
        const known = await rows<{ slug: string }>(db, sql`
          select slug from interests where slug in (${sql.join(picked.map((s) => sql`${s}`), sql`, `)})`);
        if (known.length !== picked.length) throw new ApiError(400, 'interests_invalid', 'One of those interests does not exist.');
      }
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        await tx.execute(sql`delete from user_interests where user_id = ${a.user.id}::uuid`);
        for (const s of picked) await tx.execute(sql`insert into user_interests (user_id, interest) values (${a.user.id}::uuid, ${s})`);
      });
      return { interests: await interestsOf(db, a.user.id) };
    }, { body: t.Object({ interests: t.Array(t.String({ maxLength: 40 }), { maxItems: 50 }) }) })

    /** Admins: the whole list with who added each one and how much it is used. */
    .get('/ops/interests', async ({ auth }) => {
      requireOps(requireSeated(auth));
      const r = await rows<{ slug: string; label: string; handle: string | null; members: number; collabs: number; events: number; at: string }>(db, sql`
        select i.slug, i.label, u.handle,
          (select count(*)::int from user_interests x where x.interest = i.slug) as members,
          (select count(*)::int from collab_interests x where x.interest = i.slug) as collabs,
          (select count(*)::int from event_interests x where x.interest = i.slug) as events,
          to_char(i.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
        from interests i left join users u on u.id = i.created_by
        order by (i.created_by is null), i.created_at desc, lower(i.label)`);
      return {
        items: r.map((x) => ({
          slug: x.slug, label: x.label, addedBy: x.handle, addedAt: x.at,
          uses: { members: Number(x.members), collabs: Number(x.collabs), events: Number(x.events) },
        })),
      };
    })

    /** Admins add a tag to the list. */
    .post('/ops/interests', async ({ auth, body }) => {
      requireOps(requireSeated(auth));
      const label = cleanLabel(body.label);
      const slug = interestSlug(label);
      if (await existing(db, slug, label)) throw new ApiError(409, 'interest_exists', 'That interest is already on the list.');
      try {
        await db.execute(sql`insert into interests (slug, label) values (${slug}, ${label})`);
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError(409, 'interest_exists', 'That interest is already on the list.');
        throw e;
      }
      return { slug, label };
    }, { body: t.Object({ label: t.String({ maxLength: 120 }) }) })

    /** Admins remove a tag; it disappears from every profile, collab and event that had it. */
    .delete('/ops/interests/:slug', async ({ auth, params }) => {
      requireOps(requireSeated(auth));
      const gone = await rows(db, sql`delete from interests where slug = ${params.slug} returning 1`);
      if (!gone.length) throw new ApiError(404, 'not_found');
      return { removed: true as const };
    }, { params: t.Object({ slug: t.String({ maxLength: 40 }) }) });
};
