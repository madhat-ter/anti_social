/**
 * RFC §10.21, "nothing waits forever": the hourly sweep. A request nobody answers is reminded about
 * at three days and closed at seven (telling the person it was not answered in time, never that they
 * were declined); a project quiet for three weeks (or an activity for six) asks its host once what to
 * do with it. Idempotent like every job: running it twice sends nothing twice.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { QUIET_ACTIVITY_DAYS, QUIET_PROJECT_DAYS, REQUEST_EXPIRE_DAYS, REQUEST_REMIND_DAYS } from '@anti/shared';

export async function sweepCollabs(tx: Db) {
  // 1. a reminder to whoever decides, once per request
  const collabReminders = await rows<{ sent: number }>(tx, sql`
    with due as (
      select c.id, c.title, count(*)::int as n, array_agg(distinct m.user_id) as managers
        from collab_requests r
        join collabs c on c.id = r.collab_id and c.deleted_at is null
        join collab_members m on m.collab_id = c.id and m.role in ('host', 'cohost')
       where r.status = 'pending' and r.reminded_at is null
         and r.created_at <= now() - make_interval(days => ${REQUEST_REMIND_DAYS})
       group by c.id, c.title
    ), ins as (
      insert into notifications (user_id, kind, payload)
      select unnest(d.managers), 'requests_waiting',
             jsonb_build_object('collabId', d.id, 'title', d.title, 'count', d.n)
        from due d returning 1
    ), mark as (
      update collab_requests r set reminded_at = now()
        from due d where r.collab_id = d.id and r.status = 'pending' and r.reminded_at is null
        returning 1
    )
    select (select count(*)::int from ins) as sent`);
  const eventReminders = await rows<{ sent: number }>(tx, sql`
    with due as (
      select e.id, e.title, count(*)::int as n,
             array_agg(distinct u.user_id) as managers
        from event_requests q
        join events e on e.id = q.event_id
        cross join lateral (
          select e.host_id as user_id union select h.user_id from event_hosts h where h.event_id = e.id
        ) u
       where q.status = 'pending' and q.reminded_at is null
         and q.created_at <= now() - make_interval(days => ${REQUEST_REMIND_DAYS})
       group by e.id, e.title
    ), ins as (
      insert into notifications (user_id, kind, payload)
      select unnest(d.managers), 'requests_waiting',
             jsonb_build_object('eventId', d.id, 'title', d.title, 'count', d.n)
        from due d returning 1
    ), mark as (
      update event_requests q set reminded_at = now()
        from due d where q.event_id = d.id and q.status = 'pending' and q.reminded_at is null
        returning 1
    )
    select (select count(*)::int from ins) as sent`);

  // 2. at seven days a request closes, and the person is told it was not answered in time
  const collabExpired = await rows<{ n: number }>(tx, sql`
    with due as (
      select r.collab_id, r.user_id, c.title
        from collab_requests r join collabs c on c.id = r.collab_id and c.deleted_at is null
       where r.status = 'pending' and r.created_at <= now() - make_interval(days => ${REQUEST_EXPIRE_DAYS})
    ), ins as (
      insert into notifications (user_id, kind, payload)
      select d.user_id, 'request_expired', jsonb_build_object('collabId', d.collab_id, 'title', d.title)
        from due d returning 1
    ), upd as (
      update collab_requests r set status = 'expired', decided_at = now()
        from due d where r.collab_id = d.collab_id and r.user_id = d.user_id and r.status = 'pending'
        returning 1
    )
    select (select count(*)::int from upd) as n`);
  const eventExpired = await rows<{ n: number }>(tx, sql`
    with due as (
      select q.event_id, q.user_id, e.title
        from event_requests q join events e on e.id = q.event_id
       where q.status = 'pending'
         and (q.created_at <= now() - make_interval(days => ${REQUEST_EXPIRE_DAYS}) or now() >= e.starts_at)
    ), ins as (
      insert into notifications (user_id, kind, payload)
      select d.user_id, 'request_expired', jsonb_build_object('eventId', d.event_id, 'title', d.title)
        from due d returning 1
    ), upd as (
      update event_requests q set status = 'expired', decided_at = now()
        from due d where q.event_id = d.event_id and q.user_id = d.user_id and q.status = 'pending'
        returning 1
    )
    select (select count(*)::int from upd) as n`);

  // 3. a quiet thing asks its host once: finish it, keep going, or close?
  const nudged = await rows<{ n: number }>(tx, sql`
    with last as (
      select c.id, c.title, c.kind,
        greatest(c.updated_at,
          coalesce((select max(p.created_at) from posts p where p.collab_id = c.id and p.deleted_at is null), '-infinity'::timestamptz),
          coalesce((select max(m.joined_at) from collab_members m where m.collab_id = c.id), '-infinity'::timestamptz),
          coalesce((select max(e.created_at) from events e where e.collab_id = c.id), '-infinity'::timestamptz)
        ) as last_at
        from collabs c
       where c.deleted_at is null and c.hidden_at is null
         and ((c.kind = 'project' and c.status in ('recruiting', 'closed')) or (c.kind = 'activity' and c.status = 'recruiting'))
    ), due as (
      select l.id, l.title, l.kind, (select m.user_id from collab_members m where m.collab_id = l.id and m.role = 'host') as host
        from last l
       where l.last_at < now() - make_interval(days => (case when l.kind = 'activity' then ${QUIET_ACTIVITY_DAYS}::int else ${QUIET_PROJECT_DAYS}::int end))
         and exists (select 1 from collab_members m where m.collab_id = l.id and m.role = 'host')
         and not exists (select 1 from collabs c where c.id = l.id and c.quiet_nudged_at is not null and c.quiet_nudged_at >= l.last_at)
    ), ins as (
      insert into notifications (user_id, kind, payload)
      select d.host, 'collab_quiet', jsonb_build_object('collabId', d.id, 'title', d.title, 'kind', d.kind)
        from due d returning 1
    ), mark as (
      update collabs c set quiet_nudged_at = now()
        from due d where c.id = d.id returning 1
    )
    select (select count(*)::int from mark) as n`);

  return {
    reminded: (collabReminders[0]?.sent ?? 0) + (eventReminders[0]?.sent ?? 0),
    expired: (collabExpired[0]?.n ?? 0) + (eventExpired[0]?.n ?? 0),
    nudged: nudged[0]?.n ?? 0,
  };
}
