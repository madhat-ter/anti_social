/**
 * RFC §10.11, the feed. It stays newest first and is never ranked; this file adds the display
 * rules around it: a frozen "new since" line per visit, an end that says you are caught up, and
 * the visit log the owner reads to see whether members get through it.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { FEED } from '@anti/shared';
import { ApiError } from './errors';
import { TS_RE } from './posts';

/** The feed's filter: root posts on nobody's collab or event page, not deleted, not hidden. */
export const FEED_WHERE = (p = 'p'): SQL => sql.raw(
  `${p}.parent_id is null and ${p}.deleted_at is null and ${p}.hidden_at is null and ${p}.collab_id is null and ${p}.event_id is null`);

const iso = (col: SQL) => sql`to_char((${col}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export type FeedVisit = {
  /** the frozen line: posts newer than this are "new since" */
  since: string;
  /** the line sits at the oldest it may (a week back), i.e. nothing was ever caught up to */
  capped: boolean;
  /** posts by others waiting above the line */
  newPosts: number;
  /** null for visitors: they leave no trace */
  visitId: number | null;
  /** older posts that drew a conversation while you were away (one row each, at the latest reply) */
  threads: ThreadRow[];
  /** public events announced since the line */
  events: EventRow[];
  /** the end card's one event: one you are going to first, else the soonest you can see */
  nextEvent: NextEvent | null;
};

type Person = { handle: string; displayName: string; gender: string | null };
export type ThreadRow = { rootId: string; at: string; repliers: number; postedAt: string; author: Person | null };
export type EventRow = { id: string; at: string; title: string; startsAt: string; going: number; joinMode: string; host: Person | null };
export type NextEvent = { id: string; title: string; startsAt: string; going: number; imGoing: boolean };

const person = (h: string | null, d: string | null, g: string | null): Person | null =>
  (h ? { handle: h, displayName: d ?? h, gender: g } : null);

/**
 * What sits around the posts for one line (`since`), computed when the visit starts or resumes.
 * Rows are events in time and never move a post: a conversation row stands at its newest reply.
 * The guards come from the small sites that rank (see the RFC): no self-replies, only replies
 * within 72 hours of the post, at least two distinct other people, counted from replies that still
 * exist (so reply-then-delete cannot keep a row).
 */
async function around(db: Db, viewerId: string, since: string) {
  const threads = await rows<{ root_id: string; at: string; repliers: number; posted: string; h: string | null; d: string | null; g: string | null }>(db, sql`
    select r0.id as root_id, ${iso(sql`max(r.created_at)`)} as at, count(distinct r.author_id)::int as repliers,
           ${iso(sql`r0.created_at`)} as posted, u.handle as h, u.display_name as d, u.gender::text as g
      from posts r0
      join posts r on r.root_id = r0.id
      left join users u on u.id = r0.author_id and u.state <> 'deleted'
     where ${FEED_WHERE('r0')}
       and r0.created_at <= ${since}::timestamptz
       and r0.created_at > ${since}::timestamptz - make_interval(hours => ${FEED.threadWindowHours}::int)
       and r0.author_id is distinct from ${viewerId}::uuid
       and r.created_at > ${since}::timestamptz
       and r.created_at < r0.created_at + make_interval(hours => ${FEED.threadWindowHours}::int)
       and r.deleted_at is null and r.hidden_at is null
       and r.author_id is not null
       and r.author_id is distinct from r0.author_id
       and r.author_id <> ${viewerId}::uuid
     group by r0.id, r0.created_at, u.handle, u.display_name, u.gender
    having count(distinct r.author_id) >= ${FEED.threadMinRepliers}::int
     order by max(r.created_at) desc
     limit 20`);
  const events = await rows<{ id: string; at: string; title: string; starts: string; going: number; join_mode: string; h: string | null; d: string | null; g: string | null }>(db, sql`
    select e.id, ${iso(sql`e.created_at`)} as at, e.title, ${iso(sql`e.starts_at`)} as starts, e.join_mode,
           (select count(*)::int from event_rsvps v where v.event_id = e.id and v.status = 'going') as going,
           u.handle as h, u.display_name as d, u.gender::text as g
      from events e
      join users u on u.id = e.host_id and u.state in ('active', 'flagged_lurker')
      left join collabs c on c.id = e.collab_id and c.deleted_at is null
     where e.created_at > ${since}::timestamptz and e.cancelled_at is null and e.starts_at > now()
       and e.audience = 'anyone' and (e.collab_id is null or c.id is not null)
       and e.host_id <> ${viewerId}::uuid
     order by e.created_at desc
     limit 10`);
  const [next] = await rows<{ id: string; title: string; starts: string; going: number; mine: boolean }>(db, sql`
    select e.id, e.title, ${iso(sql`e.starts_at`)} as starts, (v.user_id is not null) as mine,
           (select count(*)::int from event_rsvps g where g.event_id = e.id and g.status = 'going') as going
      from events e
      left join event_rsvps v on v.event_id = e.id and v.user_id = ${viewerId}::uuid and v.status = 'going'
      left join collabs c on c.id = e.collab_id and c.deleted_at is null
     where e.cancelled_at is null and e.starts_at > now() and e.starts_at < now() + interval '14 days'
       and (e.collab_id is null or c.id is not null)
       and (e.audience = 'anyone'
            or exists (select 1 from collab_members m where m.collab_id = e.collab_id and m.user_id = ${viewerId}::uuid))
     order by (v.user_id is not null) desc, e.starts_at asc
     limit 1`);
  return {
    threads: threads.map((t) => ({ rootId: t.root_id, at: t.at, repliers: Number(t.repliers), postedAt: t.posted, author: person(t.h, t.d, t.g) })),
    events: events.map((e) => ({ id: e.id, at: e.at, title: e.title, startsAt: e.starts, going: Number(e.going), joinMode: e.join_mode, host: person(e.h, e.d, e.g) })),
    nextEvent: next ? { id: next.id, title: next.title, startsAt: next.starts, going: Number(next.going), imGoing: !!next.mine } : null,
  };
}

const windowStart = sql`(now() - make_interval(days => ${FEED.newWindowDays}::int))`;

/**
 * Starts a visit: reads where the member left off (never further back than a week), counts what
 * is waiting and logs the visit. A visitor gets the week, and no row is written.
 */
export async function startVisit(db: Db, viewerId: string, visitor: boolean): Promise<FeedVisit> {
  if (visitor) {
    const [r] = await rows<{ since: string; n: number }>(db, sql`
      select ${iso(windowStart)} as since,
             (select count(*)::int from posts p where ${FEED_WHERE()} and p.created_at > ${windowStart}) as n`);
    return { since: r!.since, capped: true, newPosts: Number(r!.n), visitId: null, ...(await around(db, viewerId, r!.since)) };
  }
  const [r] = await rows<{ id: number; since: string; new_posts: number; capped: boolean }>(db, sql`
    with me as (
      select greatest(coalesce(feed_seen_through, '-infinity'::timestamptz), ${windowStart}) as since,
             coalesce(feed_seen_through, '-infinity'::timestamptz) <= ${windowStart} as capped
        from users where id = ${viewerId}::uuid
    ), n as (
      select count(*)::int as new_posts from posts p, me
       where ${FEED_WHERE()} and p.created_at > me.since and p.author_id is distinct from ${viewerId}::uuid
    ), v as (
      insert into feed_visits (user_id, since, new_posts)
      select ${viewerId}::uuid, me.since, n.new_posts from me, n
      returning id, since, new_posts
    )
    select v.id, ${iso(sql`v.since`)} as since, v.new_posts, me.capped from v, me`);
  if (!r) throw new ApiError(404, 'not_found');
  return { since: r.since, capped: !!r.capped, newPosts: Number(r.new_posts), visitId: Number(r.id), ...(await around(db, viewerId, r.since)) };
}

/**
 * The same visit after a reload: the browser keeps the frozen line, the server only clamps it
 * (never older than a week, never in the future) and recounts.
 */
export async function resumeVisit(db: Db, viewerId: string, since: string): Promise<FeedVisit> {
  if (!TS_RE.test(since)) throw new ApiError(400, 'bad_request', 'since must be a timestamp.');
  const [r] = await rows<{ since: string; capped: boolean; n: number }>(db, sql`
    with s as (select least(greatest(${since}::timestamptz, ${windowStart}), now()) as since)
    select ${iso(sql`s.since`)} as since, s.since <= ${windowStart} as capped,
           (select count(*)::int from posts p
             where ${FEED_WHERE()} and p.created_at > s.since and p.author_id is distinct from ${viewerId}::uuid) as n
      from s`);
  return { since: r!.since, capped: !!r!.capped, newPosts: Number(r!.n), visitId: null, ...(await around(db, viewerId, r!.since)) };
}

/**
 * The end card was on screen: the member read through `through` (the newest post in their list).
 * Clamped to now, so a forged future time cannot hide tomorrow's posts, and only ever forward.
 */
export async function markCaughtUp(db: Db, viewerId: string, through: string, visitId: number | undefined) {
  if (!TS_RE.test(through)) throw new ApiError(400, 'bad_request', 'through must be a timestamp.');
  await db.execute(sql`
    update users
       set feed_seen_through = greatest(coalesce(feed_seen_through, '-infinity'::timestamptz), least(${through}::timestamptz, now()))
     where id = ${viewerId}::uuid`);
  if (visitId !== undefined && Number.isSafeInteger(visitId)) {
    await db.execute(sql`
      update feed_visits set caught_up_at = coalesce(caught_up_at, now())
       where id = ${visitId} and user_id = ${viewerId}::uuid`);
  }
  const [r] = await rows<{ t: string | null }>(db, sql`select ${iso(sql`feed_seen_through`)} as t from users where id = ${viewerId}::uuid`);
  return { seenThrough: r?.t ?? null };
}
