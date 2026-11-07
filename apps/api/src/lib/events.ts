import { sql, type SQL } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { ATTENDANCE_WINDOW_DAYS, EVENT_DEFAULT_HOURS } from '@anti/shared';

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export type RsvpStatus = 'going' | 'waitlisted' | 'cancelled';
export type EventView = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  /** null when the location is RSVP-only and the viewer is neither the host nor going. */
  location: string | null;
  locationHidden: boolean;
  locationRsvpOnly: boolean;
  capacity: number | null;
  goingCount: number;
  waitlistCount: number;
  attendedCount: number;
  priceNote: string | null;
  externalPaymentUrl: string | null;
  cancelledAt: string | null;
  host: { handle: string; displayName: string; state: string } | null;
  isHost: boolean;
  my: { status: RsvpStatus; waitlistPosition: number | null; attended: boolean } | null;
  started: boolean;
  /** RSVP / leave allowed (not cancelled, not started). */
  rsvpOpen: boolean;
  canEdit: boolean;
  canConfirmAttendance: boolean;
};

export type EventRow = {
  id: string; title: string; description: string; cursor_ts: string; starts_iso: string; ends_iso: string | null;
  location: string; location_rsvp_only: boolean; capacity: number | null; price_note: string | null;
  external_payment_url: string | null; cancelled_iso: string | null; host_id: string;
  h_handle: string; h_display: string; h_state: string;
  going_count: number; waitlist_count: number; attended_count: number;
  my_status: RsvpStatus | null; my_attended: boolean | null; my_position: number | null;
  started: boolean; attendance_open: boolean;
};

/** Base SELECT; callers append where/order/limit. One query per page, viewer-specific fields inline. */
export function eventSelect(viewerId: string): SQL {
  return sql`
    select e.id, e.title, e.description, e.starts_at::text as cursor_ts,
      ${iso(sql`e.starts_at`)} as starts_iso, ${iso(sql`e.ends_at`)} as ends_iso,
      e.location, e.location_rsvp_only, e.capacity, e.price_note, e.external_payment_url,
      ${iso(sql`e.cancelled_at`)} as cancelled_iso, e.host_id,
      h.handle as h_handle, h.display_name as h_display, h.state as h_state,
      (select count(*)::int from event_rsvps r where r.event_id = e.id and r.status = 'going') as going_count,
      (select count(*)::int from event_rsvps r where r.event_id = e.id and r.status = 'waitlisted') as waitlist_count,
      (select count(*)::int from event_rsvps r where r.event_id = e.id and r.attended_confirmed_at is not null) as attended_count,
      me.status as my_status, (me.attended_confirmed_at is not null) as my_attended,
      case when me.status = 'waitlisted' then
        (select count(*)::int + 1 from event_rsvps w
          where w.event_id = e.id and w.status = 'waitlisted' and (w.created_at, w.user_id) < (me.created_at, me.user_id))
      end as my_position,
      (now() >= e.starts_at) as started,
      (now() >= e.starts_at and now() < e.starts_at + make_interval(days => ${ATTENDANCE_WINDOW_DAYS})) as attendance_open
    from events e
    join users h on h.id = e.host_id
    left join event_rsvps me on me.event_id = e.id and me.user_id = ${viewerId}::uuid`;
}

export function toEvent(r: EventRow, viewerId: string): EventView {
  const isHost = r.host_id === viewerId;
  const cancelled = !!r.cancelled_iso;
  const seesLocation = !r.location_rsvp_only || isHost || r.my_status === 'going';
  const started = !!r.started;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    startsAt: r.starts_iso,
    endsAt: r.ends_iso,
    location: seesLocation ? r.location : null,
    locationHidden: !seesLocation,
    locationRsvpOnly: !!r.location_rsvp_only,
    capacity: r.capacity === null ? null : Number(r.capacity),
    goingCount: Number(r.going_count),
    waitlistCount: Number(r.waitlist_count),
    attendedCount: Number(r.attended_count),
    priceNote: r.price_note,
    externalPaymentUrl: r.external_payment_url,
    cancelledAt: r.cancelled_iso,
    host: r.h_state === 'deleted' ? null : { handle: r.h_handle, displayName: r.h_display, state: r.h_state },
    isHost,
    my: r.my_status
      ? { status: r.my_status, waitlistPosition: r.my_position === null ? null : Number(r.my_position), attended: !!r.my_attended }
      : null,
    started,
    rsvpOpen: !cancelled && !started,
    canEdit: isHost && !cancelled && !started,
    canConfirmAttendance: isHost && !cancelled && !!r.attendance_open,
  };
}

export async function getEvent(db: Db, viewerId: string, id: string): Promise<EventView | null> {
  const [r] = await rows<EventRow>(db, sql`${eventSelect(viewerId)} where e.id = ${id}::uuid`);
  return r ? toEvent(r, viewerId) : null;
}

/** "Still relevant" cut-off: started less than EVENT_DEFAULT_HOURS ago, or not yet ended. */
export const upcomingCond = sql`coalesce(e.ends_at, e.starts_at + make_interval(hours => ${EVENT_DEFAULT_HOURS})) >= now()`;

/** Moves waitlisted RSVPs to going while there is room. Caller holds the event row lock. */
export async function promoteEventWaitlist(tx: Db, eventId: string): Promise<string[]> {
  const promoted = await rows<{ user_id: string }>(tx, sql`
    with cap as (
      select e.capacity,
             (select count(*)::int from event_rsvps r where r.event_id = e.id and r.status = 'going') as going
        from events e where e.id = ${eventId}::uuid
    ), nxt as (
      select w.event_id, w.user_id from event_rsvps w, cap
       where w.event_id = ${eventId}::uuid and w.status = 'waitlisted'
       order by w.created_at, w.user_id
       limit (select case when capacity is null then 1000000 else greatest(capacity - going, 0) end from cap)
    )
    update event_rsvps r set status = 'going'
      from nxt where r.event_id = nxt.event_id and r.user_id = nxt.user_id
    returning r.user_id`);
  for (const p of promoted) {
    await tx.execute(sql`insert into notifications(user_id, kind, payload)
      values (${p.user_id}::uuid, 'event_promoted', ${JSON.stringify({ eventId })}::jsonb)`);
  }
  return promoted.map((p) => p.user_id);
}
