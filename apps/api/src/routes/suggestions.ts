import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { rows, scalar } from '@anti/db';
import {
  SUGGESTION_KINDS, SUGGESTION_NOTE_MAX, SUGGESTION_TITLE_MAX, SUGGESTIONS_PER_DAY, type SuggestionKind,
} from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * Picks: members suggest a movie, book, place or food; the side window shows a random one.
 * Only picks by members who still exist (not banned or deleted) are shown.
 * Adding a pick does not count as a contribution for the lurker rule (RFC §3: posts,
 * replies, events) — it is a light gesture, not taking part in the conversation.
 */
export type Pick = {
  id: string; kind: SuggestionKind; title: string; note: string | null; createdAt: string;
  author: { handle: string; displayName: string; gender: string | null } | null; mine: boolean;
};
type PickRow = {
  id: string; kind: SuggestionKind; title: string; note: string | null; created_iso: string;
  handle: string | null; display_name: string | null; gender: string | null; author_id: string;
};

const select = sql`
  select s.id, s.kind, s.title, s.note, s.author_id,
    to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_iso,
    u.handle, u.display_name, u.gender
  from suggestions s
  join users u on u.id = s.author_id
  where s.deleted_at is null and u.state not in ('banned', 'deleted')`;

const toPick = (r: PickRow, me: string): Pick => ({
  id: r.id, kind: r.kind, title: r.title, note: r.note, createdAt: r.created_iso,
  author: r.handle ? { handle: r.handle, displayName: r.display_name ?? r.handle, gender: r.gender ?? null } : null,
  mine: r.author_id === me,
});

const kindSchema = t.Union(SUGGESTION_KINDS.map((k) => t.Literal(k)));

export const suggestionRoutes = (deps: Deps) => {
  const { db } = deps;
  return new Elysia()
    .use(authPlugin(deps))

    /** One random pick. `exclude` = the one on screen, so "Another" always changes it. */
    .get('/suggestions/random', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const exclude = query.exclude && /^[0-9a-f-]{36}$/.test(query.exclude) ? query.exclude : null;
      const [r] = await rows<PickRow>(db, sql`
        ${select}
        ${exclude ? sql`and s.id <> ${exclude}::uuid` : sql``}
        ${query.kind ? sql`and s.kind = ${query.kind}` : sql``}
        order by random() limit 1`);
      return { item: r ? toPick(r, a.user.id) : null };
    }, { query: t.Object({ exclude: t.Optional(t.String()), kind: t.Optional(kindSchema) }) })

    .post('/suggestions', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const title = body.title.trim();
      const note = body.note?.trim() || null;
      if (!title || title.length > SUGGESTION_TITLE_MAX) {
        throw new ApiError(400, 'title_invalid', `Give it a name, up to ${SUGGESTION_TITLE_MAX} characters.`);
      }
      if (note && note.length > SUGGESTION_NOTE_MAX) {
        throw new ApiError(400, 'note_invalid', `Keep the note under ${SUGGESTION_NOTE_MAX} characters.`);
      }
      const today = Number(await scalar<number>(db, sql`
        select count(*)::int from suggestions
         where author_id = ${a.user.id}::uuid and created_at > now() - interval '1 day'`));
      if (today >= SUGGESTIONS_PER_DAY) {
        throw new ApiError(429, 'rate_limited', `You can suggest ${SUGGESTIONS_PER_DAY} things a day.`);
      }
      const [created] = await rows<{ id: string }>(db, sql`
        insert into suggestions (author_id, kind, title, note)
        values (${a.user.id}::uuid, ${body.kind}, ${title}, ${note}) returning id`);
      const [r] = await rows<PickRow>(db, sql`${select} and s.id = ${created!.id}::uuid`);
      return toPick(r!, a.user.id);
    }, {
      body: t.Object({
        kind: kindSchema,
        title: t.String({ maxLength: 200 }),
        note: t.Optional(t.Nullable(t.String({ maxLength: 400 }))),
      }),
    })

    .delete('/suggestions/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (!/^[0-9a-f-]{36}$/.test(params.id)) throw new ApiError(404, 'not_found');
      const [r] = await rows<{ author_id: string }>(db, sql`
        select author_id from suggestions where id = ${params.id}::uuid and deleted_at is null`);
      if (!r) throw new ApiError(404, 'not_found');
      if (r.author_id !== a.user.id) throw new ApiError(403, 'not_author', 'You can only remove your own picks.');
      await db.execute(sql`update suggestions set deleted_at = now() where id = ${params.id}::uuid`);
      return { ok: true };
    })

    .get('/members/:handle/suggestions', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const found = await rows<PickRow>(db, sql`
        ${select} and lower(u.handle) = lower(${params.handle})
        order by s.created_at desc limit 50`);
      return { items: found.map((r) => toPick(r, a.user.id)) };
    });
};
