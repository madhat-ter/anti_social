import { Elysia, t } from 'elysia';
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import {
  EVENT_CAPACITY_MAX, EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_MAX_DAYS_AHEAD, EVENT_PRICE_NOTE_MAX,
  EVENT_TITLE_MAX, EVENT_URL_MAX, EVENTS_PER_DAY, ATTENDANCE_WINDOW_DAYS, EVENT_REQUIREMENTS_MAX, EVENT_INTERESTS_MAX,
  EVENT_INVITES_MAX, COLLAB_NOTE_MAX,
} from '@anti/shared';
import type { Deps } from '../deps';
import { ApiError } from '../lib/errors';
import { decodeCursor, encodeCursor, parseLimit, UUID_RE } from '../lib/posts';
import {
  eventSelect, eventVisible, getEvent, promoteEventWaitlist, toEvent, upcomingCond, type EventRow, type EventView,
} from '../lib/events';
import { listPosts } from '../lib/posts';
import { userByHandle as memberByHandle } from '../lib/collabs';
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
  requirements: t.Optional(t.String({ maxLength: EVENT_REQUIREMENTS_MAX * 4 })),
  joinMode: t.Optional(t.Union([t.Literal('open'), t.Literal('approve')])),
  interests: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 30 })),
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
  requirements: string; joinMode: 'open' | 'approve'; interests: string[];
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
  const req = text(b.requirements, 'Requirements', EVENT_REQUIREMENTS_MAX, false); if (req !== undefined) out.requirements = req;
  if (b.joinMode !== undefined) out.joinMode = b.joinMode;
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
  requirements: 'requirements', joinMode: 'join_mode',
};
const toSqlValue = (v: unknown): SQL => (v instanceof Date ? sql`${v.toISOString()}::timestamptz` : sql`${v}`);

async function notifyRsvps(tx: Db, eventId: string, kind: string, statuses: string[]) {
  await tx.execute(sql`
    insert into notifications(user_id, kind, payload)
    select r.user_id, ${kind}, ${JSON.stringify({ eventId })}::jsonb from event_rsvps r
     where r.event_id = ${eventId}::uuid and r.status in (${sql.join(statuses.map((s) => sql`${s}::rsvp_status`), sql`, `)})`);
}

/** Replaces an event's interest tags (RFC §10.5); unknown tags are refused. */
async function saveInterests(tx: Db, eventId: string, list: string[] | undefined) {
  if (list === undefined) return;
  const picked = [...new Set(list)];
  if (picked.length > EVENT_INTERESTS_MAX) throw new ApiError(400, 'event_invalid', `Up to ${EVENT_INTERESTS_MAX} interests.`);
  if (picked.length) {
    const known = Number(await scalar(tx, sql`select count(*)::int from interests where slug in (${sql.join(picked.map((s) => sql`${s}`), sql`, `)})`));
    if (known !== picked.length) throw new ApiError(400, 'event_invalid', 'One of those interests does not exist.');
  }
  await tx.execute(sql`delete from event_interests where event_id = ${eventId}::uuid`);
  for (const s of picked) await tx.execute(sql`insert into event_interests (event_id, interest) values (${eventId}::uuid, ${s})`);
}

/**
 * Puts someone on the going list, or the waitlist when full (caller holds the row lock). Used by
 * RSVPs on open events, accepted requests and accepted invites.
 */
async function placeRsvp(tx: Db, e: { id: string; capacity: number | null }, uid: string): Promise<'going' | 'waitlisted'> {
  const going = Number(await scalar<number>(tx, sql`
    select count(*)::int from event_rsvps where event_id = ${e.id}::uuid and status = 'going'`));
  const queueAhead = Number(await scalar<number>(tx, sql`
    select count(*)::int from event_rsvps where event_id = ${e.id}::uuid and status = 'waitlisted'`));
  const status = (e.capacity === null || going < Number(e.capacity)) && queueAhead === 0 ? 'going' : 'waitlisted';
  await tx.execute(sql`
    insert into event_rsvps(event_id, user_id, status) values (${e.id}::uuid, ${uid}::uuid, ${status}::rsvp_status)
    on conflict (event_id, user_id) do update set status = excluded.status, created_at = now(), attended_confirmed_at = null`);
  return status;
}

type Locked = { id: string; host_id: string; starts_ms: number; ends_ms: number | null; capacity: number | null;
  cancelled: boolean; started: boolean; attendance_open: boolean; join_mode: 'open' | 'approve'; audience: string;
  collab_id: string | null; title: string };

export const eventRoutes = (deps: Deps) => {
  const { db } = deps;

  /** Locks the event row for the rest of the transaction (serialises RSVPs against capacity). */
  async function lock(tx: Db, id: string): Promise<Locked> {
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
    const [e] = await rows<Locked>(tx, sql`
      select id, host_id, (extract(epoch from starts_at) * 1000)::float8 as starts_ms,
             (extract(epoch from ends_at) * 1000)::float8 as ends_ms, capacity, (cancelled_at is not null) as cancelled,
             (now() >= starts_at) as started, join_mode, audience, collab_id, title,
             (now() >= starts_at and now() < starts_at + make_interval(days => ${ATTENDANCE_WINDOW_DAYS})) as attendance_open
        from events where id = ${id}::uuid for update`);
    if (!e) throw new ApiError(404, 'not_found');
    return e;
  }
  const view = async (viewer: string, id: string): Promise<EventView> => (await getEvent(db, viewer, id))!;
  /** The event if the viewer may see it (team-only meetups: the team), else 404. */
  async function mustSee(viewer: string, id: string): Promise<EventView> {
    const ev = UUID_RE.test(id) ? await getEvent(db, viewer, id) : null;
    if (!ev) throw new ApiError(404, 'not_found');
    return ev;
  }

  /** The full page: who is going for everyone; the waitlist, requests and invites for the host. */
  async function hostView(viewer: string, id: string) {
    const ev = await mustSee(viewer, id);
    const people = await rows<{ handle: string; display_name: string; state: string; gender: string | null; status: string; attended: boolean; admin: boolean; verified: boolean }>(db, sql`
      select u.handle, u.display_name, u.state, u.gender, r.status, (u.role = 'ops') as admin, (u.verified_at is not null) as verified, (r.attended_confirmed_at is not null) as attended
        from event_rsvps r join users u on u.id = r.user_id
       where r.event_id = ${ev.id}::uuid and u.state <> 'deleted'
         and (r.status = 'going' or (r.status = 'waitlisted' and ${ev.isHost}))
       order by r.status, r.created_at, r.user_id`);
    const person = (p: (typeof people)[number]) => ({ handle: p.handle, displayName: p.display_name, state: p.state, gender: p.gender ?? null, attended: !!p.attended, admin: !!p.admin, verified: !!p.verified });
    let requests: { handle: string; displayName: string; gender: string | null; note: string | null; at: string }[] | null = null;
    let invites: { handle: string; displayName: string; gender: string | null }[] | null = null;
    if (ev.isHost) {
      requests = (await rows<{ handle: string; display_name: string; gender: string | null; note: string | null; at: string }>(db, sql`
        select u.handle, u.display_name, u.gender, q.note, to_char(q.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
          from event_requests q join users u on u.id = q.user_id and u.state in ('active', 'flagged_lurker')
         where q.event_id = ${ev.id}::uuid and q.status = 'pending' order by q.created_at`))
        .map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender, note: x.note, at: x.at }));
      invites = (await rows<{ handle: string; display_name: string; gender: string | null }>(db, sql`
        select u.handle, u.display_name, u.gender from event_invites i join users u on u.id = i.user_id and u.state in ('active', 'flagged_lurker')
         where i.event_id = ${ev.id}::uuid and i.status = 'pending' order by i.created_at`))
        .map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender }));
    }
    return {
      ...ev,
      going: people.filter((p) => p.status === 'going').map(person),
      waitlist: ev.isHost ? people.filter((p) => p.status === 'waitlisted').map(person) : null,
      requests, invites,
    };
  }

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
          insert into events(host_id, title, description, starts_at, ends_at, location, location_rsvp_only, capacity, price_note, external_payment_url, collab_id, audience,
                             requirements, join_mode)
          values (${a.user.id}::uuid, ${v.title as string}, ${(v.description as string) ?? ''}, ${toSqlValue(v.startsAt)},
                  ${v.endsAt ? toSqlValue(v.endsAt) : sql`null`}, ${v.location as string}, ${(v.locationRsvpOnly as boolean) ?? false},
                  ${(v.capacity as number | null) ?? null}, ${(v.priceNote as string | null) ?? null}, ${(v.externalPaymentUrl as string | null) ?? null},
                  ${collab?.id ?? null}, ${audience}, ${(v.requirements as string) ?? ''}, ${(v.joinMode as string) ?? 'open'})
          returning id`);
        await saveInterests(tx, r!.id, body.interests);
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

    .get('/events/:id', async ({ auth, params }) => hostView(requireSeated(auth).user.id, params.id))

    .patch('/events/:id', async ({ auth, params, body }) => {
      const a = requireSeated(auth);
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.host_id !== a.user.id) throw new ApiError(403, 'not_host', 'Only the host can do that.');
        if (e.cancelled) throw new ApiError(409, 'event_cancelled', 'This event was cancelled.');
        if (e.started) throw new ApiError(409, 'event_started', 'This event has already started.');
        const v = clean(body, { startsAt: new Date(Number(e.starts_ms)), endsAt: e.ends_ms === null ? null : new Date(Number(e.ends_ms)) });
        await saveInterests(tx, e.id, body.interests);
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
        // RFC §10.5: 'approve' events take people the host accepted or invited
        const invited = !!(await scalar<boolean>(tx, sql`select exists (select 1 from event_invites
          where event_id = ${e.id}::uuid and user_id = ${uid}::uuid and status in ('pending', 'accepted'))`));
        const accepted = !!(await scalar<boolean>(tx, sql`select exists (select 1 from event_requests
          where event_id = ${e.id}::uuid and user_id = ${uid}::uuid and status = 'accepted')`));
        if (e.join_mode === 'approve' && !invited && !accepted) {
          throw new ApiError(409, 'needs_request', 'The host takes people by request: ask to come, with a note if you like.');
        }
        if (invited) await tx.execute(sql`update event_invites set status = 'accepted' where event_id = ${e.id}::uuid and user_id = ${uid}::uuid`);
        const status = await placeRsvp(tx, e, uid);
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

    // ─── RFC §10.5: ask to come, invites, people who might fit ───────────────

    .post('/events/:id/request', async ({ auth, params, body }) => {
      const uid = requireSeated(auth).user.id;
      const ev = await mustSee(uid, params.id);
      if (ev.isHost) throw new ApiError(409, 'host_rsvp', 'You are hosting this event.');
      if (ev.cancelledAt) throw new ApiError(409, 'event_cancelled', 'This event was cancelled.');
      if (!ev.rsvpOpen) throw new ApiError(409, 'event_started', 'This event has already started.');
      if (ev.joinMode !== 'approve' || ev.invited) throw new ApiError(409, 'no_request_needed', 'No need to ask: just say you are going.');
      if (ev.my && ev.my.status !== 'cancelled') throw new ApiError(409, 'already_going', 'You are already on the list.');
      if (ev.request === 'pending') throw new ApiError(409, 'already_requested', 'You have already asked.');
      if (ev.request === 'declined') throw new ApiError(409, 'request_declined', 'The host decided not to take more people from requests.');
      const note = (body?.note ?? '').replace(/\r\n?/g, '\n').trim();
      if (note.length > COLLAB_NOTE_MAX) throw new ApiError(400, 'event_invalid', `A note can be at most ${COLLAB_NOTE_MAX} characters.`);
      await hit(db, 'collabRequest', uid);
      await db.execute(sql`insert into event_requests (event_id, user_id, note) values (${ev.id}::uuid, ${uid}::uuid, ${note || null})
        on conflict (event_id, user_id) do update set note = excluded.note, status = 'pending', created_at = now(), decided_at = null`);
      await db.execute(sql`insert into notifications (user_id, kind, payload)
        select host_id, 'event_request', ${JSON.stringify({ eventId: ev.id, actorId: uid })}::jsonb from events where id = ${ev.id}::uuid`);
      return view(uid, ev.id);
    }, { body: t.Optional(t.Object({ note: t.Optional(t.String({ maxLength: 2000 })) })) })

    .delete('/events/:id/request', async ({ auth, params }) => {
      const uid = requireSeated(auth).user.id;
      const ev = await mustSee(uid, params.id);
      await db.execute(sql`update event_requests set status = 'withdrawn', decided_at = now()
        where event_id = ${ev.id}::uuid and user_id = ${uid}::uuid and status = 'pending'`);
      return view(uid, ev.id);
    })

    .post('/events/:id/requests/:handle/:decision', async ({ auth, params }) => {
      const uid = requireSeated(auth).user.id;
      if (params.decision !== 'accept' && params.decision !== 'decline') throw new ApiError(404, 'not_found');
      const who = await memberByHandle(db, params.handle);
      await db.transaction(async (txx) => {
        const tx = txx as unknown as Db;
        const e = await lock(tx, params.id);
        if (e.host_id !== uid) throw new ApiError(403, 'not_host', 'Only the host can do that.');
        const done = await rows(tx, sql`update event_requests set status = ${params.decision === 'accept' ? 'accepted' : 'declined'}, decided_at = now()
          where event_id = ${e.id}::uuid and user_id = ${who.id}::uuid and status = 'pending' returning 1`);
        if (!done.length) throw new ApiError(404, 'not_found', 'No pending request from them.');
        if (params.decision === 'accept') {
          if (e.cancelled || e.started) throw new ApiError(409, 'event_started', 'This event is over or cancelled.');
          await placeRsvp(tx, e, who.id);
        }
        // a decline never says who decided
        await tx.execute(sql`insert into notifications (user_id, kind, payload) values (${who.id}::uuid,
          ${params.decision === 'accept' ? 'event_accepted' : 'event_declined'}, ${JSON.stringify({ eventId: e.id })}::jsonb)`);
      });
      return hostView(uid, params.id);
    }, { params: t.Object({ id: t.String(), handle: t.String({ maxLength: 40 }), decision: t.String() }) })

    /** Members whose interests overlap (for a team-only meetup: the team), not already coming, asked or invited. */
    .get('/events/:id/suggestions', async ({ auth, params }) => {
      const uid = requireSeated(auth).user.id;
      const ev = await mustSee(uid, params.id);
      if (!ev.isHost) throw new ApiError(403, 'not_host', 'Only the host can do that.');
      const found = await rows<{ handle: string; display_name: string; gender: string | null; shared: string[] | null; n: number }>(db, sql`
        select u.handle, u.display_name, u.gender,
          array(select ui.interest from user_interests ui join event_interests ei on ei.interest = ui.interest and ei.event_id = e.id
                 where ui.user_id = u.id order by ui.interest) as shared,
          (select count(*)::int from user_interests ui join event_interests ei on ei.interest = ui.interest and ei.event_id = e.id
            where ui.user_id = u.id) as n
        from events e, users u
        where e.id = ${ev.id}::uuid and u.state in ('active', 'flagged_lurker') and u.id <> e.host_id
          and not exists (select 1 from event_rsvps r where r.event_id = e.id and r.user_id = u.id and r.status in ('going', 'waitlisted'))
          and not exists (select 1 from event_invites i where i.event_id = e.id and i.user_id = u.id)
          and not exists (select 1 from event_requests q where q.event_id = e.id and q.user_id = u.id and q.status = 'pending')
          and case when e.audience = 'team'
                then exists (select 1 from collab_members m where m.collab_id = e.collab_id and m.user_id = u.id)
                else exists (select 1 from user_interests ui join event_interests ei on ei.interest = ui.interest and ei.event_id = e.id
                              where ui.user_id = u.id) end
        order by n desc, u.handle limit 20`);
      return { items: found.map((x) => ({ handle: x.handle, displayName: x.display_name, gender: x.gender, shared: x.shared ?? [], match: Number(x.n) })) };
    })

    .post('/events/:id/invites', async ({ auth, params, body }) => {
      const uid = requireSeated(auth).user.id;
      const ev = await mustSee(uid, params.id);
      if (!ev.isHost) throw new ApiError(403, 'not_host', 'Only the host can do that.');
      if (!ev.rsvpOpen) throw new ApiError(409, 'event_started', 'This event is over or cancelled.');
      const who = await memberByHandle(db, body.handle.replace(/^@/, ''));
      if (who.id === uid) throw new ApiError(409, 'host_rsvp', 'You are hosting this event.');
      // a team-only meetup can only take the team
      if (!(await getEvent(db, who.id, ev.id))) throw new ApiError(409, 'not_on_team', `@${who.handle} is not on the team.`);
      const coming = await scalar<boolean>(db, sql`select exists (select 1 from event_rsvps
        where event_id = ${ev.id}::uuid and user_id = ${who.id}::uuid and status in ('going', 'waitlisted'))`);
      if (coming) throw new ApiError(409, 'already_going', `@${who.handle} is already coming.`);
      const open = Number(await scalar(db, sql`select count(*)::int from event_invites where event_id = ${ev.id}::uuid and status = 'pending'`));
      if (open >= EVENT_INVITES_MAX) throw new ApiError(409, 'invite_limit', `Up to ${EVENT_INVITES_MAX} open invitations per event.`);
      const inserted = await rows(db, sql`insert into event_invites (event_id, user_id, invited_by) values (${ev.id}::uuid, ${who.id}::uuid, ${uid}::uuid)
        on conflict do nothing returning 1`);
      if (!inserted.length) throw new ApiError(409, 'already_invited', `@${who.handle} was already invited.`);
      await db.execute(sql`insert into notifications (user_id, kind, payload)
        values (${who.id}::uuid, 'event_invite', ${JSON.stringify({ eventId: ev.id, actorId: uid })}::jsonb)`);
      return hostView(uid, ev.id);
    }, { body: t.Object({ handle: t.String({ maxLength: 40 }) }) })

    .post('/events/:id/invite/decline', async ({ auth, params }) => {
      const uid = requireSeated(auth).user.id;
      const ev = await mustSee(uid, params.id);
      await db.execute(sql`update event_invites set status = 'declined' where event_id = ${ev.id}::uuid and user_id = ${uid}::uuid and status = 'pending'`);
      return view(uid, ev.id);
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
