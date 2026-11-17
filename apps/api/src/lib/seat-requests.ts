/**
 * Asking for a seat (RFC §10.25). The landing page speaks to someone who feels they have nobody;
 * "ask a member for an invite" is no door for that person. So anyone can ask from the page itself:
 * a typed name, one way to reach them, a few words if they want. No account is made.
 *
 * Only admins read a request. The way to reach the person is sealed like members' contact details
 * (RFC §10.7); without CONTACT_KEY the form is off rather than storing it in the clear. An admin
 * either makes an invite for them (and sends it by hand: the site sends no mail) or says "Not
 * now", which erases the request. One answered with an invite is erased 30 days later.
 */
import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { SEAT_REQUEST, formatInviteCode } from '@anti/shared';
import { contactEnabled, openContact, sealContact } from './contact';
import { generateInviteCode } from './crypto';
import { ApiError } from './errors';

const bad = (detail: string) => new ApiError(400, 'seat_request_invalid', detail);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The form is on only while the contact key is (nothing is asked that could not be sealed). */
export const seatRequestsOpen = (): boolean => contactEnabled();

export type SeatRequestInput = { name: string; contact: string; note: string };

const one = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const len = (s: string) => Array.from(s).length;

/** Looks the words over before anything is counted or kept. */
export function checkSeatRequest(body: Record<string, unknown>): SeatRequestInput {
  if (!seatRequestsOpen()) throw new ApiError(503, 'seat_requests_off', 'Asking for a seat is not switched on yet.');
  const name = one(body.name);
  if (!name) throw bad('Tell us what to call you.');
  if (len(name) > SEAT_REQUEST.nameMax) throw bad(`A name can be at most ${SEAT_REQUEST.nameMax} characters.`);
  const contact = one(body.contact);
  if (len(contact) < SEAT_REQUEST.contactMin) throw bad('Tell us how to reach you: a phone number, an email, or an Instagram name.');
  if (len(contact) > SEAT_REQUEST.contactMax) throw bad(`Keep the way to reach you under ${SEAT_REQUEST.contactMax} characters.`);
  const note = typeof body.note === 'string' ? body.note.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (len(note) > SEAT_REQUEST.noteMax) throw bad(`Keep what you want to say under ${SEAT_REQUEST.noteMax} characters.`);
  return { name, contact, note };
}

/** Keeps the request and rings every admin. The bell carries the typed name only, never the contact. */
export async function addSeatRequest(db: Db, input: SeatRequestInput): Promise<void> {
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const waiting = Number(await scalar<number>(tx, sql`select count(*)::int from seat_requests where invited_at is null`));
    if (waiting >= SEAT_REQUEST.waitingMax) {
      throw new ApiError(429, 'seat_requests_full', 'A lot of people are waiting to be read right now. Please try again in a few days.');
    }
    const [r] = await rows<{ id: string }>(tx, sql`
      insert into seat_requests (name, contact_enc, note)
      values (${input.name}, ${sealContact(input.contact)}, ${input.note}) returning id`);
    await tx.execute(sql`
      insert into notifications (user_id, kind, payload)
      select id, 'seat_request', jsonb_build_object('requestId', ${r!.id}::text, 'guestName', ${input.name}::text)
        from users where role = 'ops' and state <> 'deleted'`);
  });
}

export type SeatRequestInfo = {
  id: string; name: string; contact: string | null; note: string; createdAt: string;
  invitedAt: string | null; invitedBy: string | null;
};
type Row = { id: string; name: string; contact_enc: string; note: string; created_at: Date; invited_at: Date | null; invited_by: string | null };

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const toInfo = (r: Row): SeatRequestInfo => ({
  id: r.id, name: r.name, contact: openContact(r.contact_enc), note: r.note, createdAt: iso(r.created_at)!,
  invitedAt: iso(r.invited_at), invitedBy: r.invited_by,
});

/** For admins: the ones still waiting first (oldest on top: they waited longest), then the answered. */
export async function listSeatRequests(db: Db): Promise<{ items: SeatRequestInfo[]; waiting: number }> {
  const found = await rows<Row>(db, sql`
    select s.id, s.name, s.contact_enc, s.note, s.created_at, s.invited_at, u.handle as invited_by
      from seat_requests s left join users u on u.id = s.invited_by
     order by (s.invited_at is not null), case when s.invited_at is null then s.created_at end asc, s.invited_at desc
     limit 300`);
  const items = found.map(toInfo);
  return { items, waiting: items.filter((i) => !i.invitedAt).length };
}

/**
 * An admin's yes: a founder invite (nobody is listed as the inviter) made for this person. The
 * code is returned once, with the way to reach them; the admin sends it by hand.
 */
export async function inviteSeatRequest(db: Db, id: string, adminId: string) {
  if (!UUID.test(id)) throw new ApiError(404, 'not_found');
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [r] = await rows<Row>(tx, sql`
      update seat_requests set invited_at = now(), invited_by = ${adminId}::uuid
       where id = ${id}::uuid and invited_at is null
      returning id, name, contact_enc, note, created_at, invited_at, null::text as invited_by`);
    if (!r) {
      const there = await scalar<number>(tx, sql`select count(*)::int from seat_requests where id = ${id}::uuid`);
      if (Number(there)) throw new ApiError(409, 'seat_request_answered', 'Someone already made an invite for this request.');
      throw new ApiError(404, 'not_found');
    }
    const code = generateInviteCode();
    const exp = await scalar<string | Date>(tx, sql`select create_invite(null, ${code})`);
    return { id: r.id, name: r.name, contact: openContact(r.contact_enc), code: formatInviteCode(code), expiresAt: new Date(exp as string).toISOString() };
  });
}

/** An admin's "Not now": the request is erased, with its bell lines. The site tells the person nothing. */
export async function declineSeatRequest(db: Db, id: string): Promise<{ removed: true }> {
  if (!UUID.test(id)) throw new ApiError(404, 'not_found');
  const gone = await rows(db, sql`delete from seat_requests where id = ${id}::uuid returning 1`);
  if (!gone.length) throw new ApiError(404, 'not_found');
  await db.execute(sql`delete from notifications where kind = 'seat_request' and payload->>'requestId' = ${id}`);
  return { removed: true };
}

/** The daily clean-up: a request answered with an invite is erased `keepDays` later. */
export async function sweepSeatRequests(tx: Db): Promise<number> {
  const gone = await rows<{ id: string }>(tx, sql`
    delete from seat_requests where invited_at < now() - make_interval(days => ${SEAT_REQUEST.keepDays}) returning id::text as id`);
  for (const g of gone) await tx.execute(sql`delete from notifications where kind = 'seat_request' and payload->>'requestId' = ${g.id}`);
  return gone.length;
}
