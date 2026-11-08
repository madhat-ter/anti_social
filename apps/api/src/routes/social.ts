import { Elysia, t } from 'elysia';
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { SEARCH_QUERY_MAX } from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { birthdayCols, cursorBefore, listPosts, paginate, parseLimit, toBirthday, UUID_RE, type Birthday, type Page } from '../lib/posts';
import { authPlugin, requireSeated, requireUser } from '../plugins/auth';
import { consultsSql, isAdult } from '../lib/consultations';

const pageQuery = t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) });
const SEATED = sql`('active', 'flagged_lurker')`;

type MemberSummary = {
  handle: string; displayName: string; bio: string; state: string;
  /** 'ops' = an admin: names carry the OG mark */
  role: string;
  /** RFC §10.7: an admin checked them; the verified badge shows by the name */
  verified: boolean;
  /** shapes the drawn face (RFC §10.3) */
  gender: string | null;
  /** month/day for the "birthday today" tag; null when hidden. Never the year. */
  birthday: Birthday | null;
  /** interest tags (slugs), alphabetical by label */
  interests: string[];
  invitedBy: { handle: string } | null; activatedAt: string | null; postCount: number;
  /** from the portfolio: shown under the name in lists */
  headline: string; openToWork: boolean;
  /** RFC §10.6: takes consultations (only ever true for viewers 18+) */
  consults: boolean;
};
type MemberRow = {
  id: string; cursor_ts: string; handle: string; display_name: string; bio: string; state: string; role: string; gender: string | null; m_bm: number | null; m_bd: number | null; interests: string[] | null; verified: boolean;
  inv_handle: string | null; activated_iso: string | null; post_count: number;
  headline: string | null; open_to_work: boolean | null; consults: boolean;
};

const memberSelect = sql`
  select u.id, coalesce(u.activated_at, u.created_at)::text as cursor_ts,
    u.handle, u.display_name, u.bio, u.state, u.role, u.gender, (u.verified_at is not null) as verified, ${birthdayCols('u', 'm')}, inv.handle as inv_handle,
    to_char(u.activated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as activated_iso,
    (select count(*)::int from posts p where p.author_id = u.id and p.deleted_at is null and p.hidden_at is null) as post_count,
    pf.headline, pf.open_to_work, ${consultsSql('u')} as consults,
    array(select ui.interest from user_interests ui join interests i on i.slug = ui.interest where ui.user_id = u.id order by i.label) as interests
  from users u
  left join users inv on inv.id = u.invited_by
  left join portfolios pf on pf.user_id = u.id`;

const toMember = (r: MemberRow): MemberSummary => ({
  handle: r.handle, displayName: r.display_name, bio: r.bio, state: r.state, role: r.role, verified: !!r.verified, gender: r.gender ?? null, birthday: toBirthday(r.m_bm, r.m_bd), interests: r.interests ?? [],
  invitedBy: r.inv_handle ? { handle: r.inv_handle } : null,
  activatedAt: r.activated_iso, postCount: Number(r.post_count),
  headline: r.headline ?? '', openToWork: !!r.open_to_work, consults: !!r.consults,
});
/** Under-18s never see consultations at all (RFC §10.6). */
const forViewer = (m: MemberSummary, adult: boolean): MemberSummary => (adult ? m : { ...m, consults: false });

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

type NotifRow = {
  id: string; kind: string; cursor_ts: string; created_iso: string; read_iso: string | null;
  a_handle: string | null; a_display: string | null; a_gender: string | null;
  p_id: string | null; p_root: string | null; p_body: string | null; p_deleted: boolean | null;
  e_id: string | null; e_title: string | null;
  /** handle_changed: the new handle; project_removed: the project's title */
  x_to: string | null; x_title: string | null; x_done: string | null; x_total: string | null;
  c_id: string | null; c_title: string | null; x_project: string | null;
  x_consult: string | null; x_topic: string | null; x_pricing: string | null; x_was: string | null;
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
            and (u.handle ilike ${contains} escape '\\' or u.display_name ilike ${contains} escape '\\'
                 or pf.headline ilike ${contains} escape '\\')
          order by (u.handle ilike ${prefix} escape '\\' or u.display_name ilike ${prefix} escape '\\') desc, u.handle
          limit 10`),
      ]);
      return { members: memberRows.map((m) => forViewer(toMember(m), isAdult(a.user))), posts: postPage.items };
    }, { query: t.Object({ q: t.Optional(t.String()) }) })

    .get('/members', async ({ auth, query }): Promise<Page<MemberSummary>> => {
      const a = requireSeated(auth);
      const adult = isAdult(a.user);
      const limit = parseLimit(query.limit);
      const only = adult && query.consults === '1' ? sql`and ${consultsSql('u')}` : sql``;
      const found = await rows<MemberRow>(db, sql`
        ${memberSelect}
        where u.state in ${SEATED} ${only} ${cursorBefore(sql`coalesce(u.activated_at, u.created_at)`, sql`u.id`, query.cursor)}
        order by coalesce(u.activated_at, u.created_at) desc, u.id desc
        limit ${limit + 1}`);
      const { page, nextCursor } = paginate(found, limit);
      return { items: page.map((m) => forViewer(toMember(m), adult)), nextCursor };
    }, { query: t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()), consults: t.Optional(t.String()) }) })

    // The room's size: the seat cap is a setting admins can change, so the charts ask for it.
    .get('/seats', async ({ auth }) => {
      requireSeated(auth);
      const [r] = await rows<{ cap: number; used: number }>(db, sql`select setting_int('seat_cap') as cap, seats_used() as used`);
      return { cap: Number(r!.cap), used: Number(r!.used) };
    })

    .get('/members/:handle', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const m = await findMember(params.handle);
      if (!m) throw new ApiError(404, 'not_found');
      return forViewer(toMember(m), isAdult(a.user));
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
          u.handle as a_handle, u.display_name as a_display, u.gender as a_gender,
          p.id as p_id, coalesce(p.root_id, p.id) as p_root, p.body as p_body, (p.deleted_at is not null) as p_deleted,
          ev.id as e_id, ev.title as e_title,
          n.payload->>'to' as x_to, n.payload->>'title' as x_title, n.payload->>'done' as x_done, n.payload->>'total' as x_total,
          co.id as c_id, coalesce(co.title, n.payload->>'title') as c_title, n.payload->>'projectId' as x_project,
          n.payload->>'consultationId' as x_consult, n.payload->>'topic' as x_topic, n.payload->>'pricing' as x_pricing, n.payload->>'was' as x_was
        from notifications n
        left join users u on u.id = case when n.payload->>'actorId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'actorId')::uuid end
        left join posts p on p.id = case when n.payload->>'postId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'postId')::uuid end
        left join events ev on ev.id = case when n.payload->>'eventId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'eventId')::uuid end
        left join collabs co on co.id = case when n.payload->>'collabId' ~ '^[0-9a-f-]{36}$' then (n.payload->>'collabId')::uuid end and co.deleted_at is null
        where n.user_id = ${uid}::uuid ${cursorBefore(sql`n.created_at`, sql`n.id`, query.cursor)}
        order by n.created_at desc, n.id desc
        limit ${limit + 1}`);
      const { page, nextCursor } = paginate(found, limit);
      return {
        items: page.map((r) => ({
          id: r.id, kind: r.kind, createdAt: r.created_iso, readAt: r.read_iso,
          actor: r.a_handle ? { handle: r.a_handle, displayName: r.a_display ?? r.a_handle, gender: r.a_gender ?? null } : null,
          post: r.p_id
            ? { id: r.p_id, rootId: r.p_root ?? r.p_id, snippet: r.p_deleted ? '' : (r.p_body ?? '').slice(0, 80) }
            : null,
          event: r.e_id ? { id: r.e_id, title: r.e_title ?? '' } : null,
          collab: r.c_id ? { id: r.c_id, title: r.c_title ?? '' } : null,
          draftId: r.kind === 'collab_finished' ? r.x_project : null,
          collabTitle: r.kind === 'collab_removed' ? r.x_title : null,
          newHandle: r.kind === 'handle_changed' ? r.x_to : null,
          projectTitle: r.kind === 'project_removed' ? r.x_title : null,
          pickTitle: r.kind === 'pick_remark' || r.kind === 'remark_removed' ? r.x_title : null,
          consultation: r.x_consult ? { id: r.x_consult, topic: r.x_topic ?? '', pricing: r.x_pricing, was: r.x_was } : null,
          checklist: r.kind === 'checklist_reminder' ? { done: Number(r.x_done ?? 0), total: Number(r.x_total ?? 5) } : null,
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
