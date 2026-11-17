/**
 * RFC §10.21: one place. Events and collabs (activities and projects) come back as one list, ordered
 * by when they were started, newest first; the "Yours" strip and a member's hosted events live here
 * too. The rules themselves stay in lib/events.ts and lib/collabs.ts.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { encodeCursor, parseLimit, UUID_RE } from './posts';
import { eventSelect, eventVisible, toEvent, upcomingCond, type EventRow, type EventView } from './events';
import { listCollabs, type CollabSummary } from './collabs';
import { ApiError } from './errors';

export type Kind = 'event' | 'activity' | 'project';
export type PageItem =
  | ({ type: 'event' } & EventView & { createdAt: string })
  | ({ type: 'collab' } & CollabSummary);

export type WaitingOn = { type: Kind; id: string; title: string; count: number };

const eventItem = (r: EventRow, me: string): PageItem => ({ type: 'event', ...toEvent(r, me), createdAt: r.created_iso });
const collabItem = (c: CollabSummary): PageItem => ({ type: 'collab', ...c });

/** Newest started first; a tie falls back to the id, so the cursor never skips or repeats. */
const newestFirst = (a: PageItem, b: PageItem) => {
  const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return d !== 0 ? d : b.id.localeCompare(a.id);
};

/**
 * `GET /collab`: events and collabs in one list. `kind` filters; `interest` matches the tags;
 * `done=1` is the foot of the page (past events, finished and ended things) and `done=0` the rest.
 */
export async function collabPage(db: Db, me: string, q: { kind?: 'all' | Kind; interest?: string; done: boolean; cursor?: string; limit?: string }) {
  const limit = parseLimit(q.limit);
  const c = q.cursor ? decodeOrNull(q.cursor) : null;
  const wantsEvents = !q.kind || q.kind === 'all' || q.kind === 'event';
  const wantsCollabs = !q.kind || q.kind === 'all' || q.kind === 'activity' || q.kind === 'project';

  const events = wantsEvents
    ? (await rows<EventRow>(db, sql`
        ${eventSelect(me)}
        where e.cancelled_at is null and ${eventVisible(me)}
          and ${q.done ? sql`not ${upcomingCond}` : upcomingCond}
          ${q.interest ? sql`and exists (select 1 from event_interests ei where ei.event_id = e.id and ei.interest = ${q.interest})` : sql``}
          ${c ? sql`and (e.created_at, e.id) < (${c.ts}::timestamptz, ${c.id}::uuid)` : sql``}
        order by e.created_at desc, e.id desc limit ${limit + 1}`)).map((r) => eventItem(r, me))
    : [];

  const collabs = wantsCollabs
    ? (await listCollabs(db, me, {
        tab: 'all', interest: q.interest,
        kind: q.kind === 'activity' || q.kind === 'project' ? q.kind : undefined,
      }))
      .filter((x) => (q.done ? x.status === 'finished' : x.status !== 'finished'))
      .filter((x) => !c || Date.parse(x.createdAt) < Date.parse(c.ts) || (Date.parse(x.createdAt) === Date.parse(c.ts) && x.id < c.id))
      .map(collabItem)
    : [];

  const merged = [...events, ...collabs].sort(newestFirst);
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: merged.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

function decodeOrNull(cursor: string) {
  // decodeCursor throws cursor_invalid on nonsense; the page just starts over instead
  try {
    const [ts, id, ...rest] = Buffer.from(cursor, 'base64url').toString().split('|');
    if (rest.length || !ts || !id || Number.isNaN(Date.parse(ts)) || !UUID_RE.test(id)) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

/** One row of the admin's Collab list: every event, activity and project, newest started first. */
export type AdminCollabItem = {
  type: 'event' | 'activity' | 'project';
  id: string; title: string; host: string | null;
  createdAt: string;
  /** events only */
  startsAt: string | null;
  /** collabs only: recruiting | closed | finished */
  status: string | null;
  /** a cancelled event, or a collab hidden after reports */
  flagged: boolean;
};

/**
 * RFC §10.21: an admin's own list of everything in Collab, including what is hidden after reports,
 * cancelled events and team-only meetups — the place to reach for Remove when something has to go.
 */
export async function adminCollab(db: Db): Promise<AdminCollabItem[]> {
  const ts = (col: string) => sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
  const found = await rows<{
    type: 'event' | 'activity' | 'project'; id: string; title: string; host: string | null;
    created_iso: string; starts_iso: string | null; status: string | null; flagged: boolean;
  }>(db, sql`
    select 'event' as type, e.id, e.title, u.handle as host,
           ${ts('e.created_at')} as created_iso, ${ts('e.starts_at')} as starts_iso,
           null::text as status, (e.cancelled_at is not null) as flagged
      from events e join users u on u.id = e.host_id
     union all
    select c.kind as type, c.id, c.title, h.handle as host,
           ${ts('c.created_at')} as created_iso, null::text as starts_iso, c.status,
           (c.hidden_at is not null) as flagged
      from collabs c
      left join collab_members hm on hm.collab_id = c.id and hm.role = 'host'
      left join users h on h.id = hm.user_id
     where c.deleted_at is null
     order by created_iso desc, title limit 300`);
  return found.map((r) => ({
    type: r.type, id: r.id, title: r.title, host: r.host, createdAt: r.created_iso,
    startsAt: r.starts_iso, status: r.status, flagged: !!r.flagged,
  }));
}

/** "Yours" strip... */

export async function myCollab(db: Db, me: string) {
  const hosted = await rows<EventRow>(db, sql`
    ${eventSelect(me)}
    where e.cancelled_at is null and ${eventVisible(me)} and ${upcomingCond}
      and (e.host_id = ${me}::uuid or exists (select 1 from event_hosts h where h.event_id = e.id and h.user_id = ${me}::uuid))
    order by e.starts_at asc limit 20`);
  const going = await rows<EventRow>(db, sql`
    ${eventSelect(me)}
    where e.cancelled_at is null and ${eventVisible(me)} and ${upcomingCond}
      and me.status in ('going', 'waitlisted')
    order by e.starts_at asc limit 20`);
  const collabs = await listCollabs(db, me, { tab: 'all' });
  const open = collabs.filter((c) => c.status !== 'finished');
  const waiting = await rows<{ type: Kind; id: string; title: string; count: number }>(db, sql`
    select c.kind as type, c.id, c.title, count(*)::int as count
      from collab_requests r join collabs c on c.id = r.collab_id and c.deleted_at is null
     where r.status = 'pending'
       and exists (select 1 from collab_members m where m.collab_id = c.id and m.user_id = ${me}::uuid and m.role in ('host', 'cohost'))
     group by c.kind, c.id, c.title
    union all
    select 'event' as type, e.id, e.title, count(*)::int as count
      from event_requests q join events e on e.id = q.event_id
     where q.status = 'pending' and e.cancelled_at is null
       and (e.host_id = ${me}::uuid or exists (select 1 from event_hosts h where h.event_id = e.id and h.user_id = ${me}::uuid))
     group by e.id, e.title`);
  return {
    hosting: [
      ...hosted.map((r) => eventItem(r, me)),
      ...open.filter((c) => c.my.role === 'host' || c.my.role === 'cohost').map(collabItem),
    ].sort(newestFirst),
    in: open.filter((c) => c.my.role === 'member').map(collabItem).sort(newestFirst),
    going: going.map((r) => eventItem(r, me)),
    waiting: waiting.map((w) => ({ type: w.type, id: w.id, title: w.title, count: Number(w.count) })),
  };
}

/** `GET /members/:handle/events`: the events that person hosts (not the ones they only go to). */
export async function memberEvents(db: Db, viewer: string, handle: string) {
  const [u] = await rows<{ id: string }>(db, sql`
    select id from users where lower(handle) = lower(${handle}) and state in ('active', 'flagged_lurker')`);
  if (!u) throw new ApiError(404, 'not_found');
  const upcoming = await rows<EventRow>(db, sql`
    ${eventSelect(viewer)}
    where e.host_id = ${u.id}::uuid and e.cancelled_at is null and ${eventVisible(viewer)} and ${upcomingCond}
    order by e.starts_at asc limit 20`);
  const past = await rows<EventRow>(db, sql`
    ${eventSelect(viewer)}
    where e.host_id = ${u.id}::uuid and e.cancelled_at is null and ${eventVisible(viewer)} and not ${upcomingCond}
    order by e.starts_at desc limit 10`);
  return { upcoming: upcoming.map((r) => toEvent(r, viewer)), past: past.map((r) => toEvent(r, viewer)) };
}
