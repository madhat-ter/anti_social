import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { SEAT_REQUEST } from '@anti/shared';
import { JOBS, runJob } from '../src/lib/jobs';
import { cleanup, setup } from './client';

/**
 * RFC §10.25: asking for a seat from the landing page. No account: a typed name, one way to be
 * reached, a few words. Only admins read it; they make an invite or say "Not now".
 */
afterEach(cleanup);

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string, ops = false) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle, handle)).status).toBe(200);
    if (ops) await w.t.db.execute(sql`update users set role = 'ops' where handle = ${handle}`);
    return c;
  };
  const cleanupJob = () => runJob(w.t.db, JOBS.find((j) => j.name === 'cleanup')!, { storage: w.storage, payments: w.payments, push: w.push });
  return { ...w, rowsOf, member, cleanupJob };
}

const ASK = { name: 'Nabila', contact: 'nabila.r@example.com', note: 'I am 16 and I do not know anyone inside.' };

describe('asking for a seat', () => {
  test('anyone can ask with no account; the contact is sealed; only admins read it and are rung', async () => {
    const w = await world();
    const admin = await w.member('maya', true);
    const theo = await w.member('theo');
    const out = w.client();

    expect((await out.get('/public/seat-requests')).body).toEqual({ open: true });
    expect(await out.post('/public/seat-requests', { ...ASK, name: '  Nabila   R ' })).toEqual({ status: 200, body: { ok: true } });

    // sealed at rest: the database alone shows no way to reach her
    const [row] = await w.rowsOf(sql`select name, contact_enc, note from seat_requests`);
    expect(row.name).toBe('Nabila R');
    expect(row.contact_enc.startsWith('v1:')).toBe(true);
    expect(row.contact_enc).not.toContain('nabila');

    // members and people outside cannot read the list
    expect((await theo.get('/ops/seat-requests')).status).toBe(404);
    expect((await out.get('/ops/seat-requests')).status).toBe(401);

    const list = (await admin.get('/ops/seat-requests')).body;
    expect(list.waiting).toBe(1);
    expect(list.items[0]).toMatchObject({ name: 'Nabila R', contact: 'nabila.r@example.com', note: ASK.note, invitedAt: null });

    // the admin is rung with the name only; a member is not
    const bell = (await admin.get('/notifications')).body.items.find((n: any) => n.kind === 'seat_request');
    expect(bell).toMatchObject({ actor: null, guestName: 'Nabila R' });
    expect(JSON.stringify(bell)).not.toContain('example.com');
    expect((await theo.get('/notifications')).body.items.some((n: any) => n.kind === 'seat_request')).toBe(false);
  });

  test('the words must fit; a robot that fills the hidden field is thanked and nothing is kept', async () => {
    const w = await world();
    const out = w.client();
    const bad = async (b: Record<string, unknown>) => (await out.post('/public/seat-requests', b));
    expect((await bad({ ...ASK, name: ' ' })).body).toMatchObject({ error: 'seat_request_invalid' });
    expect((await bad({ ...ASK, contact: 'a' })).status).toBe(400);
    expect((await bad({ ...ASK, name: 'x'.repeat(SEAT_REQUEST.nameMax + 1) })).status).toBe(400);
    expect((await bad({ ...ASK, contact: 'x'.repeat(SEAT_REQUEST.contactMax + 1) })).status).toBe(400);
    expect((await bad({ ...ASK, note: 'x'.repeat(SEAT_REQUEST.noteMax + 1) })).status).toBe(400);
    expect(await bad({ ...ASK, website: 'http://spam.example' })).toEqual({ status: 200, body: { ok: true } });
    // a note is optional
    expect((await bad({ name: 'Sam', contact: '01700 000000' })).status).toBe(200);
    const kept = await w.rowsOf(sql`select name from seat_requests`);
    expect(kept.map((r) => r.name)).toEqual(['Sam']);
  });

  test('three an hour from one connection; a typo does not use one up', async () => {
    const w = await world();
    const out = w.client();
    expect((await out.post('/public/seat-requests', { ...ASK, name: '' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await out.post('/public/seat-requests', ASK)).status).toBe(200);
    const fourth = await out.post('/public/seat-requests', ASK);
    expect(fourth.status).toBe(429);
    expect(fourth.body.detail).toContain('Three requests an hour');
  });

  test('an admin makes an invite: the code works, is made once, and the request shows as invited', async () => {
    const w = await world();
    const admin = await w.member('maya', true);
    const theo = await w.member('theo');
    const out = w.client();
    await out.post('/public/seat-requests', ASK);
    const id = (await admin.get('/ops/seat-requests')).body.items[0].id;

    expect((await theo.post(`/ops/seat-requests/${id}/invite`)).status).toBe(404);
    const made = await admin.post(`/ops/seat-requests/${id}/invite`);
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ id, name: 'Nabila', contact: 'nabila.r@example.com' });
    expect(made.body.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){2,3}$/);
    // a founder invite: it is valid, and nobody is listed as the inviter
    expect((await out.post('/invites/check', { code: made.body.code })).body.valid).toBe(true);
    expect((await w.rowsOf(sql`select created_by from invites order by created_at desc limit 1`))[0].created_by).toBeNull();

    expect((await admin.post(`/ops/seat-requests/${id}/invite`)).body).toMatchObject({ error: 'seat_request_answered' });
    const list = (await admin.get('/ops/seat-requests')).body;
    expect(list.waiting).toBe(0);
    expect(list.items[0]).toMatchObject({ id, invitedBy: 'maya' });
    expect(list.items[0].invitedAt).toBeTruthy();

    // she joins with it like anyone
    const nabila = w.client();
    expect((await nabila.register(made.body.code, 'nabila', 'Nabila')).status).toBe(200);
  });

  test('"Not now" erases the request and its bell line; answered ones go a month later', async () => {
    const w = await world();
    const admin = await w.member('maya', true);
    const out = w.client();
    await out.post('/public/seat-requests', ASK);
    await out.post('/public/seat-requests', { ...ASK, name: 'Sam' });
    const [first, second] = (await admin.get('/ops/seat-requests')).body.items;
    expect([first.name, second.name]).toEqual(['Nabila', 'Sam']); // whoever waited longest is on top

    expect((await admin.post(`/ops/seat-requests/${first.id}/decline`)).body).toEqual({ removed: true });
    expect((await admin.post(`/ops/seat-requests/${first.id}/decline`)).status).toBe(404);
    expect((await admin.post('/ops/seat-requests/not-an-id/decline')).status).toBe(404);
    expect(await w.rowsOf(sql`select 1 from seat_requests where id = ${first.id}::uuid`)).toHaveLength(0);
    const bells = (await admin.get('/notifications')).body.items.filter((n: any) => n.kind === 'seat_request');
    expect(bells.map((b: any) => b.guestName)).toEqual(['Sam']);

    await admin.post(`/ops/seat-requests/${second.id}/invite`);
    await w.cleanupJob();
    expect(await w.rowsOf(sql`select 1 from seat_requests`)).toHaveLength(1); // still listed for the admin
    await w.t.db.execute(sql`update seat_requests set invited_at = now() - make_interval(days => ${SEAT_REQUEST.keepDays + 1})`);
    await w.cleanupJob();
    expect(await w.rowsOf(sql`select 1 from seat_requests`)).toHaveLength(0);
    expect((await admin.get('/notifications')).body.items.some((n: any) => n.kind === 'seat_request')).toBe(false);
  });

});
