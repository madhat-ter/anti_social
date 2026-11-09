import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { EDIT_WINDOW_MINUTES, PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT } from '@anti/shared';
import { ApiError } from './errors';

/** `role` 'ops' = an admin: the app shows an "admin" tag by the name. */
/** `birthday`: month and day only, and only when they show it (RFC §10.3); never the year. */
export type Birthday = { month: number; day: number };
/** erified: an admin checked them (RFC §10.7); the badge shows by the name */
export type Author = { handle: string; displayName: string; state: string; role?: string; gender?: string | null; birthday?: Birthday | null; verified?: boolean; isNew?: boolean };

/** SQL for a person's shown birthday: month/day columns, null unless public. `u` = the users alias. */
export const birthdayCols = (u: string, prefix: string) => sql.raw(
  `case when ${u}.birthday_public then extract(month from ${u}.birthday)::int end as ${prefix}_bm, `
  + `case when ${u}.birthday_public then extract(day from ${u}.birthday)::int end as ${prefix}_bd`);
export const toBirthday = (m: unknown, d: unknown): Birthday | null =>
  (m === null || m === undefined || d === null || d === undefined ? null : { month: Number(m), day: Number(d) });
export type Image = { id: string; url: string; width: number; height: number };
export type Post = {
  id: string; body: string; createdAt: string; editedAt: string | null; deleted: boolean;
  author: Author | null; parentId: string | null; rootId: string | null;
  replyCount: number;
  /** only the author ever gets the number (RFC §10.11): for everyone else it is null */
  likeCount: number | null;
  likedByMe: boolean; images: Image[];
  /** the author's first post on the feed (not counting collab or event updates) */
  firstPost: boolean;
  /** replies only: the post at the top of the thread, for "Replied to Mina's post: …" */
  replyTo: { rootId: string; author: { handle: string; displayName: string } | null; snippet: string } | null;
  canEdit: boolean; canDelete: boolean; canReport: boolean;
  /** the viewer is an admin and can remove this post (someone else's) */
  canModerate: boolean;
  /** hidden after reports: only ever true for an admin reviewing it (everyone else never gets it) */
  hidden: boolean;
  /** an update in this collab's thread (RFC §10.5) */
  collab: { id: string; title: string } | null;
  /** an update on this event's page; null when the viewer cannot see the event (team-only meetups) */
  event: { id: string; title: string } | null;
};
export type Page<T> = { items: T[]; nextCursor: string | null };

export const mediaUrl = (key: string) => `/api/media/${key}`;

// ─── Cursors: opaque keyset on (timestamp-as-text, id) ──────────────────────

export const TS_RE = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:?\d\d)?|Z)?$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeCursor = (ts: string, id: string) => Buffer.from(`${ts}|${id}`).toString('base64url');

export function decodeCursor(c: string | undefined): { ts: string; id: string } | null {
  if (!c) return null;
  const [ts, id, ...rest] = Buffer.from(c, 'base64url').toString().split('|');
  if (rest.length || !ts || !id || !TS_RE.test(ts) || !UUID_RE.test(id)) throw new ApiError(400, 'cursor_invalid');
  return { ts, id };
}

export function parseLimit(v: string | undefined): number {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return PAGE_DEFAULT_LIMIT;
  return Math.min(n, PAGE_MAX_LIMIT);
}

/** `and (<tsCol>, <idCol>) < (cursor)` — empty when there is no cursor. */
export function cursorBefore(tsCol: SQL, idCol: SQL, cursor: string | undefined): SQL {
  const c = decodeCursor(cursor);
  return c ? sql`and (${tsCol}, ${idCol}) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``;
}

/** Trim the extra probe row and compute the next cursor. */
export function paginate<T extends { cursor_ts: string; id: string }>(
  found: T[], limit: number,
): { page: T[]; nextCursor: string | null } {
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: found.length > limit && last ? encodeCursor(last.cursor_ts, last.id) : null };
}

// ─── Post rows ──────────────────────────────────────────────────────────────

const iso = (col: SQL) =>
  sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Base SELECT for posts. Callers append `where ... order by ... limit ...`.
 * Aggregates (reply/like counts, likedByMe, images) are inline subqueries, so a page is one query.
 */
export function postSelect(viewerId: string): SQL {
  return sql`
    select p.id, p.body, p.created_at::text as cursor_ts,
      ${iso(sql`p.created_at`)} as created_iso, ${iso(sql`p.edited_at`)} as edited_iso,
      (p.deleted_at is not null) as is_deleted, (p.hidden_at is not null) as is_hidden, p.parent_id, p.root_id, p.author_id,
      u.handle as a_handle, u.display_name as a_display, u.state as a_state, u.role as a_role, u.gender as a_gender, (u.verified_at is not null) as a_verified, ${birthdayCols('u', 'a')},
      -- "new here" uses the lurker rule's own window, so the feed and the rule share one meaning of new
      coalesce(u.activated_at > now() - days('new_member_exempt_days'), false) as a_new,
      -- a first post is news for three weeks; after that it is just a post (no badge, no "Say hello")
      (p.parent_id is null and p.collab_id is null and p.event_id is null and p.deleted_at is null
       and p.created_at > now() - days('new_member_exempt_days') and not exists (
         select 1 from posts q
          where q.author_id = p.author_id and q.parent_id is null and q.collab_id is null and q.event_id is null
            and q.deleted_at is null and (q.created_at, q.id) < (p.created_at, p.id))) as first_post,
      exists(select 1 from users v where v.id = ${viewerId}::uuid and v.role = 'ops') as viewer_ops,
      case when p.root_id is null
        then (select count(*)::int from posts r where r.root_id = p.id and r.deleted_at is null and r.hidden_at is null)
        else (select count(*)::int from posts r where r.parent_id = p.id and r.deleted_at is null and r.hidden_at is null)
      end as reply_count,
      (select count(*)::int from likes l where l.post_id = p.id) as like_count,
      exists(select 1 from likes l where l.post_id = p.id and l.user_id = ${viewerId}::uuid) as liked_by_me,
      coalesce((select json_agg(json_build_object('id', i.id, 'key', i.r2_key, 'width', i.width, 'height', i.height)
                                order by i.position) from post_images i where i.post_id = p.id), '[]'::json) as images,
      -- a reply says what it answers when it shows outside its thread (profile lists, search)
      ru.handle as ra_handle, ru.display_name as ra_display, (ru.state = 'deleted') as ra_gone,
      case when rp.deleted_at is null and rp.hidden_at is null then left(rp.body, 80) else '' end as r_snippet,
      pc.id as pc_id, pc.title as pc_title, pe.id as pe_id, pe.title as pe_title,
      (pe.audience = 'anyone' or exists(select 1 from collab_members m where m.collab_id = pe.collab_id and m.user_id = ${viewerId}::uuid)) as pe_visible
    from posts p
    left join users u on u.id = p.author_id
    left join posts rp on rp.id = p.root_id
    left join users ru on ru.id = rp.author_id
    left join collabs pc on pc.id = p.collab_id and pc.deleted_at is null
    left join events pe on pe.id = p.event_id`;
}

export type PostRow = {
  id: string; body: string; cursor_ts: string; created_iso: string; edited_iso: string | null;
  is_deleted: boolean; is_hidden?: boolean | null; parent_id: string | null; root_id: string | null; author_id: string | null;
  a_handle: string | null; a_display: string | null; a_state: string | null; a_role?: string | null; a_gender?: string | null; a_bm?: number | null; a_bd?: number | null; a_verified?: boolean | null;
  a_new?: boolean | null; first_post?: boolean | null;
  ra_handle?: string | null; ra_display?: string | null; ra_gone?: boolean | null; r_snippet?: string | null;
  viewer_ops?: boolean | null;
  reply_count: number; like_count: number; liked_by_me: boolean;
  images: Array<{ id: string; key: string; width: number; height: number }> | string;
  pc_id?: string | null; pc_title?: string | null; pe_id?: string | null; pe_title?: string | null; pe_visible?: boolean | null;
};

export function toPost(r: PostRow, viewerId: string): Post {
  const deleted = !!r.is_deleted;
  const imgs = typeof r.images === 'string' ? (JSON.parse(r.images) as Exclude<PostRow['images'], string>) : r.images;
  const mine = r.author_id === viewerId;
  const withinWindow = Date.now() - new Date(r.created_iso).getTime() <= EDIT_WINDOW_MINUTES * 60_000;
  const author: Author | null =
    r.a_handle && r.a_state && r.a_state !== 'deleted'
      ? { handle: r.a_handle, displayName: r.a_display ?? r.a_handle, state: r.a_state, role: r.a_role ?? 'member', gender: r.a_gender ?? null, birthday: toBirthday(r.a_bm, r.a_bd), verified: !!r.a_verified, isNew: !!r.a_new }
      : null;
  return {
    id: r.id,
    body: deleted ? '' : r.body,
    createdAt: r.created_iso,
    editedAt: r.edited_iso,
    deleted,
    author,
    parentId: r.parent_id,
    rootId: r.root_id,
    replyCount: Number(r.reply_count),
    // likes never move a post and never show as a score to others: the count is the author's alone
    likeCount: mine ? Number(r.like_count) : null,
    likedByMe: !!r.liked_by_me,
    firstPost: !deleted && !!r.first_post && !!author,
    replyTo: r.root_id
      ? {
        rootId: r.root_id,
        author: r.ra_handle && !r.ra_gone ? { handle: r.ra_handle, displayName: r.ra_display ?? r.ra_handle } : null,
        snippet: r.r_snippet ?? '',
      }
      : null,
    images: deleted ? [] : imgs.map((i) => ({ id: i.id, url: mediaUrl(i.key), width: i.width, height: i.height })),
    canEdit: mine && !deleted && withinWindow,
    canDelete: mine && !deleted,
    canReport: !mine && !deleted,
    canModerate: !!r.viewer_ops && !mine && !deleted,
    hidden: !!r.is_hidden,
    collab: r.pc_id ? { id: r.pc_id, title: r.pc_title ?? '' } : null,
    event: r.pe_id && r.pe_visible ? { id: r.pe_id, title: r.pe_title ?? '' } : null,
  };
}

/** A keyset-paginated list of posts. `where` is a condition on p/u (without the `where` keyword). */
export async function listPosts(
  db: Db, viewerId: string, where: SQL, opts: { cursor?: string; limit?: string },
): Promise<Page<Post>> {
  const limit = parseLimit(opts.limit);
  const found = await rows<PostRow>(db, sql`
    ${postSelect(viewerId)}
    where ${where} ${cursorBefore(sql`p.created_at`, sql`p.id`, opts.cursor)}
    order by p.created_at desc, p.id desc
    limit ${limit + 1}`);
  const { page, nextCursor } = paginate(found, limit);
  return { items: page.map((r) => toPost(r, viewerId)), nextCursor };
}

export async function getPost(db: Db, viewerId: string, id: string): Promise<Post | null> {
  if (!UUID_RE.test(id)) return null;
  const [r] = await rows<PostRow>(db, sql`${postSelect(viewerId)} where p.id = ${id}::uuid and p.hidden_at is null`);
  return r ? toPost(r, viewerId) : null;
}
