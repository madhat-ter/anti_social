/**
 * Updates (RFC §10.5): ordinary posts that live in a collab's thread and/or on an event's page
 * instead of the main feed. Who may start one: a collab's team; for an event, its host and the
 * people going (for a collab meetup, the collab's team). Anyone may reply. Updates and replies
 * count toward the posting rule like any post.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { ApiError } from './errors';
import { UUID_RE } from './posts';

export type Place = { collabId: string | null; eventId: string | null; title: string };

const notFound = () => new ApiError(404, 'not_found');
const noRight = (d: string) => new ApiError(403, 'not_allowed', d);

export async function updatePlace(db: Db, me: string, collabId?: string, eventId?: string): Promise<Place | null> {
  if (!collabId && !eventId) return null;
  if ((collabId && !UUID_RE.test(collabId)) || (eventId && !UUID_RE.test(eventId))) throw notFound();
  if (eventId) {
    const [e] = await rows<{ id: string; title: string; host_id: string; collab_id: string | null; going: boolean; on_team: boolean; c_title: string | null }>(db, sql`
      select e.id, e.title, e.host_id, e.collab_id, c.title as c_title,
        exists (select 1 from event_rsvps r where r.event_id = e.id and r.user_id = ${me}::uuid and r.status = 'going') as going,
        exists (select 1 from collab_members m where m.collab_id = e.collab_id and m.user_id = ${me}::uuid) as on_team
      from events e left join collabs c on c.id = e.collab_id and c.deleted_at is null
      where e.id = ${eventId}::uuid and e.cancelled_at is null`);
    if (!e || (e.collab_id && !e.c_title)) throw notFound();
    if (collabId && collabId !== e.collab_id) throw new ApiError(400, 'bad_request', 'That event is not part of this collab.');
    if (e.collab_id) {
      if (!e.on_team) throw noRight('Only the team posts updates here. You can reply to them.');
      return { collabId: e.collab_id, eventId: e.id, title: e.c_title! };
    }
    if (e.host_id !== me && !e.going) throw noRight('The host and the people going post updates here. You can reply to them.');
    return { collabId: null, eventId: e.id, title: e.title };
  }
  const [c] = await rows<{ id: string; title: string; on_team: boolean }>(db, sql`
    select c.id, c.title, exists (select 1 from collab_members m where m.collab_id = c.id and m.user_id = ${me}::uuid) as on_team
      from collabs c where c.id = ${collabId!}::uuid and c.deleted_at is null and c.hidden_at is null`);
  if (!c) throw notFound();
  if (!c.on_team) throw noRight('Only the team posts updates here. You can reply to them.');
  return { collabId: c.id, eventId: null, title: c.title };
}

/** A new update: the team hears about it (or, for an event, the host and the people going). */
export async function notifyUpdate(db: Db, p: Place, actorId: string, postId: string) {
  if (p.collabId) {
    await db.execute(sql`insert into notifications (user_id, kind, payload)
      select m.user_id, 'collab_update', ${JSON.stringify({ collabId: p.collabId, title: p.title, postId, actorId })}::jsonb
        from collab_members m where m.collab_id = ${p.collabId}::uuid and m.user_id <> ${actorId}::uuid`);
    return;
  }
  await db.execute(sql`insert into notifications (user_id, kind, payload)
    select u, 'event_update', ${JSON.stringify({ eventId: p.eventId, postId, actorId })}::jsonb from (
      select host_id as u from events where id = ${p.eventId}::uuid
      union select user_id from event_rsvps where event_id = ${p.eventId}::uuid and status = 'going') x
    where u <> ${actorId}::uuid`);
}
