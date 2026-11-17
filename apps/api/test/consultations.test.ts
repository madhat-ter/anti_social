import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { setOps, banUser } from '../src/lib/moderation';
import { sweepConsultations } from '../src/lib/consultations';
import { cleanup, setup, TEST_SETUP } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 30 });
  /** an 18+ member; by default with the badge and an admin's approval (RFC §10.18) */
  const member = async (handle: string, birthday = TEST_SETUP.birthday, trust = true) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle, handle, { setup: false })).status).toBe(200);
    const s = await c.put('/me/setup', { ...TEST_SETUP, birthday });
    expect(s.status).toBe(200);
    if (trust) await skipTrustGate(w.t.db, handle);
    return c;
  };
  const kinds = async (handle: string) => (await rows<{ kind: string }>(w.t.db, sql`
    select n.kind from notifications n join users u on u.id = n.user_id where u.handle = ${handle} order by n.created_at, n.id`))
    .map((x) => x.kind).filter((k) => k.startsWith('consult_'));
  /** moves a request back in time */
  const age = (id: string, col: string, days: number) =>
    w.t.db.execute(sql`update consultations set ${sql.raw(col)} = ${sql.raw(col)} - make_interval(days => ${days}) where id = ${id}::uuid`);
  return { ...w, member, kinds, age };
}

/**
 * These tests are about §10.6 (requests, contacts, time limits), not §10.18, so a member is given
 * the badge and an admin's approval straight in the database. §10.18 has its own tests below.
 */
async function skipTrustGate(db: Db, handle: string) {
  await db.execute(sql`update users set verified_at = now(), consult_approved_at = now()
    where lower(handle) = lower(${handle})`);
}

const offer = {
  active: true, description: 'Portfolio reviews and first-job advice.',
  minutes: 60, pricing: 'free', contact: 'Telegram @ana_designs',
};
const ask = { need: 'Can you look at my portfolio before I apply?', when: 'Weekday evenings', contact: 'WhatsApp +977 98000 00000' };

/** a 14-year-old, today */
const minorBirthday = () => { const d = new Date(); return `${d.getUTCFullYear() - 14}-01-01`; };

describe('consultation offers', () => {
  test('set up, validate, pause; what others see', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');

    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ exists: false, active: false, allowed: true });
    for (const bad of [
      { contact: '' }, { minutes: 50 }, { pricing: 'maybe' },
      { pricing: 'paid', priceNote: '' }, { paymentUrl: 'http://pay.example' }, { description: 'x'.repeat(501) },
    ]) {
      expect((await ana.put('/me/consult-offer', { ...offer, ...bad })).body.error).toBe('consult_invalid');
    }
    const saved = (await ana.put('/me/consult-offer', { ...offer, pricing: 'paid', priceNote: 'NPR 2,000 / hour', paymentUrl: 'https://pay.example/ana' })).body;
    expect(saved).toMatchObject({ exists: true, active: true, pricing: 'paid', contact: offer.contact });

    const seen = (await ben.get('/members/ana/consult-offer')).body.offer;
    expect(seen).toMatchObject({ handle: 'ana', pricing: 'paid', priceNote: 'NPR 2,000 / hour', sessionsDone: 0, canBook: true, mine: false, thanks: [] });
    // never the contact or the payment link on the portfolio
    expect(JSON.stringify(seen)).not.toContain('Telegram');
    expect(JSON.stringify(seen)).not.toContain('pay.example');
    expect((await ana.get('/members/ana/consult-offer')).body.offer).toMatchObject({ mine: true, canBook: false, active: true });

    // the member list: a tag and a filter
    expect((await ben.get('/members/ana')).body.consults).toBe(true);
    expect((await ben.get('/members?consults=1')).body.items.map((m: any) => m.handle)).toEqual(['ana']);

    // paused: gone for others, the owner still sees it
    await ana.put('/me/consult-offer', { active: false });
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await ana.get('/members/ana/consult-offer')).body.offer).toMatchObject({ mine: true, active: false });
    expect((await ben.get('/members?consults=1')).body.items).toEqual([]);
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(404);
  });

  test('under 18: never sees it, cannot offer or book', async () => {
    const w = await world();
    const ana = await w.member('ana');
    await ana.put('/me/consult-offer', offer);
    const kid = await w.member('kid', minorBirthday());
    expect((await kid.get('/me/consult-offer')).body.allowed).toBe(false);
    // age comes before the badge: an under-18 is turned away as under-18 (RFC §10.18)
    expect((await kid.put('/me/consult-offer', offer)).body.error).toBe('consult_age');
    expect((await kid.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await kid.get('/members/ana')).body.consults).toBe(false);
    expect((await kid.post('/members/ana/consultations', ask)).body.error).toBe('consult_age');
    expect((await kid.get('/consultations')).body.error).toBe('consult_age');
    // an under-18 member's offer row (made before an admin corrected a birthday) is never live
    await w.t.db.execute(sql`insert into consult_offers (user_id, active, contact)
      select id, true, 'x' from users where handle = 'kid'`);
    expect((await ana.get('/members/kid/consult-offer')).body.offer).toBeNull();
  });
});

describe('consultation requests', () => {
  test('ask, decline gently; nothing revealed before acceptance; limits', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', offer);

    expect((await ana.post('/members/ana/consultations', ask)).body.error).toBe('own_offer');
    for (const bad of [{ need: ' ' }, { contact: '' }, { when: 'x'.repeat(201) }]) {
      expect((await ben.post('/members/ana/consultations', { ...ask, ...bad })).body.error).toBe('consult_invalid');
    }
    const r = (await ben.post('/members/ana/consultations', ask)).body;
    expect(r).toMatchObject({ role: 'requester', status: 'pending', minutes: 60, contacts: null });
    expect(r.can).toMatchObject({ close: true, accept: false, agree: false });
    expect(r.expiresAt).toBeTruthy();

    // the consultant sees the request but not the asker's contact
    const k = (await ana.get(`/consultations/${r.id}`)).body;
    expect(k).toMatchObject({ role: 'consultant', need: ask.need, when: ask.when, contacts: null });
    expect(k.can).toMatchObject({ accept: true, decline: true, close: false });
    expect(JSON.stringify(k)).not.toContain('WhatsApp');
    expect((await ana.get('/consultations?box=received')).body).toMatchObject({ waiting: 1 });
    expect((await ana.get('/consultations/waiting')).body).toEqual({ waiting: 1 });

    // strangers get nothing
    const cat = await w.member('cat');
    expect((await cat.get(`/consultations/${r.id}`)).status).toBe(404);
    expect((await cat.post(`/consultations/${r.id}/accept`)).status).toBe(404);

    expect((await ben.post(`/consultations/${r.id}/accept`)).body.error).toBe('not_consultant');
    const d = (await ana.post(`/consultations/${r.id}/decline`)).body;
    expect(d.status).toBe('declined');
    expect((await ana.post(`/consultations/${r.id}/accept`)).body.error).toBe('consult_state');
    const [row] = await rows<{ requester_contact: string | null }>(w.t.db, sql`select requester_contact from consultations where id = ${r.id}::uuid`);
    expect(row!.requester_contact).toBeNull();

    // three open with the same person at most
    for (let i = 0; i < 3; i++) expect((await ben.post('/members/ana/consultations', ask)).status).toBe(200);
    expect((await ben.post('/members/ana/consultations', ask)).body.error).toBe('consult_open_limit');
    expect(await w.kinds('ana')).toEqual(['consult_request', 'consult_request', 'consult_request', 'consult_request']);
    expect(await w.kinds('ben')).toEqual(['consult_declined']);
  });

  test('ten requests a day', async () => {
    const w = await world();
    const ben = await w.member('ben');
    const hosts = ['kona', 'kobe', 'kira', 'kurt'];
    for (const h of hosts) await (await w.member(h)).put('/me/consult-offer', offer);
    let n = 0;
    for (const h of hosts) for (let i = 0; i < 3 && n < 10; i++, n++) expect((await ben.post(`/members/${h}/consultations`, ask)).status).toBe(200);
    expect((await ben.post('/members/kurt/consultations', ask)).status).toBe(429);
  });

  test('free: accepting swaps both contacts at once; done; a thank-you', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', offer);
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;

    const acc = (await ana.post(`/consultations/${id}/accept`, { pricing: 'free' })).body;
    expect(acc).toMatchObject({ status: 'revealed', pricing: 'free', contacts: { consultant: offer.contact, requester: ask.contact } });
    expect((await ben.get(`/consultations/${id}`)).body.contacts).toEqual({ consultant: offer.contact, requester: ask.contact });
    expect(acc.contactsUntil).toBeTruthy();

    expect((await ben.put(`/consultations/${id}/thanks`, { text: 'Thanks!' })).body.error).toBe('consult_state');
    const done = (await ben.post(`/consultations/${id}/done`)).body;
    expect(done.status).toBe('done');
    expect(done.contacts).not.toBeNull(); // still there for 14 days
    expect((await ana.put(`/consultations/${id}/thanks`, { text: 'x' })).body.error).toBe('not_requester');
    expect((await ben.put(`/consultations/${id}/thanks`, { text: 'Clear, kind and practical. My portfolio is so much better.' })).body.thanks)
      .toMatchObject({ hidden: false });
    await ben.put(`/consultations/${id}/thanks`, { text: 'Clear, kind and practical.' });

    const pf = (await ben.get('/members/ana/consult-offer')).body.offer;
    expect(pf).toMatchObject({ sessionsDone: 1, thanksCount: 1 });
    expect(pf.thanks).toEqual([expect.objectContaining({ handle: 'ben', text: 'Clear, kind and practical.' })]);
    // the consultant hides it
    await ana.post(`/consultations/${id}/thanks/hidden`, { hidden: true });
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toMatchObject({ thanks: [], thanksCount: 0, sessionsDone: 1 });
    expect((await ana.get('/members/ana/consult-offer')).body.offer.thanks).toEqual([expect.objectContaining({ hidden: true })]);
    expect((await ben.get('/members/ana/consult-thanks')).body.items).toEqual([]);

    expect(await w.kinds('ana')).toEqual(['consult_request', 'consult_done', 'consult_thanks']);
    expect(await w.kinds('ben')).toEqual(['consult_accepted']);
    const n = (await ben.get('/notifications')).body.items.find((x: any) => x.kind === 'consult_accepted');
    expect(n).toMatchObject({ consultation: { id, pricing: 'free' }, actor: { handle: 'ana' } });

    // hiding contacts on a done session keeps it done
    const hid = (await ana.post(`/consultations/${id}/close`)).body;
    expect(hid).toMatchObject({ status: 'done', contacts: null });
  });

  test('paid: a price per request, the requester agrees, then contacts swap; "No thanks" closes', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', { ...offer, pricing: 'paid', priceNote: 'NPR 2,000 / hour', paymentUrl: 'https://pay.example/ana' });
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;

    // the offer's default is paid; this one gets a student price
    const acc = (await ana.post(`/consultations/${id}/accept`, { pricing: 'paid', priceNote: 'NPR 1,000 for students' })).body;
    expect(acc).toMatchObject({ status: 'accepted', pricing: 'paid', priceNote: 'NPR 1,000 for students', paymentUrl: 'https://pay.example/ana', contacts: null });
    const mine = (await ben.get(`/consultations/${id}`)).body;
    expect(mine).toMatchObject({ status: 'accepted', contacts: null, can: { agree: true, close: true } });
    expect((await ben.get('/consultations/waiting')).body.waiting).toBe(1);
    expect((await ana.post(`/consultations/${id}/agree`)).body.error).toBe('not_requester');
    expect((await ben.post(`/consultations/${id}/done`)).body.error).toBe('consult_state');

    const agreed = (await ben.post(`/consultations/${id}/agree`)).body;
    expect(agreed).toMatchObject({ status: 'revealed', contacts: { consultant: offer.contact, requester: ask.contact } });

    // a second one: "No thanks" closes it, nothing revealed
    const id2 = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id2}/accept`, {});
    const no = (await ben.post(`/consultations/${id2}/close`)).body;
    expect(no).toMatchObject({ status: 'closed', contacts: null, closedByMe: true });

    // a paid one can also be done for free
    const id3 = (await ben.post('/members/ana/consultations', ask)).body.id;
    expect((await ana.post(`/consultations/${id3}/accept`, { pricing: 'free' })).body).toMatchObject({ status: 'revealed', pricing: 'free', paymentUrl: null });
    expect((await ana.post(`/consultations/${id3}/accept`, { pricing: 'paid', priceNote: '' })).body.error).toBe('consult_state');

    expect(await w.kinds('ana')).toEqual(['consult_request', 'consult_agreed', 'consult_request', 'consult_closed', 'consult_request']);
    expect(await w.kinds('ben')).toEqual(['consult_accepted', 'consult_accepted', 'consult_accepted']);
  });

  test('closing a revealed one hides both contacts and wipes them', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', offer);
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id}/accept`, {});
    const closed = (await ana.post(`/consultations/${id}/close`)).body;
    expect(closed).toMatchObject({ status: 'closed', contacts: null });
    expect((await ben.get(`/consultations/${id}`)).body.contacts).toBeNull();
    const [row] = await rows<{ a: string | null; b: string | null }>(w.t.db, sql`
      select requester_contact as a, consultant_contact as b from consultations where id = ${id}::uuid`);
    expect(row).toEqual({ a: null, b: null });
    expect((await ana.post(`/consultations/${id}/close`)).body.error).toBe('consult_state');
    expect(await w.kinds('ben')).toEqual(['consult_accepted', 'consult_closed']);
  });

  test('time: 7 days to answer or agree; contacts go 14 days after done or 60 after the reveal', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', { ...offer, pricing: 'paid', priceNote: 'NPR 500' });

    const unanswered = (await ben.post('/members/ana/consultations', ask)).body.id;
    await w.age(unanswered, 'created_at', 8);
    expect((await ana.get(`/consultations/${unanswered}`)).body).toMatchObject({ status: 'expired', can: { accept: false } });
    expect((await ana.post(`/consultations/${unanswered}/accept`)).body.error).toBe('consult_state');

    const unagreed = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${unagreed}/accept`, {});
    await w.age(unagreed, 'decided_at', 8);
    expect((await ben.post(`/consultations/${unagreed}/agree`)).body.error).toBe('consult_state');

    const done = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${done}/accept`, { pricing: 'free' });
    await ana.post(`/consultations/${done}/done`);
    await w.age(done, 'done_at', 15);
    expect((await ben.get(`/consultations/${done}`)).body).toMatchObject({ status: 'done', contacts: null });

    const longRun = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${longRun}/accept`, { pricing: 'free' });
    await w.age(longRun, 'revealed_at', 61);
    expect((await ben.get(`/consultations/${longRun}`)).body).toMatchObject({ status: 'revealed', contacts: null });

    const swept = await sweepConsultations(w.t.db);
    expect(swept).toEqual({ expired: 2, contactsHidden: 2 });
    expect(await sweepConsultations(w.t.db)).toEqual({ expired: 0, contactsHidden: 0 });
    const left = await rows<{ n: number }>(w.t.db, sql`select count(*)::int as n from consultations
      where requester_contact is not null or consultant_contact is not null`);
    expect(left[0]!.n).toBe(0);
    // the asker hears their request expired; the consultant hears their price did
    expect(await w.kinds('ben')).toContain('consult_expired');
    expect((await w.kinds('ana')).filter((k) => k === 'consult_expired')).toHaveLength(1);
  });

  test('never a lurker contribution', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', offer);
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id}/accept`, {});
    await ben.post(`/consultations/${id}/done`);
    await ben.put(`/consultations/${id}/thanks`, { text: 'Thank you.' });
    expect((await rows(w.t.db, sql`select 1 from contributions`)).length).toBe(0);
  });
});

describe('approving consulting (RFC §10.18)', () => {
  const world2 = async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    return { ...w, boss };
  };
  const verify = (w: Awaited<ReturnType<typeof world>>, handle: string) =>
    w.t.db.execute(sql`update users set verified_at = now() where lower(handle) = ${handle}`);

  test('an unverified member cannot switch on, and sees why', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    const me = (await ana.get('/me/consult-offer')).body;
    expect(me).toMatchObject({ allowed: true, verified: false, approval: 'none' });
    // saving the details is fine; switching on is not
    expect((await ana.put('/me/consult-offer', { ...offer, active: false })).status).toBe(200);
    const refused = await ana.put('/me/consult-offer', offer);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('consult_unverified');
    // nothing reached the admin's queue
    expect((await w.boss.get('/ops/consult-asks')).body).toEqual([]);
    // and nobody can book it: the offer is not live, though the owner still sees their own
    const ben = await w.member('ben', TEST_SETUP.birthday, false);
    expect((await ana.get('/members/ana/consult-offer')).body.offer).toMatchObject({ mine: true, active: false });
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(404);
  });

  test('switching on asks an admin once; the offer goes live only after a yes', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    await verify(w, 'ana');

    const asked = (await ana.put('/me/consult-offer', offer)).body;
    expect(asked).toMatchObject({ active: true, verified: true, approval: 'waiting' });
    expect(await w.kinds('boss')).toContain('consult_asked');
    // saved but not live: nobody can book yet
    const ben = await w.member('ben', TEST_SETUP.birthday, false);
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(404);
    expect((await ben.get('/members?consults=1')).body.items).toEqual([]);

    // the admin's queue shows who, the badge and the offer
    const q = (await w.boss.get('/ops/consult-asks')).body;
    expect(q).toEqual([expect.objectContaining({ handle: 'ana', verified: true, minutes: 60, pricing: 'free', active: true, description: offer.description })]);

    // pressing switch on again does not flood the queue with a second notice
    await ana.put('/me/consult-offer', { ...offer, description: 'Portfolio reviews, now with a shorter note.' });
    expect((await w.kinds('boss')).filter((k) => k === 'consult_asked')).toHaveLength(1);

    // approve: it is live at once, because the offer is already switched on
    expect((await w.boss.post('/ops/users/ana/consult-approval', { approved: true })).body).toEqual({ handle: 'ana', approved: true });
    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ approval: 'approved', active: true });
    expect(await w.kinds('ana')).toContain('consult_approved');
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toMatchObject({ canBook: true, handle: 'ana' });
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(200);
    expect((await w.boss.get('/ops/consult-asks')).body).toEqual([]);

    // approval sticks: pausing and resuming does not ask again
    await ana.put('/me/consult-offer', { active: false });
    const back = (await ana.put('/me/consult-offer', { active: true })).body;
    expect(back).toMatchObject({ active: true, approval: 'approved' });
    expect((await w.boss.get('/ops/consult-asks')).body).toEqual([]);
    expect((await ben.get('/members/ana/consult-offer')).body.offer).not.toBeNull();
  });

  test('a decline switches the offer off and cannot be asked again; an admin can change it', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    await verify(w, 'ana');
    await ana.put('/me/consult-offer', offer);

    expect((await w.boss.post('/ops/users/ana/consult-approval', { approved: false })).body).toEqual({ handle: 'ana', approved: false });
    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ approval: 'declined', active: false });
    expect(await w.kinds('ana')).toContain('consult_not_approved');
    // no reason is given, and only an admin can change it
    const refused = await ana.put('/me/consult-offer', { ...offer, active: true });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('consult_not_approved');
    expect((await w.boss.get('/ops/consult-asks')).body).toEqual([]);
    expect((await w.boss.get('/ops/members')).body.find((m: any) => m.handle === 'ana').consulting).toBe('declined');

    // an admin approves the same member later: they are welcome to switch on again
    expect((await w.boss.post('/ops/users/ana/consult-approval', { approved: true })).body.approved).toBe(true);
    const after = (await ana.put('/me/consult-offer', { ...offer, active: true })).body;
    expect(after).toMatchObject({ approval: 'approved', active: true });
  });

  test('switching off while waiting takes the request back', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    await verify(w, 'ana');
    await ana.put('/me/consult-offer', offer);
    expect((await w.boss.get('/ops/consult-asks')).body).toHaveLength(1);
    const off = (await ana.put('/me/consult-offer', { active: false })).body;
    expect(off).toMatchObject({ active: false, approval: 'none' });
    expect((await w.boss.get('/ops/consult-asks')).body).toEqual([]);
  });

  test('an admin cannot approve someone they have not verified', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    const r = await w.boss.post('/ops/users/ana/consult-approval', { approved: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('consult_unverified');
  });

  test('losing the badge stops consulting and wipes the approval', async () => {
    const w = await world2();
    const ana = await w.member('ana'); // verified and approved
    await ana.put('/me/consult-offer', offer);
    const ben = await w.member('ben');
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id}/accept`, {}); // under way, contacts swapped

    expect((await w.boss.post('/ops/users/ana/verify', { on: false })).body).toEqual({ handle: 'ana', verified: false });
    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ active: false, verified: false, approval: 'none' });
    // nobody new can book
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(404);
    // the session already agreed carries on
    expect((await ben.get(`/consultations/${id}`)).body.status).toBe('revealed');

    // giving the badge back does not make them bookable again: a fresh decision is needed
    await w.boss.post('/ops/users/ana/verify', { on: true });
    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ verified: true, approval: 'none', active: false });
    expect((await ben.post('/members/ana/consultations', ask)).status).toBe(404);
    await ana.put('/me/consult-offer', { active: true });
    expect((await w.boss.get('/ops/consult-asks')).body).toHaveLength(1);
  });

  test('a member of the queue is not counted for the "consults" tag or filter', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    await verify(w, 'ana');
    await ana.put('/me/consult-offer', offer);
    expect((await w.boss.get('/members/ana')).body.consults).toBe(false);
    await w.boss.post('/ops/users/ana/consult-approval', { approved: true });
    expect((await w.boss.get('/members/ana')).body.consults).toBe(true);
    expect((await w.boss.get('/members?consults=1')).body.items.map((m: any) => m.handle)).toEqual(['ana']);
  });

  test('only an admin sees the queue', async () => {
    const w = await world2();
    const ana = await w.member('ana');
    expect((await ana.get('/ops/consult-asks')).status).toBe(404);
    expect((await ana.post('/ops/users/ana/consult-approval', { approved: true })).status).toBe(404);
  });

  test('offers that were live before this rule go to the queue', async () => {
    const w = await world2();
    const ana = await w.member('ana', TEST_SETUP.birthday, false);
    await verify(w, 'ana');
    await ana.put('/me/consult-offer', offer);
    // the state the old rule could leave behind: switched on, never asked
    await w.t.db.execute(sql`update users set consult_requested_at = null, consult_approved_at = null
      where lower(handle) = 'ana'`);
    const ben = await w.member('ben', TEST_SETUP.birthday, false);
    expect((await ben.get('/members/ana/consult-offer')).body.offer).toBeNull();

    // the backfill in 0031_consult_approval.sql, run again on this row
    await w.t.db.execute(sql`update users set consult_requested_at = now()
      where consult_requested_at is null and consult_approved_at is null
        and id in (select user_id from consult_offers where active)`);
    expect((await ana.get('/me/consult-offer')).body.approval).toBe('waiting');
    expect((await w.boss.get('/ops/consult-asks')).body.map((a: any) => a.handle)).toEqual(['ana']);
  });
});

describe('consultation reports and admins', () => {
  test('a reported request reaches admins, who see it in full; removing closes it', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    await ana.put('/me/consult-offer', offer);
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id}/accept`, {});

    // admins cannot read an unreported request or its contacts
    expect((await boss.get(`/consultations/${id}`)).status).toBe(404);
    expect((await boss.get(`/ops/consultations/${id}`)).status).toBe(404);
    const list = (await boss.get('/ops/consultations')).body;
    expect(list).toEqual([expect.objectContaining({ id, consultant: expect.objectContaining({ handle: 'ana' }), requester: expect.objectContaining({ handle: 'ben' }), reported: false })]);
    expect(JSON.stringify(list)).not.toContain('Telegram');
    expect(JSON.stringify(list)).not.toContain(ask.need);

    expect((await ben.post(`/consultations/${id}/flag`, { reason: 'Asked me to pay in advance twice' })).body).toEqual({ flagged: true });
    expect((await ben.get(`/consultations/${id}`)).body).toMatchObject({ reported: true, can: { report: false } });
    const q = (await boss.get('/ops/flags')).body;
    expect(q[0]).toMatchObject({ kind: 'consultation', consultationId: id, author: 'ana', requester: 'ben', flags: 1 });
    const full = (await boss.get(`/ops/consultations/${id}`)).body;
    expect(full).toMatchObject({ contacts: { consultant: offer.contact, requester: ask.contact }, need: ask.need });
    expect(full.reports).toEqual([expect.objectContaining({ handle: 'ben', reason: 'Asked me to pay in advance twice', open: true })]);
    expect((await ana.get('/ops/flags')).status).toBe(404);

    expect((await boss.post(`/ops/consultations/${id}/resolve`, { resolution: 'removed' })).body).toEqual({ resolution: 'removed' });
    expect((await ben.get(`/consultations/${id}`)).body).toMatchObject({ status: 'closed', contacts: null });
    expect(await w.kinds('ana')).toContain('consult_removed');
    expect((await boss.get('/ops/flags')).body).toEqual([]);
  });

  test('five reports hide an offer; switching consulting off closes requests not yet under way', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    await ana.put('/me/consult-offer', offer);
    const reps = [];
    for (const h of ['rep1', 'rep2', 'rep3', 'rep4', 'rep5', 'viewer']) reps.push(await w.member(h));
    const waiting = (await reps[5]!.post('/members/ana/consultations', ask)).body.id;
    const underway = (await reps[4]!.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${underway}/accept`, {});

    expect((await ana.post('/members/ana/consult-offer/flag', {})).body.error).toBe('own_offer');
    for (const r of reps.slice(0, 5)) expect((await r.post('/members/ana/consult-offer/flag', { reason: 'spam' })).body).toEqual({ flagged: true });
    expect((await reps[5]!.get('/members/ana/consult-offer')).body.offer).toBeNull();
    expect((await ana.get('/members/ana/consult-offer')).body.offer).toMatchObject({ hidden: true });
    expect((await boss.get('/ops/flags')).body[0]).toMatchObject({ kind: 'consult_offer', offerHandle: 'ana', hidden: true, flags: 5 });

    expect((await boss.post('/ops/consult-offers/ana/resolve', { resolution: 'restored' })).body).toEqual({ resolution: 'restored' });
    expect((await reps[5]!.get('/members/ana/consult-offer')).body.offer).not.toBeNull();

    // off: no more requests, waiting ones close, the agreed one keeps going
    expect((await boss.post('/ops/users/ana/consulting', { on: false })).body).toEqual({ switchedOff: true });
    expect((await reps[5]!.get(`/consultations/${waiting}`)).body.status).toBe('closed');
    expect((await reps[4]!.get(`/consultations/${underway}`)).body.status).toBe('revealed');
    expect((await ana.get('/me/consult-offer')).body).toMatchObject({ blocked: true, active: false });
    expect((await ana.put('/me/consult-offer', { active: true })).body.error).toBe('consult_blocked');
    expect((await boss.get('/ops/members')).body.find((m: any) => m.handle === 'ana').consulting).toBe('off');
    expect(await w.kinds('ana')).toContain('consult_switched_off');
    await boss.post('/ops/users/ana/consulting', { on: true });
    expect((await ana.put('/me/consult-offer', { active: true })).body.active).toBe(true);
  });

  test('a ban closes everything open and wipes the contacts', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await ana.put('/me/consult-offer', offer);
    const id = (await ben.post('/members/ana/consultations', ask)).body.id;
    await ana.post(`/consultations/${id}/accept`, {});
    await banUser(w.t.db, 'ana', null);
    expect((await ben.get(`/consultations/${id}`)).body).toMatchObject({ status: 'closed', contacts: null });
    const [o] = await rows<{ active: boolean; contact: string }>(w.t.db, sql`select active, contact from consult_offers`);
    expect(o).toEqual({ active: false, contact: '' });
  });

  test('push texts never carry a contact', async () => {
    const { describePush } = await import('../src/lib/push');
    const m = describePush({ kind: 'consult_accepted', payload: { consultationId: 'x', pricing: 'paid', topic: 'Design' }, actor: 'ana', post_snippet: null, root_id: null, event_title: null });
    expect(m).toMatchObject({ url: '/consultations/x', title: '@ana accepted' });
  });
});
