import { Elysia, t } from 'elysia';
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import {
  EVENT_CAPACITY_MAX, EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_MAX_DAYS_AHEAD, EVENT_PRICE_NOTE_MAX,
  EVENT_TITLE_MAX, EVENT_URL_MAX, EVENTS_PER_DAY, ATTENDANCE_WINDOW_DAYS,
} from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { decodeCursor, encodeCursor, parseLimit, UUID_RE } from '../lib/posts';
import {
  eventSelect, eventVisible, getEvent, promoteEventWaitlist, toEvent, upcomingCond, type EventRow, type EventView,
} from '../lib/events';
import { listPosts } from '../lib/posts';
import { authPlugin, requireSeated } from '../plugins/auth';
import { hit } from '../lib/ratelimit';

const DAY = 86_400_000;
const nullableStr = (max: number) => t.Optional(t.Union([t.String({ maxLength: max * 4 }), t.Null()]));
const eventBody = {
  title: t.String({ maxLength: EVENT_TITLE_MAX * 4 }),
  description: t.Optional(t.String({ maxLength: EVENT_DESCRIPTION_MAX * 4 })),
  startsAt: t.String({ maxLength: 40 }),
  endsAt: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
  location: t.String({ maxLength: EVENT_LOCATION_MAX * 4 }),
  locationRsvpOnly: t.Optional(t.Boolean()),
  capacity: t.Optional(t.Union([t.Integer(), t.Null()])),
  priceNote: nullableStr(EVENT_PRICE_NOTE_MAX),
  externalPaymentUrl: nullableStr(EVENT_URL_MAX),
};
const createSchema = t.Object({
  ...eventBody,
  /** RFC §10.5: a meetup for this collab (its team plans it) */
  collabId: t.Optional(t.String({ maxLength: 40 })),
  audience: t.Optional(t.Union([t.Literal('team'), t.Literal('anyone')])),
});
const patchSchema = t.Partial(t.Object(eventBody));
type EventInput = Partial<{
  title: string; description: string; startsAt: string; endsAt: string | null; location: string;
  locationRsvpOnly: boolean; capacity: number | null; priceNote: string | null; externalPaymentUrl: string | null;
}>;

const chars = (s: string) => Array.from(s).length;
function text(v: string | undefined, field: string, max: number, required: boolean): string | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  if ((required && !s) || chars(s) > max) throw new ApiError(400, 'event_invalid', `${field} must be ${required ? '1' : '0'}-${max} characters.`);
  return s;
}
function time(v: string, field: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'event_invalid', `${field} is not a valid time.`);
  return d;
}
function url(v: string | null | undefined): string | null | undefined {
  if (v === undefined || v === null) return v;
  const s = v.trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { throw new ApiError(400, 'event_invalid', 'Payment link must be a full http(s) URL.'); }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || chars(s) > EVENT_URL_MAX) {
    throw new ApiError(400, 'event_invalid', 'Payment link must be a full http(s) URL.');
  }
  return u.toString();
}

/** Validates and normalises; `base` is the stored event for PATCH (cross-field checks use merged values). */
function clean(b: EventInput, base?: { startsAt: Date; endsAt: Date | null }) {
  const out: Record<string, unknown> = {};
  const title = text(b.title, 'Title', EVENT_TITLE_MAX, true); if (title !== undefined) out.title = title;
  const desc = text(b.description, 'Description', EVENT_DESCRIPTION_MAX, false); if (desc !== undefined) out.description = desc;
  const loc = text(b.location, 'Location', EVENT_LOCATION_MAX, true); if (loc !== undefined) out.location = loc;
  if (b.locationRsvpOnly !== undefined) out.locationRsvpOnly = b.locationRsvpOnly;
  if (b.priceNote !== undefined) out.priceNote = b.priceNote === null ? null : (text(b.priceNote, 'Price note', EVENT_PRICE_NOTE_MAX, false) || null);
  if (b.externalPaymentUrl !== undefined) out.externalPaymentUrl = url(b.externalPaymentUrl);
  if (b.capacity !== undefined) {
    if (b.capacity !== null && (b.capacity < 1 || b.capacity > EVENT_CAPACITY_MAX)) {
      throw new ApiError(400, 'event_invalid', `Capacity must be 1-${EVENT_CAPACITY_MAX}, or empty for no limit.`);
    }
    out.capacity = b.capacity;
  }
  const startsAt = b.startsAt !== undefined ? time(b.startsAt, 'Start') : base?.startsAt;
  const endsAt = b.endsAt !== undefined ? (b.endsAt === null || b.endsAt === '' ? null : time(b.endsAt, 'End')) : (base?.endsAt ?? null);
  if (b.startsAt !== undefined) {
    if (startsAt!.getTime() <= Date.now()) throw new ApiError(400, 'event_invalid', 'The start must be in the future.');
    if (startsAt!.getTime() > Date.now() + EVENT_MAX_DAYS_AHEAD * DAY) {
      throw new ApiError(400, 'event_invalid', `Events can be scheduled up to ${EVENT_MAX_DAYS_AHEAD} days ahead.`);
    }
    out.startsAt = startsAt;
  }
  if (b.endsAt !== undefined) out.endsAt = endsAt;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw new ApiError(400, 'event_invalid', 'The end must be after the start.');
  return out;
}

const COLS: Record<string, string> = {
  title: 'title', description: 'description', startsAt: 'starts_at', endsAt: 'ends_at', location: 'location',
  locationRsvpOnly: 'location_rsvp_only', capacity: 'capacity', priceNote: 'price_note', externalPaymentUrl: 'external_payment_url',
};
const toSqlValue = (v: unknown): SQL => (v instanceof Date ? sql`${v.toISOString()}::timestamptz` : sql`${v}`);

async function notifyRsvps(tx: Db, eventId: string, kind: string, statuses: string[]) {
  await tx.execute(sql`
    insert into notifications(user_id, kind, payload)
    select r.user_id, ${kind}, ${JSON.stringify({ eventId })}::jsonb from event_rsvps r
     where r.event_id = ${eventId}::uuid and r.status in (${sql.join(statuses.map((s) => sql`${s}::rsvp_status`), sql`, `)})`);
}

type Locked = { id: string; host_id: string; starts_ms: number; ends_ms: number | null; capacity: number | null;
  cancelled: boolean; started: boolean; attendance_open: boolean };

export const eventRoutes = (deps: Deps) => {
  const { db } = deps;

  /** Locks the event row for the rest of the transaction (serialises RSVPs against capacity). */
  async function lock(tx: Db, id: string): Promise<Locked> {
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
    const [e] = await rows<Locked>(tx, sql`
      select id, host_id, (extract(epoch from starts_at) * 1000)::float8 as starts_ms,
             (extract(epoch from ends_at) * 1000)::float8 as ends_ms, capacity, (cancelled_at is not null) as cancelled,
             (now() >= starts_at) as started,
             (now() >= starts_at and now() < starts_at + make_interval(days => ${ATTENDANCE_WINDOW_DAYS})) as attendance_open
        from events where id = ${id}::uuid for update`);
    if (!e) throw new ApiError(404, 'not_found');
    return e;
  }
  const view = async (viewer: string, id: string): Promise<EventView> => (await getEvent(db, viewer, id))!;

  return new Elysia()
    .use(authPlugin(deps))

    .get('/events', async ({ auth, query }) => {
      const a = requireSeated(auth);
      const limit = parseLimit(query.limit);
      const past = query.scope === 'past';
      const c = decodeCursor(query.cursor);
      const keyset = c
        ? past ? sql`and (e.starts_at, e.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`
               : sql`and (e.starts_at, e.id) > (${c.ts}::timestamptz, ${c.id}::uuid)`
        : sql``;
      const found = await rows<EventRow>(db, sql`
        ${eventSelect(a.user.id)}
        where e.cancelled_at is null and ${eventVisible(a.user.id)} and ${past ? sql`not ${upcomingCond}` : upcomingCond} ${keyset}
        order by ${past ? sql`e.starts_at desc, e.id desc` : sql`e.starts_at asc, e.id asc`}
        limit ${limit + 1}`);
      const page = found.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => toEvent(r, a.user.id)),
        nextCursor: found.length > limit && last ? encodeCursor(last.cursor_ts, last.id) : null,
      };
    }, { query: t.Object({ scope: t.Optional(t.String()), cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) })

    .post('/events', async ({ auth, body }) => {
      const a = requireSeated(auth);
      const v = clean(body);
      let collab: { id: string; title: string } | null = null;
      if (body.collabId) {
        if (!UUID_RE.test(body.collabId)) throw new ApiError(404, 'not_found');
        const [co] = await rows<{ id: string; title: string; on_team: boolean }>(db, sql`select c.id, c.title,
            exists (select 1 from collab_members m where m.collab_id = c.id and m.user_id = ${a.user.id}::uuid) as on_team
          from collabs c where c.id = ${body.collabId}::uuid and c.deleted_at is null and c.hidden_at is null`);
        if (!co) throw new ApiError(404, 'not_found');
        if (!co.on_team) throw new ApiError(403, 'not_allowed', 'Only the team plans meetups for a collab.');
        collab = { id: co.id, title: co.title };
      } else if (body.audience === 'team') {
        throw new ApiError(400, 'event_invalid', 'Only collab meetups can be team-only.');
      }
      const audience = collab ? body.audience ?? 'team' : 'anyone';
      const id = await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'events:' + a.user.id}, 0))`);
        const recent = await scalar<number>(tx, sql`
          select count(*)::int from events where host_id = ${a.user.id}::uuid and created_at > now() - interval '24 hours'`);
        if (Number(recent) >= EVENTS_PER_DAY) throw new ApiError(429, 'rate_limited', `You can create ${EVENTS_PER_DAY} events a day.`);
        const [r] = await rows<{ id: string }>(tx, sql`
          insert into events(host_id, title, description, starts_at, ends_at, location, location_rsvp_only, capacity, price_note, external_payment_url, collab_id, audience)
          values (${a.user.id}::uuid, ${v.title as string}, ${(v.description as string) ?? ''}, ${toSqlValue(v.startsAt)},
                  ${v.endsAt ? toSqlValue(v.endsAt) : sql`null`}, ${v.location as string}, ${(v.locationRsvpOnly as boolean) ?? false},
                  ${(v.capacity as number | null) ?? null}, ${(v.priceNote as string | null) ?? null}, ${(v.externalPaymentUrl as string | null) ?? null},
                  ${collab?.id ?? null}, ${audience})
          returning id`);
        if (collab) {
          // the team hears about it
          await tx.execute(sql`insert into notifications (user_id, kind, payload)
            select m.user_id, 'collab_meetup', ${JSON.stringify({ collabId: collab.id, title: collab.title, eventId: r!.id, actorId: a.user.id })}::jsonb
              from collab_members m where m.collab_id = ${collab.id}::uuid and m.user_id <> ${a.user.id}::uuid`);
        }
        return r!.id;
      });
      return view(a.user.id, id);
    }, { body: createSchema })

    .get('/events/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id)) throw new ApiError(404, 'not_found');
      const ev = await getEvent(db, a.user.id, params.id);
      if (!ev) throw new ApiError(404, 'not_found');
      // Everyone sees who is going; only the host sees the waitlist.
      const people = await rows<{ handle: string; display_name: string; state: string; gender: string | null; status: string; attended: boolean }>(db, sql`
        select u.handle, u.display_name, u.state, u.gender, r.status, (r.attended_confirmed_at is not null) as attended
          from event_rsvps r join users u on u.id = r.user_id
         where r.event_id = ${params.id}::uuid and u.state <> 'deleted'
           and (r.status = 'going' or (r.status = 'waitlisted' and ${ev.isHost}))
         order by r.status, r.created_at, r.user_id`);
      const person = (p: (typeof people)[number]) => ({ handle: p.handle, displayName: p.display_name, state: p.state, gender: p.gender ?? null, attended: !!p.attended });
      return {
        ...ev,
        going: people.filter((p) => p.status === 'going').map(person),
        waitlist: ev.isHost ? people.filter((p) => p.status === 'waitlisted').map(person) : null,
      };
    })

    .patch('/events/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.host_id !== a.user.id) throw new ApiError(403, 'not_host', 'Only the host can do that.');
        if (e.cancelled) throw new ApiError(409, 'event_cancelled', 'This event was cancelled.');
        if (e.started) throw new ApiError(409, 'event_started', 'This event has already started.');
        const v = clean(body, { startsAt: new Date(Number(e.starts_ms)), endsAt: e.ends_ms === null ? null : new Date(Number(e.ends_ms)) });
        const keys = Object.keys(v);
        if (!keys.length) return;
        if (typeof v.capacity === 'number') {
          const going = Number(await scalar<number>(tx, sql`
            select count(*)::int from event_rsvps where event_id = ${e.id}::uuid and status = 'going'`));
          if (v.capacity < going) {
            throw new ApiError(409, 'capacity_below_going', `${going} people are already going; capacity cannot be lower.`);
          }
        }
        await tx.execute(sql`update events set ${sql.join(keys.map((k) => sql`${sql.raw(COLS[k]!)} = ${toSqlValue(v[k])}`), sql`, `)}
                              where id = ${e.id}::uuid`);
        if ('capacity' in v) await promoteEventWaitlist(tx, e.id);
        if (keys.some((k) => k === 'startsAt' || k === 'endsAt' || k === 'location')) {
          await notifyRsvps(tx, e.id, 'event_updated', ['going', 'waitlisted']);
        }
      });
      return view(a.user.id, params.id);
    }, { body: patchSchema })

    .delete('/events/:id', async ({ auth, params }) => {
      const a = requireSeated(auth);
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.host_id !== a.user.id) throw new ApiError(403, 'not_host', 'Only the host can do that.');
        if (e.cancelled) return;
        if (e.started) throw new ApiError(409, 'event_started', 'This event has already started.');
        await tx.execute(sql`update events set cancelled_at = now() where id = ${e.id}::uuid`);
        await notifyRsvps(tx, e.id, 'event_cancelled', ['going', 'waitlisted']);
      });
      return view(a.user.id, params.id);
    })

    .post('/events/:id/rsvp', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      await hit(db, 'rsvp', uid);
      if (!UUID_RE.test(params.id) || !(await getEvent(db, uid, params.id))) throw new ApiError(404, 'not_found');
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.cancelled) throw new ApiError(409, 'event_cancelled', 'This event was cancelled.');
        if (e.started) throw new ApiError(409, 'event_started', 'This event has already started.');
        if (e.host_id === uid) throw new ApiError(409, 'host_rsvp', 'You are hosting this event.');
        const mine = await scalar<string>(tx, sql`select status from event_rsvps where event_id = ${e.id}::uuid and user_id = ${uid}::uuid`);
        if (mine === 'going' || mine === 'waitlisted') return;
        const going = Number(await scalar<number>(tx, sql`
          select count(*)::int from event_rsvps where event_id = ${e.id}::uuid and status = 'going'`));
        const queueAhead = Number(await scalar<number>(tx, sql`
          select count(*)::int from event_rsvps where event_id = ${e.id}::uuid and status = 'waitlisted'`));
        const status = (e.capacity === null || going < Number(e.capacity)) && queueAhead === 0 ? 'going' : 'waitlisted';
        await tx.execute(sql`
          insert into event_rsvps(event_id, user_id, status) values (${e.id}::uuid, ${uid}::uuid, ${status}::rsvp_status)
          on conflict (event_id, user_id) do update set status = excluded.status, created_at = now(), attended_confirmed_at = null`);
        if (status === 'going') {
          await tx.execute(sql`insert into notifications(user_id, kind, payload)
            values (${e.host_id}::uuid, 'event_rsvp', ${JSON.stringify({ eventId: e.id, actorId: uid })}::jsonb)`);
        }
      });
      return view(uid, params.id);
    })

    .delete('/events/:id/rsvp', async ({ auth, params }) => {
      const a = requireSeated(auth);
      const uid = a.user.id;
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        const mine = await scalar<string>(tx, sql`select status from event_rsvps where event_id = ${e.id}::uuid and user_id = ${uid}::uuid`);
        if (mine !== 'going' && mine !== 'waitlisted') return;
        if (e.started) throw new ApiError(409, 'event_started', 'This event has already started.');
        await tx.execute(sql`update event_rsvps set status = 'cancelled' where event_id = ${e.id}::uuid and user_id = ${uid}::uuid`);
        if (mine === 'going' && !e.cancelled) await promoteEventWaitlist(tx, e.id);
      });
      return view(uid, params.id);
    })

    /** Updates on the event's page (RFC §10.5), newest first. */
    .get('/events/:id/updates', async ({ auth, params, query }) => {
      const a = requireSeated(auth);
      if (!UUID_RE.test(params.id) || !(await getEvent(db, a.user.id, params.id))) throw new ApiError(404, 'not_found');
      return listPosts(db, a.user.id, sql`p.event_id = ${params.id}::uuid and p.parent_id is null and p.deleted_at is null and p.hidden_at is null`, query);
    }, { query: t.Object({ cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) })

    // Host confirms who actually came. Set semantics: listed handles are attended, the rest are not.
    .post('/events/:id/attendance', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.host_id !== a.user.id) throw new ApiError(403, 'not_host', 'Only the host can do that.');
        if (e.cancelled) throw new ApiError(409, 'event_cancelled', 'This event was cancelled.');
        if (!e.attendance_open) {
          throw new ApiError(409, 'attendance_closed', e.started ? 'Attendance can only be confirmed for 14 days after the event.' : 'Attendance opens when the event starts.');
        }
        const going = await rows<{ user_id: string; handle: string }>(tx, sql`
          select r.user_id, u.handle from event_rsvps r join users u on u.id = r.user_id
           where r.event_id = ${e.id}::uuid and r.status = 'going'`);
        const want = new Set(body.handles.map((h) => h.toLowerCase()));
        const unknown = [...want].filter((h) => !going.some((g) => g.handle.toLowerCase() === h));
        if (unknown.length) throw new ApiError(400, 'not_attendee', `Not on the going list: ${unknown.map((h) => '@' + h).join(', ')}`);

        for (const g of going) {
          const came = want.has(g.handle.toLowerCase());
          await tx.execute(sql`
            update event_rsvps set attended_confirmed_at = case when ${came} then coalesce(attended_confirmed_at, now()) end
             where event_id = ${e.id}::uuid and user_id = ${g.user_id}::uuid`);
          // Confirmed attendance is a contribution (RFC §3); un-confirming takes it back.
          if (came) {
            await tx.execute(sql`insert into contributions(user_id, kind, ref_id)
              values (${g.user_id}::uuid, 'event_attended', ${e.id}::uuid) on conflict do nothing`);
          } else {
            await tx.execute(sql`delete from contributions
              where user_id = ${g.user_id}::uuid and kind = 'event_attended' and ref_id = ${e.id}::uuid`);
          }
        }
        // Hosting counts once at least one other member is confirmed.
        if (want.size > 0) {
          await tx.execute(sql`insert into contributions(user_id, kind, ref_id)
            values (${e.host_id}::uuid, 'event_hosted', ${e.id}::uuid) on conflict do nothing`);
        } else {
          await tx.execute(sql`delete from contributions
            where user_id = ${e.host_id}::uuid and kind = 'event_hosted' and ref_id = ${e.id}::uuid`);
        }
      });
      return view(a.user.id, params.id);
    }, { body: t.Object({ handles: t.Array(t.String({ maxLength: 40 }), { maxItems: 1000 }) }) });

};
