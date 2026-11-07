import { Elysia, t } from 'elysia';
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { SEARCH_QUERY_MAX } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { cursorBefore, listPosts, paginate, parseLimit, UUID_RE, type Page } from '../lib/posts';
import { authPlugin, requireSeated, requireUser } from '../plugins/auth';

const pageQuery = t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) });
const SEATED = sql`('active', 'flagged_lurker')`;

type MemberSummary = {
  handle: string; displayName: string; bio: string; state: string;
  invitedBy: { handle: string } | null; activatedAt: string | null; postCount: number;
};
type MemberRow = {
  id: string; cursor_ts: string; handle: string; display_name: string; bio: string; state: string;
  inv_handle: string | null; activated_iso: string | null; post_count: number;
};

const memberSelect = sql`
  select u.id, coalesce(u.activated_at, u.created_at)::text as cursor_ts,
    u.handle, u.display_name, u.bio, u.state, inv.handle as inv_handle,
    to_char(u.activated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as activated_iso,
    (select count(*)::int from posts p where p.author_id = u.id and p.deleted_at is null and p.hidden_at is null) as post_count
  from users u
  left join users inv on inv.id = u.invited_by`;

const toMember = (r: MemberRow): MemberSummary => ({
  handle: r.handle, displayName: r.display_name, bio: r.bio, state: r.state,
  invitedBy: r.inv_handle ? { handle: r.inv_handle } : null,
  activatedAt: r.activated_iso, postCount: Number(r.post_count),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

type NotifRow = {
  id: string; kind: string; cursor_ts: string; created_iso: string; read_iso: string | null;
  a_handle: string | null; a_display: string | null;
  p_id: string | null; p_root: string | null; p_body: string | null; p_deleted: boolean | null;
};

async function unreadCount(db: Db, userId: string): Promise<number> {
  return Number((await scalar<number>(db, sql`
    select count(*)::int from notifications where user_id = ${userId}::uuid and read_at is null`)) ?? 0);
}

export const socialRoutes = (deps: Deps) => {
  const { db } = deps;

  async function findMember(handle: string) {
    const [m] = await rows<MemberRow>(db, sql`
      ${memberSelect}
      where lower(u.handle) = lower(${handle}) and u.state in ('active', 'flagged_lurker', 'archived')`);
    return m ?? null;
  }

  return new Elysia()
    .use(authPlugin(deps))

    .get('/search', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const q = (query.q ?? '').trim();
      if (q.length < 1 || q.length > SEARCH_QUERY_MAX) {
        throw new ApiError(400, 'query_invalid', `Search for 1-${SEARCH_QUERY_MAX} characters.`);
      }
      const like = escapeLike(q);
      const contains = `%${like}%`;
      const prefix = `${like}%`;
      const [postPage, memberRows] = await Promise.all([
        listPosts(db, a.user.id, sql`p.deleted_at is null and p.hidden_at is null
          and p.search @@ websearch_to_tsquery('simple', ${q})`, { limit: '20' }),
        rows<MemberRow>(db, sql`
          ${memberSelect}
          where u.state in ${SEATED}
            and (u.handle ilike ${contains} escape '\\' or u.display_name ilike ${contains} escape '\\')
          order by (u.handle ilike ${prefix} escape '\\' or u.display_name ilike ${prefix} escape '\\') desc, u.handle
          limit 10`),
      ]);
      return { members: memberRows.map(toMember), posts: postPage.items };
    }, { query: t.Object({ q: t.Optional(t.String()) }) })

    .get('/members', async ({ auth, query }): Promise<Page<MemberSummary>> => {
      requireSeated(auth);
      const limit = parseLimit(query.limit);
      const found = await rows<MemberRow>(db, sql`
        ${memberSelect}
        where u.state in ${SEATED} ${cursorBefore(sql`coalesce(u.activated_at, u.created_at)`, sql`u.id`, query.cursor)}
        order by coalesce(u.activated_at, u.created_at) desc, u.id desc
        limit ${limit + 1}`);
      const { page, nextCursor } = paginate(found, limit);
      return { items: page.map(toMember), nextCursor };
    }, { query: pageQuery })

    .get('/members/:handle', async ({ auth, params }) => {
      requireSeated(auth);
      const m = await findMember(params.handle);
      if (!m) throw new ApiError(404, 'not_found');
      return toMember(m);
    })

    .get('/members/:handle/posts', async ({ auth, params, query }) => {
      const a = requireSeated(auth);
      const m = await findMember(params.handle);
      if (!m) throw new ApiError(404, 'not_found');
      return listPosts(db, a.user.id, sql`p.author_id = ${m.id}::uuid and p.deleted_at is null and p.hidden_at is null`, query);
    }, { query: pageQuery })

    .get('/notifications', async ({ auth, query }) => {
      const a = requireUser(auth);
      const uid = a.user.id;
      const limit = parseLimit(query.limit);
      const found = await rows<NotifRow>(db, sql`
        select n.id, n.kind, n.created_at::text as cursor_ts,
          to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_iso,
          to_char(n.read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as read_iso,
          u.handle as a_handle, u.display_name as a_display,
          p.id as p_id, coalesce(p.root_id, p.id) as p_root, p.body as p_body, (p.deleted_at is not null) as p_deleted
        from notifications n
        left join users u on u.id = case when n.payload->>'actorId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'actorId')::uuid end
        left join posts p on p.id = case when n.payload->>'postId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'postId')::uuid end
        where n.user_id = ${uid}::uuid ${cursorBefore(sql`n.created_at`, sql`n.id`, query.cursor)}
        order by n.created_at desc, n.id desc
        limit ${limit + 1}`);
      const { page, nextCursor } = paginate(found, limit);
      return {
        items: page.map((r) => ({
          id: r.id, kind: r.kind, createdAt: r.created_iso, readAt: r.read_iso,
          actor: r.a_handle ? { handle: r.a_handle, displayName: r.a_display ?? r.a_handle } : null,
          post: r.p_id
            ? { id: r.p_id, rootId: r.p_root ?? r.p_id, snippet: r.p_deleted ? '' : (r.p_body ?? '').slice(0, 80) }
            : null,
        })),
        nextCursor,
        unreadCount: await unreadCount(db, uid),
      };
    }, { query: pageQuery })

    .get('/notifications/unread-count', async ({ auth }) => {
      const a = requireUser(auth);
      return { unreadCount: await unreadCount(db, a.user.id) };
    })

    .post('/notifications/read', async ({ auth, body }) => {
      const a = requireUser(auth);
      const uid = a.user.id;
      let filter: SQL = sql``;
      if (body?.ids !== undefined) {
        const ids = body.ids.filter((i) => UUID_RE.test(i));
        if (!ids.length) return { ok: true as const, unreadCount: await unreadCount(db, uid) };
        filter = sql`and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;
      }
      await db.execute(sql`update notifications set read_at = now() where user_id = ${uid}::uuid and read_at is null ${filter}`);
      return { ok: true as const, unreadCount: await unreadCount(db, uid) };
    }, { body: t.Optional(t.Object({ ids: t.Optional(t.Array(t.String())) })) });
};
