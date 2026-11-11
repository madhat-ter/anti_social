/**
 * Hard wipe of a member and everything they made. For demo/test accounts that were pushed into a
 * live database and should leave no trace. This is not the member's own "delete my account"
 * (RFC §5.7, which keeps posts as "deleted user"): here the rows go.
 *
 * What goes: every post they wrote (their threads' replies from other people stay, as replies with
 * no parent), every collab they host (with its team, requests, invites, reports and update posts),
 * every event they host (with RSVP lists and update posts), their pets and projects, and then the
 * user row itself — sessions, passkeys, invites, notifications, memberships and votes follow by
 * cascade. Uploaded image rows go with their posts; the files on disk/R2 are left to the daily
 * orphan sweep (it only knows about pending uploads), so a demo wipe can leave a few stale files.
 */
import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { ApiError } from './errors';

export type WipePreview = {
  handle: string;
  displayName: string;
  role: 'member' | 'ops';
  state: string;
  posts: number;
  hostedCollabs: { id: string; title: string; kind: string }[];
  joinedCollabs: number;
  hostedEvents: { id: string; title: string }[];
  cohostedEvents: number;
  goingToEvents: number;
  pets: number;
  projects: number;
  /** posts by other people that will stay (their thread's post is gone) */
  repliesByOthers: number;
};

async function findUser(db: Db, handle: string) {
  const h = handle.replace(/^@/, '');
  const [u] = await rows<{ id: string; handle: string; display_name: string; role: 'member' | 'ops'; state: string }>(db, sql`
    select id, handle, display_name, role, state from users where lower(handle) = lower(${h})`);
  if (!u) throw new ApiError(404, 'not_found', `No member @${h}.`);
  return u;
}

/** Every member left, with how much they made — for spotting demo accounts before wiping one. */
export async function wipeCandidates(db: Db) {
  return rows<{ handle: string; display_name: string; role: string; state: string; created_iso: string; posts: number; collabs: number; events: number }>(db, sql`
    select u.handle, u.display_name, u.role, u.state,
           to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD') as created_iso,
           (select count(*)::int from posts p where p.author_id = u.id) as posts,
           (select count(*)::int from collab_members m where m.user_id = u.id and m.role = 'host') as collabs,
           (select count(*)::int from events e where e.host_id = u.id) as events
      from users u
     where u.state <> 'deleted'
     order by u.created_at desc, u.handle`);
}

/** What a wipe would remove. Nothing is changed. */
export async function previewWipe(db: Db, handle: string): Promise<WipePreview> {
  const u = await findUser(db, handle);
  const hostedCollabs = await rows<{ id: string; title: string; kind: string }>(db, sql`
    select c.id, c.title, c.kind from collabs c join collab_members m on m.collab_id = c.id and m.role = 'host'
     where m.user_id = ${u.id}::uuid order by c.created_at`);
  const hostedEvents = await rows<{ id: string; title: string }>(db, sql`
    select id, title from events where host_id = ${u.id}::uuid order by starts_at`);
  const n = async (q: ReturnType<typeof sql>) => Number(await scalar<number>(db, q));
  return {
    handle: u.handle, displayName: u.display_name, role: u.role, state: u.state,
    posts: await n(sql`select count(*)::int from posts where author_id = ${u.id}::uuid`),
    hostedCollabs, joinedCollabs: await n(sql`select count(*)::int from collab_members where user_id = ${u.id}::uuid`),
    hostedEvents,
    cohostedEvents: await n(sql`select count(*)::int from event_hosts where user_id = ${u.id}::uuid`),
    goingToEvents: await n(sql`select count(*)::int from event_rsvps where user_id = ${u.id}::uuid and status in ('going', 'waitlisted')`),
    pets: await n(sql`select count(*)::int from pets where owner_id = ${u.id}::uuid`),
    projects: await n(sql`select count(*)::int from projects where user_id = ${u.id}::uuid`),
    repliesByOthers: await n(sql`select count(*)::int from posts r where r.author_id is distinct from ${u.id}::uuid
      and r.parent_id in (select id from posts where author_id = ${u.id}::uuid)`),
  };
}

/**
 * Deletes the member and their content for real. Refuses an admin unless `forceAdmin` (and never
 * the last one), and runs in one transaction so a failure leaves nothing half-removed.
 */
export async function wipeUser(db: Db, handle: string, opts: { forceAdmin?: boolean } = {}) {
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const u = await findUser(tx, handle);
    if (u.role === 'ops') {
      if (!opts.forceAdmin) throw new ApiError(409, 'is_admin', `@${u.handle} is an admin. Pass --force-admin if you mean it.`);
      const admins = Number(await scalar<number>(tx, sql`select count(*)::int from users where role = 'ops' and state <> 'deleted'`));
      if (admins <= 1) throw new ApiError(409, 'last_admin', 'That is the last admin. Make someone else admin first.');
    }
    const doomedCollabs = await rows<{ id: string }>(tx, sql`
      select m.collab_id as id from collab_members m where m.user_id = ${u.id}::uuid and m.role = 'host'`);
    const doomedEvents = await rows<{ id: string }>(tx, sql`select id from events where host_id = ${u.id}::uuid`);

    const posts = Number(await scalar<number>(tx, sql`with d as (delete from posts where author_id = ${u.id}::uuid returning 1) select count(*)::int from d`));
    const collabs = Number(await scalar<number>(tx, sql`with d as (delete from collabs c using collab_members m
      where m.collab_id = c.id and m.user_id = ${u.id}::uuid and m.role = 'host' returning 1) select count(*)::int from d`));
    const events = Number(await scalar<number>(tx, sql`with d as (delete from events where host_id = ${u.id}::uuid returning 1) select count(*)::int from d`));
    // the rest (pets, projects, memberships, sessions, votes, notifications…) follows the user row
    await tx.execute(sql`delete from users where id = ${u.id}::uuid`);
    return {
      handle: u.handle, posts, collabs, events,
      collabIds: doomedCollabs.map((c) => c.id), eventIds: doomedEvents.map((e) => e.id),
    };
  });
}
