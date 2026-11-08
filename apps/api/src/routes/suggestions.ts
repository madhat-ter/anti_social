import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { rows, scalar } from '@anti/db';
import {
  PICK_NO_REPEAT, SUGGESTION_KINDS, SUGGESTION_NOTE_MAX, SUGGESTION_REMARK_MAX, SUGGESTION_TITLE_MAX,
  SUGGESTIONS_PER_DAY, type SuggestionKind,
} from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { authPlugin, requireSeated } from '../plugins/auth';

/**
 * Picks: members suggest a movie, book, place or food; the side window shows one, changing every
 * minute (the client's timer) or on "Another". Members who have tried it vote "good" (+1) or "not
 * for me" (-1), with an optional remark (one per member per pick). Better-rated picks come up more
 * often, none disappear. Only picks, votes and remarks of members who still exist are shown.
 * None of this counts as a contribution for the lurker rule — real conversation is in posts.
 */
type Person = { handle: string; displayName: string; gender: string | null };
export type Remark = Person & { vote: 1 | -1; remark: string | null; at: string };
export type Pick = {
  id: string; kind: SuggestionKind; title: string; note: string | null; createdAt: string;
  author: Person | null; mine: boolean;
  up: number; down: number; remarkCount: number;
  /** your own vote and remark, if any */
  myVote: 1 | -1 | null; myRemark: string | null;
  /** the newest remark, for the window */
  latestRemark: Remark | null;
};
type PickRow = {
  id: string; kind: SuggestionKind; title: string; note: string | null; created_iso: string;
  handle: string | null; display_name: string | null; gender: string | null; author_id: string;
  up: number; down: number; remarks: number; my_vote: number | null; my_remark: string | null; latest: unknown;
};

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const LIVE_VOTER = sql`join users vu on vu.id = v.user_id and vu.state not in ('banned', 'deleted')`;

/** Every pick field for this viewer; callers append `and ...` conditions. */
const select = (me: string) => sql`
  select s.id, s.kind, s.title, s.note, s.author_id,
    to_char(s.created_at at time zone 'UTC', ${sql.raw(ISO)}) as created_iso,
    u.handle, u.display_name, u.gender,
    (select count(*)::int from suggestion_votes v ${LIVE_VOTER} where v.suggestion_id = s.id and v.vote = 1) as up,
    (select count(*)::int from suggestion_votes v ${LIVE_VOTER} where v.suggestion_id = s.id and v.vote = -1) as down,
    (select count(*)::int from suggestion_votes v ${LIVE_VOTER} where v.suggestion_id = s.id and v.remark is not null) as remarks,
    (select v.vote from suggestion_votes v where v.suggestion_id = s.id and v.user_id = ${me}::uuid) as my_vote,
    (select v.remark from suggestion_votes v where v.suggestion_id = s.id and v.user_id = ${me}::uuid) as my_remark,
    (select json_build_object('handle', vu.handle, 'displayName', vu.display_name, 'gender', vu.gender,
        'vote', v.vote, 'remark', v.remark, 'at', to_char(v.updated_at at time zone 'UTC', ${sql.raw(ISO)}))
       from suggestion_votes v ${LIVE_VOTER}
      where v.suggestion_id = s.id and v.remark is not null order by v.updated_at desc limit 1) as latest
  from suggestions s
  join users u on u.id = s.author_id
  where s.deleted_at is null and u.state not in ('banned', 'deleted')`;

const json = <T,>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? JSON.parse(v) as T : v as T);

const toPick = (r: PickRow, me: string): Pick => ({
  id: r.id, kind: r.kind, title: r.title, note: r.note, createdAt: r.created_iso,
  author: r.handle ? { handle: r.handle, displayName: r.display_name ?? r.handle, gender: r.gender ?? null } : null,
  mine: r.author_id === me,
  up: Number(r.up), down: Number(r.down), remarkCount: Number(r.remarks),
  myVote: r.my_vote === null ? null : (Number(r.my_vote) as 1 | -1), myRemark: r.my_remark,
  latestRemark: json<Remark>(r.latest),
});

const kindSchema = t.Union(SUGGESTION_KINDS.map((k) => t.Literal(k)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const suggestionRoutes = (deps: Deps) => {
  const { db } = deps;

  async function getPick(id: string, me: string): Promise<Pick | null> {
    if (!UUID.test(id)) return null;
    const [r] = await rows<PickRow>(db, sql`${select(me)} and s.id = ${id}::uuid`);
    return r ? toPick(r, me) : null;
  }

  return new Elysia()
    .use(authPlugin(deps))

    /**
     * One pick, weighted by its rating: score = 1 + (up - down) / 4, kept between 1/4 and 4, and
     * drawn with -ln(random) / score. `exclude`: the one on screen first, then the last few seen
     * (comma separated); if that leaves nothing, only the one on screen is skipped.
     */
    .get('/suggestions/random', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const seen = (query.exclude ?? '').split(',').filter((x) => UUID.test(x)).slice(0, PICK_NO_REPEAT);
      const draw = async (skip: string[]) => {
        const [r] = await rows<PickRow>(db, sql`
          select * from (${select(a.user.id)}
            ${query.kind ? sql`and s.kind = ${query.kind}` : sql``}) q
          ${skip.length ? sql`where q.id not in (${sql.join(skip.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``}
          order by -ln(1 - random()) / greatest(0.25, least(4.0, 1 + (q.up - q.down) / 4.0))
          limit 1`);
        return r;
      };
      const r = (await draw(seen)) ?? (seen.length > 1 ? await draw(seen.slice(0, 1)) : undefined);
      return { item: r ? toPick(r, a.user.id) : null };
    }, { query: t.Object({ exclude: t.Optional(t.String({ maxLength: 300 })), kind: t.Optional(kindSchema) }) })

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
      return (await getPick(created!.id, a.user.id))!;
    }, {
      body: t.Object({
        kind: kindSchema,
        title: t.String({ maxLength: 200 }),
        note: t.Optional(t.Nullable(t.String({ maxLength: 400 }))),
      }),
    })

    .delete('/suggestions/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (!UUID.test(params.id)) throw new ApiError(404, 'not_found');
      const [r] = await rows<{ author_id: string }>(db, sql`
        select author_id from suggestions where id = ${params.id}::uuid and deleted_at is null`);
      if (!r) throw new ApiError(404, 'not_found');
      if (r.author_id !== a.user.id) throw new ApiError(403, 'not_author', 'You can only remove your own picks.');
      await db.execute(sql`update suggestions set deleted_at = now() where id = ${params.id}::uuid`);
      return { ok: true };
    })

    /**
     * "Tried it": vote 1 (good) or -1 (not for me). `remark`: omitted = keep yours, null or ""
     * = remove it, text = set it. The suggester is told about a new or changed remark, not about
     * bare votes. Not on your own pick.
     */
    .put('/suggestions/:id/vote', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      const p = await getPick(params.id, a.user.id);
      if (!p) throw new ApiError(404, 'not_found');
      if (p.mine) throw new ApiError(409, 'own_pick', 'You cannot vote on your own pick.');
      let remark: string | null | undefined;
      if (body.remark === undefined) remark = undefined;
      else {
        remark = body.remark?.replace(/\s+/g, ' ').trim() || null;
        if (remark && remark.length > SUGGESTION_REMARK_MAX) {
          throw new ApiError(400, 'remark_invalid', `Keep the remark under ${SUGGESTION_REMARK_MAX} characters.`);
        }
      }
      await db.execute(sql`
        insert into suggestion_votes (suggestion_id, user_id, vote, remark)
        values (${p.id}::uuid, ${a.user.id}::uuid, ${body.vote}, ${remark ?? null})
        on conflict (suggestion_id, user_id) do update set
          vote = excluded.vote,
          remark = ${remark === undefined ? sql`suggestion_votes.remark` : sql`excluded.remark`},
          updated_at = now()`);
      const [author] = await rows<{ author_id: string }>(db, sql`select author_id from suggestions where id = ${p.id}::uuid`);
      if (remark && remark !== p.myRemark && author) {
        await db.execute(sql`insert into notifications (user_id, kind, payload)
          values (${author.author_id}::uuid, 'pick_remark',
                  ${JSON.stringify({ suggestionId: p.id, title: p.title, actorId: a.user.id })}::jsonb)`);
      }
      return (await getPick(p.id, a.user.id))!;
    }, {
      body: t.Object({
        vote: t.Union([t.Literal(1), t.Literal(-1)]),
        remark: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    })

    .delete('/suggestions/:id/vote', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await getPick(params.id, a.user.id);
      if (!p) throw new ApiError(404, 'not_found');
      await db.execute(sql`delete from suggestion_votes where suggestion_id = ${p.id}::uuid and user_id = ${a.user.id}::uuid`);
      return (await getPick(p.id, a.user.id))!;
    })

    /** Everyone who tried it: face, name, vote and remark (if any), newest first. */
    .get('/suggestions/:id/remarks', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const p = await getPick(params.id, a.user.id);
      if (!p) throw new ApiError(404, 'not_found');
      const items = await rows<{ handle: string; display_name: string; gender: string | null; vote: number; remark: string | null; at: string }>(db, sql`
        select vu.handle, vu.display_name, vu.gender, v.vote, v.remark,
               to_char(v.updated_at at time zone 'UTC', ${sql.raw(ISO)}) as at
          from suggestion_votes v ${LIVE_VOTER}
         where v.suggestion_id = ${p.id}::uuid
         order by (v.remark is null), v.updated_at desc
         limit 300`);
      return {
        pick: p,
        items: items.map((r): Remark => ({
          handle: r.handle, displayName: r.display_name, gender: r.gender, vote: Number(r.vote) as 1 | -1, remark: r.remark, at: r.at,
        })),
        canModerate: a.user.role === 'ops',
      };
    })

    /** An admin removes a remark (the vote stays); its writer is told. */
    .delete('/ops/suggestions/:id/remarks/:handle', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (a.user.role !== 'ops') throw new ApiError(404, 'not_found');
      const p = await getPick(params.id, a.user.id);
      if (!p) throw new ApiError(404, 'not_found');
      const [gone] = await rows<{ user_id: string }>(db, sql`
        update suggestion_votes v set remark = null, updated_at = now()
          from users u
         where v.suggestion_id = ${p.id}::uuid and v.user_id = u.id and lower(u.handle) = lower(${params.handle})
           and v.remark is not null
        returning v.user_id`);
      if (!gone) throw new ApiError(404, 'not_found');
      if (gone.user_id !== a.user.id) {
        await db.execute(sql`insert into notifications (user_id, kind, payload)
          values (${gone.user_id}::uuid, 'remark_removed', ${JSON.stringify({ suggestionId: p.id, title: p.title })}::jsonb)`);
      }
      return { removed: true };
    })

    .get('/members/:handle/suggestions', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const found = await rows<PickRow>(db, sql`
        ${select(a.user.id)} and lower(u.handle) = lower(${params.handle})
        order by s.created_at desc limit 50`);
      return { items: found.map((r) => toPick(r, a.user.id)) };
    });
};
