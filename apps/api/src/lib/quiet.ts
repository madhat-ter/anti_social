/**
 * RFC §10.33: when someone goes quiet, anti reaches for them instead of only counting days.
 *
 * - Someone who used to come often (seen on 8 of the 30 days before they were last here, or half
 *   the days since joining when newer than that) and has been away 7 days: up to 3 members they
 *   have the most back-and-forth with in 60 days get one note, "gone_quiet". Replies and mentions
 *   either way count 1, a shared Collab or a File card 3; likes do not count. Someone who talks
 *   with nobody: the admins get it. Once per quiet spell; never twice in 30 days to the same person
 *   about the same person. The quiet member never sees any of it.
 * - On day 23 away, the member gets "seat_kept": their seat is kept until the day the 30-day rule
 *   would archive them (admins never lose a seat that way, so they get none).
 * - Coming back takes the unread notes about them away, and their own seat note.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';

export const QUIET = {
  /** days away before the people they talk with hear about it */
  afterDays: 7,
  /** "used to come often": seen on this many of the 30 days before they were last here… */
  regularDays: 8,
  regularWindowDays: 30,
  /** how far back back-and-forth counts */
  tiesDays: 60,
  /** at most this many people get a note */
  told: 3,
  /** the same person is not told twice about the same person within this many days */
  againDays: 30,
  /** days before the 30-day rule archives someone that they hear their seat is kept */
  seatNoteBeforeDays: 7,
} as const;

/** when the member was last here: their last visit, or the day they got their seat if later */
const LAST_HERE = sql`greatest(u.last_seen_at, coalesce(u.activated_at, u.created_at))`;
const SEATED = sql`u.state in ('active', 'flagged_lurker')`;

export async function sweepQuiet(db: Db) {
  // 1. back again: the hellos still unread are not needed, nor their own "seat kept" note
  const [back] = await rows<{ n: number }>(db, sql`
    with d as (
      delete from notifications n using users u
       where n.kind = 'gone_quiet' and n.read_at is null and u.id::text = n.payload->>'actorId'
         and u.last_seen_at > n.created_at
      returning 1
    ), s as (
      delete from notifications n using users u
       where n.kind = 'seat_kept' and u.id = n.user_id and u.last_seen_at > n.created_at
      returning 1
    )
    select (select count(*)::int from d) + (select count(*)::int from s) as n`);

  // 2. who has gone quiet and has not been noticed this time
  const quiet = await rows<{ id: string; last_here: string; days: number }>(db, sql`
    select u.id, ${LAST_HERE}::text as last_here,
           floor(extract(epoch from now() - ${LAST_HERE}) / 86400)::int as days
      from users u
     where ${SEATED} and u.setup_done_at is not null
       and ${LAST_HERE} <= now() - make_interval(days => ${QUIET.afterDays})
       and not exists (select 1 from quiet_notices q where q.user_id = u.id and q.last_here = ${LAST_HERE})
       and (select count(*) from user_seen_days d
             where d.user_id = u.id
               and d.day > (${LAST_HERE})::date - ${QUIET.regularWindowDays}::int
               and d.day <= (${LAST_HERE})::date)
           >= least(${QUIET.regularDays}::int,
                    ceil(least(${QUIET.regularWindowDays}::int,
                               (${LAST_HERE})::date - coalesce(u.activated_at, u.created_at)::date + 1)::numeric / 2))`);

  let noticed = 0, told = 0, toAdmins = 0;
  for (const q of quiet) {
    // the people they talk with most, by real back-and-forth (not likes)
    const ties = await rows<{ id: string }>(db, sql`
      with t as (
        select case when p.author_id = ${q.id}::uuid then r.author_id else p.author_id end as other, 1 as w
          from posts p join posts r on r.id = p.parent_id
         where p.created_at > now() - make_interval(days => ${QUIET.tiesDays})
           and p.deleted_at is null and p.pet_id is null and r.pet_id is null
           and (p.author_id = ${q.id}::uuid or r.author_id = ${q.id}::uuid) and p.author_id <> r.author_id
        union all
        select case when p.author_id = ${q.id}::uuid then m.user_id else p.author_id end, 1
          from post_mentions m join posts p on p.id = m.post_id
         where m.created_at > now() - make_interval(days => ${QUIET.tiesDays}) and p.deleted_at is null
           and (p.author_id = ${q.id}::uuid or m.user_id = ${q.id}::uuid) and p.author_id <> m.user_id
        union all
        select b.user_id, 3
          from collab_members a
          join collab_members b on b.collab_id = a.collab_id and b.user_id <> a.user_id
          join collabs c on c.id = a.collab_id
         where a.user_id = ${q.id}::uuid and c.deleted_at is null
           and (c.finished_at is null or c.finished_at > now() - make_interval(days => ${QUIET.tiesDays}))
        union all
        select case when f.maker_id = ${q.id}::uuid then f.for_id else f.maker_id end, 3
          from file_cards f
         where f.maker_id is not null and f.maker_id <> f.for_id and f.sent_at is not null and f.declined_at is null
           and f.sent_at > now() - make_interval(days => ${QUIET.tiesDays})
           and (f.maker_id = ${q.id}::uuid or f.for_id = ${q.id}::uuid)
      )
      select t.other as id
        from t join users u on u.id = t.other
       where ${SEATED} and u.setup_done_at is not null and t.other <> ${q.id}::uuid
       group by t.other
       order by sum(t.w) desc, t.other
       limit ${QUIET.told}`);
    // talks with nobody: the admins hear instead (never the quiet member themselves)
    const admins = ties.length === 0;
    const to = admins
      ? await rows<{ id: string }>(db, sql`
          select u.id from users u where u.role = 'ops' and ${SEATED} and u.id <> ${q.id}::uuid`)
      : ties;
    const toldTo: string[] = [];
    for (const r of to) {
      const got = await rows<{ id: string }>(db, sql`
        insert into notifications (user_id, kind, payload)
        select ${r.id}::uuid, 'gone_quiet', jsonb_build_object('actorId', ${q.id}::text, 'days', ${q.days}::int)
         where not exists (select 1 from quiet_notices qn
                            where qn.user_id = ${q.id}::uuid and ${r.id}::uuid = any(qn.told_to)
                              and qn.noticed_at > now() - make_interval(days => ${QUIET.againDays}))
        returning id`);
      if (got.length) toldTo.push(r.id);
    }
    await db.execute(sql`
      insert into quiet_notices (user_id, last_here, told_to)
      values (${q.id}::uuid, ${q.last_here}::timestamptz, ${`{${toldTo.join(',')}}`}::uuid[])
      on conflict do nothing`);
    noticed++;
    told += toldTo.length;
    if (admins) toAdmins += toldTo.length;
  }

  // 3. a week before the 30-day rule takes the seat: tell them it is kept for them until then
  const [seat] = await rows<{ n: number }>(db, sql`
    with s as (
      insert into notifications (user_id, kind, payload)
      select u.id, 'seat_kept',
             jsonb_build_object('until', to_char((${LAST_HERE} + days('inactivity_days')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        from users u
       where ${SEATED} and u.role <> 'ops'
         and ${LAST_HERE} <= now() - (days('inactivity_days') - make_interval(days => ${QUIET.seatNoteBeforeDays}))
         and not exists (select 1 from notifications n where n.user_id = u.id and n.kind = 'seat_kept' and n.created_at > ${LAST_HERE})
      returning 1
    )
    select count(*)::int as n from s`);

  return { back: back?.n ?? 0, noticed, told, toAdmins, seatNotes: seat?.n ?? 0 };
}
