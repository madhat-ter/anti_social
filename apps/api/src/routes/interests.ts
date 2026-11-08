import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { isUniqueViolation, rows, type Db } from '@anti/db';
import { INTERESTS_MAX } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * Interests (RFC §10.5): a fixed list of tags (seeded in functions.sql; admins add more) that
 * members pick on their profile, up to INTERESTS_MAX. Collabs and events carry the same tags,
 * so "people who might fit" is simply the overlap.
 */
export async function interestsOf(db: Db, userId: string): Promise<string[]> {
  const r = await rows<{ interest: string }>(db, sql`
    select ui.interest from user_interests ui join interests i on i.slug = ui.interest
     where ui.user_id = ${userId}::uuid order by i.label`);
  return r.map((x) => x.interest);
}

/** Lowercase, letters/digits/dashes: "Street food" → "street-food". */
const slugify = (label: string) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export const interestRoutes = (deps: Deps) => {
  const { db } = deps;
  return new Elysia()
    .use(authPlugin(deps))

    .get('/interests', async ({ auth }) => {
      requireSeated(auth);
      const items = await rows<{ slug: string; label: string }>(db, sql`select slug, label from interests order by label`);
      return { items };
    })

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

    /** Admins add a tag to the list. */
    .post('/ops/interests', async ({ auth, body }) => {
      const a = requireSeated(auth);
      if (a.user.role !== 'ops') throw new ApiError(404, 'not_found');
      const label = body.label.replace(/\s+/g, ' ').trim();
      const slug = slugify(label);
      if (label.length < 2 || label.length > 30 || slug.length < 2) {
        throw new ApiError(400, 'interest_invalid', 'An interest is 2 to 30 characters.');
      }
      try {
        await db.execute(sql`insert into interests (slug, label) values (${slug}, ${label})`);
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError(409, 'interest_exists', 'That interest is already on the list.');
        throw e;
      }
      return { slug, label };
    }, { body: t.Object({ label: t.String({ maxLength: 60 }) }) });
};
