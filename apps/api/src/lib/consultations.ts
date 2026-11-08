/**
 * Consultations (RFC §10.6): a member books another member's time.
 *
 *   offer      opt-in: topics (interest tags), a description, a session length, Free or Paid
 *              (a price note), and a private contact. Pausing stops new requests.
 *   request    pending → accepted (Paid: waits for the requester to agree to the price)
 *              → revealed (both contacts visible to the other side) → done; or declined,
 *              expired (7 days unanswered / not agreed) or closed (either side, at any point).
 *   contacts   copied onto the request at the reveal; hidden again (and wiped) when it is
 *              closed, 14 days after done, or 60 days after the reveal if never done.
 *   thanks     after done, the requester may leave a public thank-you; the consultant can hide it.
 *
 * Anti never handles money and never shows a contact before acceptance. Both sides must be 18+.
 * Nothing here is a contribution for the lurker rule.
 */
import { sql, type SQL } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import {
  ageOn, CONSULT_ANSWER_DAYS, CONSULT_CONTACT_DONE_DAYS, CONSULT_CONTACT_MAX, CONSULT_CONTACT_MAX_DAYS, CONSULT_DESCRIPTION_MAX,
  CONSULT_MIN_AGE, CONSULT_MINUTES, CONSULT_NEED_MAX, CONSULT_OPEN_PER_PAIR, CONSULT_PRICE_NOTE_MAX, CONSULT_THANKS_MAX,
  CONSULT_TOPICS_MAX, CONSULT_WHEN_MAX, utcToday, type ConsultPricing, type ConsultStatus,
} from '@anti/shared';
import { ApiError } from './errors';
import { UUID_RE } from './posts';
import { hit } from './ratelimit';
import type { SessionUser } from './sessions';

export type Person = { handle: string; displayName: string; gender: string | null; admin: boolean; verified: boolean };
export type ThanksNote = Person & { text: string; at: string; hidden: boolean };

/** What anyone (18+) sees on a portfolio. */
export type OfferView = {
  handle: string; topics: string[]; description: string; minutes: number;
  pricing: ConsultPricing; priceNote: string | null;
  sessionsDone: number;
  /** newest visible first; the owner also sees hidden ones (marked) */
  thanks: ThanksNote[]; thanksCount: number;
  mine: boolean; canBook: boolean; canReport: boolean;
  /** owner only: paused, switched off by an admin, hidden after reports */
  active: boolean; blocked: boolean; hidden: boolean;
};

/** The owner's editable offer. */
export type MyOffer = {
  active: boolean; topics: string[]; description: string; minutes: number;
  pricing: ConsultPricing; priceNote: string | null; paymentUrl: string | null; contact: string;
  blocked: boolean; hidden: boolean;
  /** 18 or over: may offer and book at all */
  allowed: boolean;
  /** has been saved at least once */
  exists: boolean;
};

export type Consultation = {
  id: string;
  /** which side the viewer is on */
  role: 'consultant' | 'requester';
  consultant: Person; requester: Person;
  topic: { slug: string; label: string };
  need: string; when: string; minutes: number;
  status: ConsultStatus;
  pricing: ConsultPricing | null; priceNote: string | null; paymentUrl: string | null;
  /** both contacts, only while revealed */
  contacts: { consultant: string; requester: string } | null;
  /** when the contacts disappear again */
  contactsUntil: string | null;
  /** pending / accepted: when it expires unanswered */
  expiresAt: string | null;
  createdAt: string; decidedAt: string | null; revealedAt: string | null; doneAt: string | null; closedAt: string | null;
  /** you closed it (else the other side, or the site) */
  closedByMe: boolean;
  thanks: { text: string; at: string; hidden: boolean } | null;
  can: { accept: boolean; decline: boolean; agree: boolean; close: boolean; hideContacts: boolean; done: boolean; thank: boolean; hideThanks: boolean; report: boolean };
  reported: boolean;
};

const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SEATED = sql`('active', 'flagged_lurker')`;
const ANSWER = sql`make_interval(days => ${CONSULT_ANSWER_DAYS})`;
const DONE_KEEP = sql`make_interval(days => ${CONSULT_CONTACT_DONE_DAYS})`;
const MAX_KEEP = sql`make_interval(days => ${CONSULT_CONTACT_MAX_DAYS})`;
const bad = (detail: string) => new ApiError(400, 'consult_invalid', detail);
const adultSql = (alias: string) => sql`(${sql.raw(alias)}.birthday is not null and ${sql.raw(alias)}.birthday <= (current_date - make_interval(years => ${CONSULT_MIN_AGE}))::date)`;

/** 18 or over today (UTC), from the stored birthday. */
export function isAdult(user: Pick<SessionUser, 'birthday'>): boolean {
  if (!user.birthday) return false;
  const age = ageOn(String(user.birthday), utcToday());
  return age !== null && age >= CONSULT_MIN_AGE;
}
export function requireAdult(user: Pick<SessionUser, 'birthday'>) {
  if (!isAdult(user)) throw new ApiError(403, 'consult_age', `Consultations are for members ${CONSULT_MIN_AGE} and over.`);
}

/** An offer anyone can book: switched on, not stopped by an admin or reports, a seated adult with a contact. */
const offerLive = (o: string, u: string) => sql`(${sql.raw(o)}.active and ${sql.raw(o)}.blocked_at is null and ${sql.raw(o)}.hidden_at is null
  and ${sql.raw(o)}.contact <> '' and jsonb_array_length(${sql.raw(o)}.topics) > 0
  and ${sql.raw(u)}.state in ${SEATED} and ${adultSql(u)})`;

/** For the member list: "Consults" tag and filter. */
export const consultsSql = (u: string) => sql`exists (select 1 from consult_offers o where o.user_id = ${sql.raw(u)}.id and ${offerLive('o', u)})`;

const json = <T,>(v: unknown, d: T): T => (v == null ? d : typeof v === 'string' ? JSON.parse(v) as T : v as T);

const text = (v: unknown, what: string, max: number, multiline = false): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${what} must be text.`);
  const s = (multiline ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v.replace(/\s+/g, ' ')).trim();
  if (s.length > max) throw bad(`${what} can be at most ${max} characters.`);
  return s;
};
function httpsUrl(v: unknown, what: string): string | null {
  const s = text(v, what, 500);
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { throw bad(`${what} is not a web address.`); }
  if (u.protocol !== 'https:' || u.username || u.password) throw bad(`${what} must start with https://.`);
  return s;
}

async function notify(db: Db, userId: string, kind: string, payload: Record<string, unknown>) {
  await db.execute(sql`insert into notifications (user_id, kind, payload) values (${userId}::uuid, ${kind}, ${JSON.stringify(payload)}::jsonb)`);
}

// ─── The offer ──────────────────────────────────────────────────────────────

type OfferRow = {
  active: boolean; topics: unknown; description: string; minutes: number; pricing: ConsultPricing;
  price_note: string | null; payment_url: string | null; contact: string; blocked: boolean; hidden: boolean;
};

/** Only tags that still exist (admins can remove one), in label order. */
async function liveTopics(db: Db, slugs: string[]): Promise<string[]> {
  if (!slugs.length) return [];
  return (await rows<{ slug: string }>(db, sql`select slug from interests
    where slug in (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)}) order by label`)).map((r) => r.slug);
}

export async function getMyOffer(db: Db, me: SessionUser): Promise<MyOffer> {
  const [o] = await rows<OfferRow>(db, sql`select active, topics, description, minutes, pricing, price_note, payment_url, contact,
    (blocked_at is not null) as blocked, (hidden_at is not null) as hidden from consult_offers where user_id = ${me.id}::uuid`);
  if (!o) {
    return { active: false, topics: [], description: '', minutes: 60, pricing: 'free', priceNote: null, paymentUrl: null, contact: '',
      blocked: false, hidden: false, allowed: isAdult(me), exists: false };
  }
  return {
    active: !!o.active, topics: await liveTopics(db, json<string[]>(o.topics, [])), description: o.description, minutes: Number(o.minutes),
    pricing: o.pricing, priceNote: o.price_note, paymentUrl: o.payment_url, contact: o.contact,
    blocked: !!o.blocked, hidden: !!o.hidden, allowed: isAdult(me), exists: true,
  };
}

/** Saves the whole offer. Switching it on needs topics and a contact. */
export async function saveMyOffer(db: Db, me: SessionUser, body: Record<string, unknown>): Promise<MyOffer> {
  requireAdult(me);
  const cur = await getMyOffer(db, me);
  const has = (k: string) => body[k] !== undefined;
  const topics = has('topics') ? body.topics : cur.topics;
  if (!Array.isArray(topics) || topics.length > CONSULT_TOPICS_MAX) throw bad(`Up to ${CONSULT_TOPICS_MAX} topics.`);
  const picked = [...new Set(topics.map(String))];
  if ((await liveTopics(db, picked)).length !== picked.length) throw bad('One of those topics does not exist.');
  const minutes = has('minutes') ? Number(body.minutes) : cur.minutes;
  if (!(CONSULT_MINUTES as readonly number[]).includes(minutes)) throw bad(`A session is ${CONSULT_MINUTES.join(', ')} minutes.`);
  const pricing = has('pricing') ? body.pricing : cur.pricing;
  if (pricing !== 'free' && pricing !== 'paid') throw bad('Free or paid.');
  const priceNote = (has('priceNote') ? text(body.priceNote, 'The price note', CONSULT_PRICE_NOTE_MAX) : cur.priceNote ?? '') || null;
  const paymentUrl = has('paymentUrl') ? httpsUrl(body.paymentUrl, 'The payment link') : cur.paymentUrl;
  const description = has('description') ? text(body.description, 'The description', CONSULT_DESCRIPTION_MAX, true) : cur.description;
  const contact = has('contact') ? text(body.contact, 'Your contact', CONSULT_CONTACT_MAX, true) : cur.contact;
  const active = has('active') ? body.active === true : cur.active;
  if (active) {
    if (cur.blocked) throw new ApiError(403, 'consult_blocked', 'An admin switched your consulting off.');
    if (!picked.length) throw bad('Pick at least one topic.');
    if (!contact) throw bad('Add how people can reach you. Only people you accept ever see it.');
    if (pricing === 'paid' && !priceNote) throw bad('Say what it costs, for example "NPR 2,000 per hour".');
  }
  await db.execute(sql`
    insert into consult_offers (user_id, active, topics, description, minutes, pricing, price_note, payment_url, contact, updated_at)
    values (${me.id}::uuid, ${active}, ${JSON.stringify(picked)}::jsonb, ${description}, ${minutes}, ${pricing}, ${priceNote}, ${paymentUrl}, ${contact}, now())
    on conflict (user_id) do update set active = excluded.active, topics = excluded.topics, description = excluded.description,
      minutes = excluded.minutes, pricing = excluded.pricing, price_note = excluded.price_note, payment_url = excluded.payment_url,
      contact = excluded.contact, updated_at = now()`);
  return getMyOffer(db, me);
}

const PERSON = (alias: string) => sql`${sql.raw(alias)}.handle as ${sql.raw(alias + '_handle')}, ${sql.raw(alias)}.display_name as ${sql.raw(alias + '_display')}, ${sql.raw(alias)}.gender as ${sql.raw(alias + '_gender')},
  (${sql.raw(alias)}.role = 'ops') as ${sql.raw(alias + '_admin')}, (${sql.raw(alias)}.verified_at is not null) as ${sql.raw(alias + '_verified')}`;
const person = (r: Record<string, unknown>, alias: string): Person => ({
  handle: String(r[`${alias}_handle`]), displayName: String(r[`${alias}_display`] ?? r[`${alias}_handle`]), gender: (r[`${alias}_gender`] as string | null) ?? null,
  admin: !!r[`${alias}_admin`], verified: !!r[`${alias}_verified`],
});

async function thanksFor(db: Db, consultantId: string, includeHidden: boolean, limit: number): Promise<ThanksNote[]> {
  const r = await rows<Record<string, unknown>>(db, sql`
    select ${PERSON('q')}, c.thanks, ${iso(sql`c.thanks_at`)} as at, c.thanks_hidden
      from consultations c join users q on q.id = c.requester_id
     where c.consultant_id = ${consultantId}::uuid and c.thanks is not null and q.state <> 'deleted'
       ${includeHidden ? sql`` : sql`and not c.thanks_hidden`}
     order by c.thanks_at desc limit ${limit}`);
  return r.map((x) => ({ ...person(x, 'q'), text: String(x.thanks), at: String(x.at), hidden: !!x.thanks_hidden }));
}

/**
 * A member's offer as the viewer sees it, or null: nothing to show (no offer, paused, under 18
 * on either side). The owner always gets theirs back while it exists, with its state.
 */
export async function getOffer(db: Db, viewer: SessionUser, handle: string): Promise<OfferView | null> {
  if (!isAdult(viewer)) return null;
  const [o] = await rows<OfferRow & { user_id: string; handle: string; live: boolean; done: number; thanks_n: number; reported: boolean }>(db, sql`
    select o.user_id, u.handle, o.active, o.topics, o.description, o.minutes, o.pricing, o.price_note, o.payment_url, o.contact,
      (o.blocked_at is not null) as blocked, (o.hidden_at is not null) as hidden, ${offerLive('o', 'u')} as live,
      (select count(*)::int from consultations c where c.consultant_id = o.user_id and c.status = 'done') as done,
      (select count(*)::int from consultations c where c.consultant_id = o.user_id and c.thanks is not null and not c.thanks_hidden) as thanks_n,
      exists (select 1 from consult_flags f where f.offer_user_id = o.user_id and f.user_id = ${viewer.id}::uuid and f.resolved_at is null) as reported
      from consult_offers o join users u on u.id = o.user_id
     where lower(u.handle) = lower(${handle}) and u.state in ${SEATED}`);
  if (!o) return null;
  const mine = o.user_id === viewer.id;
  if (!o.live && !mine) return null;
  return {
    handle: o.handle, topics: await liveTopics(db, json<string[]>(o.topics, [])), description: o.description, minutes: Number(o.minutes),
    pricing: o.pricing, priceNote: o.price_note, sessionsDone: Number(o.done),
    thanks: await thanksFor(db, o.user_id, mine, 3), thanksCount: Number(o.thanks_n),
    mine, canBook: !mine && !!o.live, canReport: !mine && !!o.live && !o.reported,
    active: mine ? !!o.active : true, blocked: mine && !!o.blocked, hidden: mine && !!o.hidden,
  };
}

/** Every thank-you for a member (the owner also sees hidden ones). */
export async function allThanks(db: Db, viewer: SessionUser, handle: string): Promise<{ items: ThanksNote[] }> {
  requireAdult(viewer);
  const [u] = await rows<{ id: string }>(db, sql`select id from users where lower(handle) = lower(${handle}) and state in ${SEATED}`);
  if (!u) throw new ApiError(404, 'not_found');
  return { items: await thanksFor(db, u.id, u.id === viewer.id, 200) };
}

// ─── Requests ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown> & {
  id: string; consultant_id: string; requester_id: string; topic: string; topic_label: string; need: string; when_text: string;
  minutes: number; status: ConsultStatus; eff: ConsultStatus; pricing: ConsultPricing | null; price_note: string | null; payment_url: string | null;
  requester_contact: string | null; consultant_contact: string | null; visible: boolean; until_iso: string | null; expires_iso: string | null;
  created_iso: string; decided_iso: string | null; revealed_iso: string | null; done_iso: string | null; closed_iso: string | null;
  closed_by: string | null; thanks: string | null; thanks_iso: string | null; thanks_hidden: boolean; reported: boolean;
};

/** Status as it stands now: an unanswered request (or unagreed price) past its 7 days is expired. */
const EFF = sql`case
    when c.status = 'pending' and c.created_at < now() - ${ANSWER} then 'expired'
    when c.status = 'accepted' and c.decided_at < now() - ${ANSWER} then 'expired'
    else c.status end`;
/** Contacts are shown while revealed or done, until hidden or out of time. */
const VISIBLE = sql`(c.contacts_hidden_at is null and (
    (c.status = 'revealed' and c.revealed_at >= now() - ${MAX_KEEP})
    or (c.status = 'done' and c.done_at >= now() - ${DONE_KEEP} and c.revealed_at >= now() - ${MAX_KEEP})))`;

const select = (me: string) => sql`
  select c.id, c.consultant_id, c.requester_id, c.topic, c.topic_label, c.need, c.when_text, c.minutes, c.status, ${EFF} as eff,
    c.pricing, c.price_note, c.payment_url, c.requester_contact, c.consultant_contact, ${VISIBLE} as visible,
    ${iso(sql`case when c.status = 'done' then least(c.done_at + ${DONE_KEEP}, c.revealed_at + ${MAX_KEEP}) else c.revealed_at + ${MAX_KEEP} end`)} as until_iso,
    ${iso(sql`case when c.status = 'pending' then c.created_at + ${ANSWER} when c.status = 'accepted' then c.decided_at + ${ANSWER} end`)} as expires_iso,
    ${iso(sql`c.created_at`)} as created_iso, ${iso(sql`c.decided_at`)} as decided_iso, ${iso(sql`c.revealed_at`)} as revealed_iso,
    ${iso(sql`c.done_at`)} as done_iso, ${iso(sql`c.closed_at`)} as closed_iso, c.closed_by,
    c.thanks, ${iso(sql`c.thanks_at`)} as thanks_iso, c.thanks_hidden,
    exists (select 1 from consult_flags f where f.consultation_id = c.id and f.user_id = ${me}::uuid and f.resolved_at is null) as reported,
    ${PERSON('k')}, ${PERSON('q')}
  from consultations c
  join users k on k.id = c.consultant_id
  join users q on q.id = c.requester_id`;

function toConsultation(r: Row, me: string): Consultation {
  const role = r.consultant_id === me ? 'consultant' : 'requester';
  const eff = r.eff;
  const visible = !!r.visible && (eff === 'revealed' || eff === 'done');
  const mineToAnswer = role === 'consultant';
  return {
    id: r.id, role, consultant: person(r, 'k'), requester: person(r, 'q'),
    topic: { slug: r.topic, label: r.topic_label }, need: r.need, when: r.when_text, minutes: Number(r.minutes),
    status: eff, pricing: r.pricing, priceNote: r.price_note,
    // the payment link is for the person paying, once there is something to pay for
    paymentUrl: r.pricing === 'paid' && (eff === 'accepted' || eff === 'revealed' || eff === 'done') ? r.payment_url : null,
    contacts: visible ? { consultant: r.consultant_contact ?? '', requester: r.requester_contact ?? '' } : null,
    contactsUntil: visible ? r.until_iso : null,
    expiresAt: eff === 'pending' || eff === 'accepted' ? r.expires_iso : null,
    createdAt: r.created_iso, decidedAt: r.decided_iso, revealedAt: r.revealed_iso, doneAt: r.done_iso, closedAt: r.closed_iso,
    closedByMe: r.closed_by === me,
    thanks: r.thanks && r.thanks_iso ? { text: r.thanks, at: r.thanks_iso, hidden: !!r.thanks_hidden } : null,
    can: {
      accept: mineToAnswer && eff === 'pending',
      decline: mineToAnswer && eff === 'pending',
      agree: !mineToAnswer && eff === 'accepted',
      close: eff === 'pending' ? !mineToAnswer : eff === 'accepted' || eff === 'revealed',
      hideContacts: eff === 'done' && visible,
      done: eff === 'revealed',
      thank: !mineToAnswer && eff === 'done',
      hideThanks: mineToAnswer && !!r.thanks,
      report: !r.reported,
    },
    reported: !!r.reported,
  };
}

async function load(db: Db, me: string, id: string, lock = false): Promise<Row> {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  const [r] = await rows<Row>(db, sql`${select(me)} where c.id = ${id}::uuid
    and (c.consultant_id = ${me}::uuid or c.requester_id = ${me}::uuid) ${lock ? sql`for update of c` : sql``}`);
  if (!r) throw new ApiError(404, 'not_found');
  return r;
}

export async function getConsultation(db: Db, me: SessionUser, id: string): Promise<Consultation> {
  requireAdult(me);
  return toConsultation(await load(db, me.id, id), me.id);
}

export async function listConsultations(db: Db, me: SessionUser, box: 'received' | 'sent'): Promise<{ items: Consultation[]; waiting: number }> {
  requireAdult(me);
  const side = box === 'received' ? sql`c.consultant_id = ${me.id}::uuid` : sql`c.requester_id = ${me.id}::uuid`;
  const r = await rows<Row>(db, sql`select * from (${select(me.id)} where ${side}) x
    order by case when x.eff in ('pending', 'accepted') then 0 when x.eff = 'revealed' then 1 else 2 end, x.created_iso desc
    limit 200`);
  return { items: r.map((x) => toConsultation(x, me.id)), waiting: await waitingCount(db, me.id) };
}

/** Requests waiting on you: ones to answer, and accepted Paid ones to agree to. For the menu badge. */
export async function waitingCount(db: Db, me: string): Promise<number> {
  return Number(await scalar(db, sql`select count(*)::int from consultations c
    where (c.consultant_id = ${me}::uuid and c.status = 'pending' and c.created_at >= now() - ${ANSWER})
       or (c.requester_id = ${me}::uuid and c.status = 'accepted' and c.decided_at >= now() - ${ANSWER})`));
}

export async function createRequest(db: Db, me: SessionUser, handle: string, body: Record<string, unknown>): Promise<Consultation> {
  requireAdult(me);
  const [k] = await rows<{ id: string; topics: unknown; minutes: number; live: boolean }>(db, sql`
    select u.id, o.topics, o.minutes, ${offerLive('o', 'u')} as live
      from users u join consult_offers o on o.user_id = u.id where lower(u.handle) = lower(${handle})`);
  if (!k || !k.live) throw new ApiError(404, 'not_found', 'They are not taking consultations right now.');
  if (k.id === me.id) throw new ApiError(409, 'own_offer', 'You cannot book yourself.');
  const topic = String(body.topic ?? '');
  const topics = await liveTopics(db, json<string[]>(k.topics, []));
  if (!topics.includes(topic)) throw bad('Pick one of the topics they consult on.');
  const need = text(body.need, 'What you need help with', CONSULT_NEED_MAX, true);
  if (!need) throw bad('Say what you need help with.');
  const when = text(body.when, 'When suits you', CONSULT_WHEN_MAX);
  const contact = text(body.contact, 'Your contact', CONSULT_CONTACT_MAX, true);
  if (!contact) throw bad('Add how they can reach you. They only see it if they accept.');
  const open = Number(await scalar(db, sql`select count(*)::int from consultations c
    where c.consultant_id = ${k.id}::uuid and c.requester_id = ${me.id}::uuid
      and ${EFF} in ('pending', 'accepted', 'revealed')`));
  if (open >= CONSULT_OPEN_PER_PAIR) {
    throw new ApiError(409, 'consult_open_limit', `You already have ${CONSULT_OPEN_PER_PAIR} open requests with them. Finish or close one first.`);
  }
  await hit(db, 'consultRequest', me.id);
  const label = String(await scalar(db, sql`select label from interests where slug = ${topic}`));
  const [c] = await rows<{ id: string }>(db, sql`
    insert into consultations (consultant_id, requester_id, topic, topic_label, need, when_text, minutes, requester_contact)
    values (${k.id}::uuid, ${me.id}::uuid, ${topic}, ${label}, ${need}, ${when}, ${Number(k.minutes)}, ${contact}) returning id`);
  await notify(db, k.id, 'consult_request', { consultationId: c!.id, actorId: me.id, topic: label });
  return getConsultation(db, me, c!.id);
}

/** Runs `fn` on the row locked, then returns the fresh view. */
async function change(db: Db, me: SessionUser, id: string, fn: (tx: Db, r: Row) => Promise<void>): Promise<Consultation> {
  requireAdult(me);
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await fn(tx, await load(tx, me.id, id, true));
  });
  return getConsultation(db, me, id);
}
const conflict = (detail: string) => new ApiError(409, 'consult_state', detail);
const other = (r: Row, me: string) => (r.consultant_id === me ? r.requester_id : r.consultant_id);
const payload = (r: Row, me: string | null, extra: Record<string, unknown> = {}) => ({ consultationId: r.id, actorId: me, topic: r.topic_label, ...extra });

/** The consultant accepts: Free reveals both contacts now; Paid waits for the requester to agree. */
export async function acceptRequest(db: Db, me: SessionUser, id: string, body: Record<string, unknown>) {
  return change(db, me, id, async (tx, r) => {
    if (r.consultant_id !== me.id) throw new ApiError(403, 'not_consultant', 'Only the person asked can accept.');
    if (r.eff !== 'pending') throw conflict(r.eff === 'expired' ? 'This request expired.' : 'This request was already answered.');
    const [o] = await rows<{ pricing: ConsultPricing; price_note: string | null; payment_url: string | null; contact: string }>(tx, sql`
      select pricing, price_note, payment_url, contact from consult_offers where user_id = ${me.id}::uuid`);
    if (!o?.contact) throw bad('Add your contact to your offer first: it is what they get when you accept.');
    const pricing = body.pricing === undefined ? o.pricing : body.pricing;
    if (pricing !== 'free' && pricing !== 'paid') throw bad('Free or paid.');
    if (pricing === 'free') {
      await tx.execute(sql`update consultations set status = 'revealed', pricing = 'free', price_note = null, payment_url = null,
        decided_at = now(), revealed_at = now(), consultant_contact = ${o.contact} where id = ${r.id}::uuid`);
      await notify(tx, r.requester_id, 'consult_accepted', payload(r, me.id, { pricing }));
      return;
    }
    const priceNote = (body.priceNote !== undefined ? text(body.priceNote, 'The price note', CONSULT_PRICE_NOTE_MAX) : o.price_note ?? '') || null;
    if (!priceNote) throw bad('Say what it costs, for example "NPR 1,500 for 30 minutes".');
    const paymentUrl = body.paymentUrl !== undefined ? httpsUrl(body.paymentUrl, 'The payment link') : o.payment_url;
    await tx.execute(sql`update consultations set status = 'accepted', pricing = 'paid', price_note = ${priceNote}, payment_url = ${paymentUrl},
      decided_at = now() where id = ${r.id}::uuid`);
    await notify(tx, r.requester_id, 'consult_accepted', payload(r, me.id, { pricing }));
  });
}

export async function declineRequest(db: Db, me: SessionUser, id: string) {
  return change(db, me, id, async (tx, r) => {
    if (r.consultant_id !== me.id) throw new ApiError(403, 'not_consultant', 'Only the person asked can decline.');
    if (r.eff !== 'pending') throw conflict('This request is not waiting for an answer.');
    await tx.execute(sql`update consultations set status = 'declined', decided_at = now(), requester_contact = null where id = ${r.id}::uuid`);
    await notify(tx, r.requester_id, 'consult_declined', payload(r, me.id));
  });
}

/** The requester agrees to the price: both contacts are revealed. */
export async function agreeToPrice(db: Db, me: SessionUser, id: string) {
  return change(db, me, id, async (tx, r) => {
    if (r.requester_id !== me.id) throw new ApiError(403, 'not_requester', 'Only the person who asked can agree.');
    if (r.eff !== 'accepted') throw conflict(r.eff === 'expired' ? 'This offer expired.' : 'There is no price waiting for you to agree to.');
    const contact = String(await scalar(tx, sql`select contact from consult_offers where user_id = ${r.consultant_id}::uuid`) ?? '');
    if (!contact) throw conflict('They removed their contact. Close this and ask again later.');
    await tx.execute(sql`update consultations set status = 'revealed', revealed_at = now(), consultant_contact = ${contact} where id = ${r.id}::uuid`);
    await notify(tx, r.consultant_id, 'consult_agreed', payload(r, me.id));
  });
}

/**
 * Either side closes it: withdrawing a request, "No thanks" to a price, calling it off. Both
 * contacts go at once. A done session only has its contacts hidden; it stays done.
 */
export async function closeConsultation(db: Db, me: SessionUser, id: string) {
  return change(db, me, id, async (tx, r) => {
    if (r.eff === 'done') {
      await tx.execute(sql`update consultations set contacts_hidden_at = coalesce(contacts_hidden_at, now()),
        requester_contact = null, consultant_contact = null where id = ${r.id}::uuid`);
      return;
    }
    if (r.eff === 'pending' && r.consultant_id === me.id) throw conflict('Decline it instead.');
    if (r.eff !== 'pending' && r.eff !== 'accepted' && r.eff !== 'revealed') throw conflict('This one is already over.');
    await tx.execute(sql`update consultations set status = 'closed', closed_at = now(), closed_by = ${me.id}::uuid,
      contacts_hidden_at = coalesce(contacts_hidden_at, now()), requester_contact = null, consultant_contact = null
      where id = ${r.id}::uuid`);
    await notify(tx, other(r, me.id), 'consult_closed', payload(r, me.id));
  });
}

export async function markDone(db: Db, me: SessionUser, id: string) {
  return change(db, me, id, async (tx, r) => {
    if (r.eff !== 'revealed') throw conflict('Only a session under way can be marked done.');
    await tx.execute(sql`update consultations set status = 'done', done_at = now() where id = ${r.id}::uuid`);
    await notify(tx, other(r, me.id), 'consult_done', payload(r, me.id));
  });
}

/** The requester's public thank-you (null removes it). The consultant hears about the first one. */
export async function setThanks(db: Db, me: SessionUser, id: string, value: unknown) {
  return change(db, me, id, async (tx, r) => {
    if (r.requester_id !== me.id) throw new ApiError(403, 'not_requester', 'Only the person who asked can say thanks.');
    if (r.eff !== 'done') throw conflict('You can say thanks once the session is marked done.');
    if (value === null) {
      await tx.execute(sql`update consultations set thanks = null, thanks_at = null, thanks_hidden = false where id = ${r.id}::uuid`);
      return;
    }
    const t = text(value, 'Your thank-you', CONSULT_THANKS_MAX, true);
    if (!t) throw bad('Write a few words, or remove it.');
    await tx.execute(sql`update consultations set thanks = ${t}, thanks_at = coalesce(thanks_at, now()) where id = ${r.id}::uuid`);
    if (!r.thanks) await notify(tx, r.consultant_id, 'consult_thanks', payload(r, me.id));
  });
}

export async function hideThanks(db: Db, me: SessionUser, id: string, hidden: boolean) {
  return change(db, me, id, async (tx, r) => {
    if (r.consultant_id !== me.id) throw new ApiError(403, 'not_consultant', 'Only the consultant can hide a thank-you.');
    if (!r.thanks) throw new ApiError(404, 'not_found', 'There is no thank-you on this one.');
    await tx.execute(sql`update consultations set thanks_hidden = ${hidden} where id = ${r.id}::uuid`);
  });
}

// ─── Reports ────────────────────────────────────────────────────────────────

const REASON_MAX = 200;
const OFFER_HIDE_THRESHOLD = 5;

/** Either side reports a request. One report is enough to reach the admins (only two people see it). */
export async function flagConsultation(db: Db, me: SessionUser, id: string, reason: string | undefined) {
  const r = await load(db, me.id, id);
  await db.execute(sql`insert into consult_flags (user_id, consultation_id, reason)
    values (${me.id}::uuid, ${r.id}::uuid, ${reason?.trim().slice(0, REASON_MAX) || null}) on conflict do nothing`);
  await db.execute(sql`insert into notifications (user_id, kind, payload)
    select id, 'consult_reported', ${JSON.stringify({ consultationId: r.id })}::jsonb from users where role = 'ops' and state <> 'deleted' and id <> ${me.id}::uuid`);
  return { flagged: true as const };
}

/** Reporting an offer on a portfolio: five hide it until an admin decides. */
export async function flagOffer(db: Db, me: SessionUser, handle: string, reason: string | undefined) {
  requireAdult(me);
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const [o] = await rows<{ user_id: string; live: boolean }>(tx, sql`
      select o.user_id, ${offerLive('o', 'u')} as live from consult_offers o join users u on u.id = o.user_id
       where lower(u.handle) = lower(${handle}) for update of o`);
    if (!o || !o.live) throw new ApiError(404, 'not_found');
    if (o.user_id === me.id) throw new ApiError(409, 'own_offer', 'You cannot report your own offer.');
    await tx.execute(sql`insert into consult_flags (user_id, offer_user_id, reason)
      values (${me.id}::uuid, ${o.user_id}::uuid, ${reason?.trim().slice(0, REASON_MAX) || null}) on conflict do nothing`);
    const open = Number(await scalar(tx, sql`select count(*)::int from consult_flags where offer_user_id = ${o.user_id}::uuid and resolved_at is null`));
    if (open >= OFFER_HIDE_THRESHOLD) {
      await tx.execute(sql`update consult_offers set hidden_at = now() where user_id = ${o.user_id}::uuid and hidden_at is null`);
      await tx.execute(sql`insert into notifications (user_id, kind, payload)
        select id, 'flag_threshold', ${JSON.stringify({ offerUserId: o.user_id })}::jsonb from users where role = 'ops' and state <> 'deleted'`);
    }
    return { flagged: true as const };
  });
}

// ─── Admins ─────────────────────────────────────────────────────────────────

/**
 * Switches a member's consulting off: the offer stops, and requests not yet under way close
 * (people who were waiting are told). Sessions already agreed keep going.
 */
export async function switchOff(db: Db, userId: string, actorId: string | null) {
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    await tx.execute(sql`update consult_offers set blocked_at = coalesce(blocked_at, now()), active = false, hidden_at = null, updated_at = now()
      where user_id = ${userId}::uuid`);
    await tx.execute(sql`update consult_flags set resolved_at = now(), resolution = 'removed' where offer_user_id = ${userId}::uuid and resolved_at is null`);
    const closed = await rows<Row>(tx, sql`update consultations c set status = 'closed', closed_at = now(), closed_by = ${actorId}::uuid,
        contacts_hidden_at = now(), requester_contact = null, consultant_contact = null
      where c.consultant_id = ${userId}::uuid and c.status in ('pending', 'accepted')
      returning c.id, c.requester_id, c.consultant_id, c.topic_label`);
    for (const r of closed) await notify(tx, r.requester_id, 'consult_closed', payload(r, null));
    await notify(tx, userId, 'consult_switched_off', {});
  });
  return { switchedOff: true as const };
}

export async function switchOn(db: Db, userId: string) {
  await db.execute(sql`update consult_offers set blocked_at = null, updated_at = now() where user_id = ${userId}::uuid`);
  return { switchedOn: true as const };
}

/** 'restored': keep it, close the reports. 'removed': switch their consulting off. */
export async function resolveOfferFlags(db: Db, userId: string, resolution: 'restored' | 'removed', actorId: string) {
  const open = Number(await scalar(db, sql`select count(*)::int from consult_flags where offer_user_id = ${userId}::uuid and resolved_at is null`));
  if (!open) throw new ApiError(409, 'no_open_flags', 'This offer has no open reports.');
  if (resolution === 'removed') { await switchOff(db, userId, actorId); return { resolution }; }
  await db.execute(sql`update consult_flags set resolved_at = now(), resolution = 'restored' where offer_user_id = ${userId}::uuid and resolved_at is null`);
  await db.execute(sql`update consult_offers set hidden_at = null where user_id = ${userId}::uuid`);
  return { resolution };
}

/** 'restored': nothing wrong, close the reports. 'removed': close the request and hide both contacts. */
export async function resolveConsultationFlags(db: Db, id: string, resolution: 'restored' | 'removed', actorId: string) {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  return db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    const closed = await rows(tx, sql`update consult_flags set resolved_at = now(), resolution = ${resolution}
      where consultation_id = ${id}::uuid and resolved_at is null returning 1`);
    if (!closed.length) throw new ApiError(409, 'no_open_flags', 'This request has no open reports.');
    if (resolution === 'removed') {
      const [r] = await rows<Row>(tx, sql`update consultations c set
          status = case when c.status in ('pending', 'accepted', 'revealed') then 'closed' else c.status end,
          closed_at = coalesce(c.closed_at, now()), closed_by = coalesce(c.closed_by, ${actorId}::uuid),
          contacts_hidden_at = coalesce(c.contacts_hidden_at, now()), requester_contact = null, consultant_contact = null
        where c.id = ${id}::uuid returning c.id, c.requester_id, c.consultant_id, c.topic_label`);
      if (r) for (const u of [r.requester_id, r.consultant_id]) await notify(tx, u, 'consult_removed', payload(r, null));
    }
    return { resolution };
  });
}

/** A reported request, in full (contacts included), for the admins judging it. Unreported: 404. */
export async function opsConsultation(db: Db, id: string) {
  if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found');
  const [r] = await rows<Row>(db, sql`${select('00000000-0000-0000-0000-000000000000')}
    where c.id = ${id}::uuid and exists (select 1 from consult_flags f where f.consultation_id = c.id)`);
  if (!r) throw new ApiError(404, 'not_found');
  const reports = await rows<{ handle: string; reason: string | null; at: string; open: boolean }>(db, sql`
    select u.handle, f.reason, ${iso(sql`f.created_at`)} as at, (f.resolved_at is null) as open
      from consult_flags f join users u on u.id = f.user_id where f.consultation_id = ${id}::uuid order by f.created_at`);
  return {
    id: r.id, consultant: person(r, 'k'), requester: person(r, 'q'), topic: r.topic_label, need: r.need, when: r.when_text,
    status: r.eff, pricing: r.pricing, priceNote: r.price_note, paymentUrl: r.payment_url,
    contacts: { consultant: r.consultant_contact, requester: r.requester_contact },
    createdAt: r.created_iso, revealedAt: r.revealed_iso, doneAt: r.done_iso, closedAt: r.closed_iso,
    thanks: r.thanks, reports,
  };
}

/** Who consulted whom and when, newest first. Never the contacts or what was asked. */
export async function opsConsultations(db: Db) {
  const r = await rows<Row>(db, sql`select * from (${select('00000000-0000-0000-0000-000000000000')}) x order by x.created_iso desc limit 200`);
  const reported = new Set((await rows<{ id: string }>(db, sql`select distinct consultation_id as id from consult_flags where consultation_id is not null`)).map((x) => x.id));
  return r.map((x) => ({
    id: x.id, consultant: person(x, 'k'), requester: person(x, 'q'), topic: x.topic_label, status: x.eff, pricing: x.pricing,
    createdAt: x.created_iso, reported: reported.has(x.id),
  }));
}

// ─── The hourly sweep ───────────────────────────────────────────────────────

/**
 * Makes the stored state catch up with time (reads already treat it as such): unanswered requests
 * and unagreed prices expire (people are told), contacts past their time are wiped.
 */
export async function sweepConsultations(db: Db) {
  const expired = await rows<{ id: string; requester_id: string; consultant_id: string; topic_label: string; was: string }>(db, sql`
    with old as (
      select id, status as was from consultations
       where (status = 'pending' and created_at < now() - ${ANSWER}) or (status = 'accepted' and decided_at < now() - ${ANSWER})
       for update)
    update consultations c set status = 'expired', requester_contact = null, consultant_contact = null
      from old where c.id = old.id
     returning c.id, c.requester_id, c.consultant_id, c.topic_label, old.was`);
  for (const e of expired) {
    // waiting for an answer: the asker hears; waiting for the asker to agree: the consultant hears
    const to = e.was === 'pending' ? e.requester_id : e.consultant_id;
    await notify(db, to, 'consult_expired', { consultationId: e.id, actorId: null, topic: e.topic_label, was: e.was });
  }
  const hidden = await rows(db, sql`update consultations c set contacts_hidden_at = now(), requester_contact = null, consultant_contact = null
    where c.contacts_hidden_at is null and c.status in ('revealed', 'done') and not ${VISIBLE} returning 1`);
  return { expired: expired.length, contactsHidden: hidden.length };
}
