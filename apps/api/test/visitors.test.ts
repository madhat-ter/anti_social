import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { JOBS, runJob } from '../src/lib/jobs';
import { setOps } from '../src/lib/moderation';
import { Client, cleanup, setup } from './client';

afterEach(cleanup);

/** RFC §10.8: visitor passes. An admin makes one; whoever enters its code reads for an hour. */
async function world() {
  const w = await setup({ seatCap: 20 });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const admin = async (handle = 'boss') => {
    const c = await member(handle);
    await setOps(w.t.db, handle, true);
    return c;
  };
  const pass = async (boss: Client, label = '') => {
    const r = await boss.post('/ops/visitor-passes', { label });
    expect(r.status).toBe(200);
    return r.body as { id: string; code: string; status: string; label: string };
  };
  const visitor = async (code: string) => {
    const v = w.client();
    const r = await v.post('/visit', { code });
    expect(r.status).toBe(200);
    expect(v.cookies.has('anti_visitor')).toBe(true);
    return v;
  };
  return { ...w, rowsOf, member, admin, pass, visitor };
}

describe('visitor passes: making them', () => {
  test('only admins make passes; the code is shown once and kept hashed', async () => {
    const w = await world();
    const boss = await w.admin();
    const maya = await w.member('maya');
    expect((await maya.post('/ops/visitor-passes', {})).status).toBe(404);
    expect((await maya.get('/ops/visitor-passes')).status).toBe(404);

    const p = await w.pass(boss, 'Priya from the agency');
    expect(p.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(p).toMatchObject({ status: 'unopened', label: 'Priya from the agency' });
    const [row] = await w.rowsOf(sql`select code_hash, label from visitor_passes`);
    expect(row.code_hash).not.toContain(p.code.replace('-', ''));
    expect(row.label).toBe('Priya from the agency');

    const list = (await boss.get('/ops/visitor-passes')).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: p.id, status: 'unopened', label: 'Priya from the agency', createdByHandle: 'boss', openedAt: null });
    expect(list.items[0].code).toBeUndefined();
    expect(list.active).toBe(0);
  });
});

describe('visitor passes: the hour', () => {
  test('entering the code: an hour of reading everything a member reads, and nothing else', async () => {
    const w = await world();
    const boss = await w.admin();
    const maya = await w.member('maya');
    const post = (await maya.post('/posts', { body: 'Hello from the inside.' })).body;
    const pick = (await maya.post('/suggestions', { kind: 'book', title: 'Piranesi' })).body;
    const p = await w.pass(boss);

    const v = await w.visitor(p.code);
    const me = (await v.get('/me')).body;
    expect(me).toMatchObject({ handle: 'visitor', displayName: 'Visitor', state: 'active', role: 'member', setupNeeded: false, interests: [] });
    const left = new Date(me.visitor.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(59 * 60_000);
    expect(left).toBeLessThanOrEqual(60 * 60_000);

    // reads: what a seated member sees
    for (const path of [
      '/feed', `/posts/${post.id}`, '/members', '/members/maya', '/members/maya/posts', '/members/maya/portfolio', '/members/maya/projects',
      '/members/maya/collabs', '/members/maya/suggestions', '/members/maya/consult-offer', '/events', '/collabs', '/suggestions/random',
      `/suggestions/${pick.id}/remarks`, '/seats', '/interests', '/search?q=hello',
    ]) {
      const r = await v.get(path);
      expect([path, r.status]).toEqual([path, 200]);
    }
    const feed = (await v.get('/feed')).body;
    expect(feed.items[0]).toMatchObject({ body: 'Hello from the inside.', likedByMe: false, canEdit: false, canDelete: false });

    // writes: every one is turned away before it reaches a handler
    for (const [method, path, body] of [
      ['POST', '/posts', { body: 'hi' }], ['POST', `/posts/${post.id}/like`], ['DELETE', `/posts/${post.id}/like`],
      ['POST', `/posts/${post.id}/flag`, {}], ['DELETE', `/posts/${post.id}`], ['PATCH', `/posts/${post.id}`, { body: 'x' }],
      ['POST', '/suggestions', { kind: 'book', title: 'x' }], ['PUT', `/suggestions/${pick.id}/vote`, { vote: 1 }],
      ['POST', '/events', { title: 'x' }], ['POST', '/collabs', { title: 'x' }],
      ['POST', '/members/maya/consultations', {}], ['PATCH', '/me', { bio: 'x' }], ['PUT', '/me/interests', { interests: [] }],
      ['POST', '/me/invites'], ['POST', '/uploads'], ['POST', '/notifications/read', {}], ['POST', '/payments/checkout', { productKey: 'stay_fee_90d' }],
    ] as const) {
      const r = await v.req(method, path, body);
      expect([method, path, r.status, r.body?.error]).toEqual([method, path, 403, 'visitor_readonly']);
    }

    // reads that are a member's own business
    for (const path of ['/me/invites', '/me/checklist', '/me/setup', '/me/passkeys', '/me/payments', '/me/consult-offer', '/notifications', '/notifications/unread-count', '/consultations', '/consultations/waiting']) {
      const r = await v.get(path);
      expect([path, r.status, r.body?.error]).toEqual([path, 403, 'visitor_readonly']);
    }
    // admin pages do not exist for them, as for members
    expect((await v.get('/ops/members')).status).toBe(404);
    expect((await v.get('/ops/visitor-passes')).status).toBe(404);

    // nowhere to be seen: not a member, not in a seat
    const members = (await maya.get('/members')).body.items.map((m: any) => m.handle);
    expect(members).not.toContain('visitor');
    expect((await maya.get('/seats')).body.used).toBe(2);
    expect((await maya.get('/members/visitor')).status).toBe(404);

    const list = (await boss.get('/ops/visitor-passes')).body;
    expect(list.items[0].status).toBe('active');
    expect(list.items[0].openedAt).not.toBeNull();
    expect(list.active).toBe(1);
  });

  test('a code works once: the second browser is told the pass was used', async () => {
    const w = await world();
    const boss = await w.admin();
    const p = await w.pass(boss);
    await w.visitor(p.code);
    const again = await w.client().post('/visit', { code: p.code.toLowerCase() });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('visitor_pass_used');
    // wrong codes, well-formed or not
    expect((await w.client().post('/visit', { code: 'ZZZZ-ZZZZ' })).body.error).toBe('visitor_pass_invalid');
    expect((await w.client().post('/visit', { code: 'nope' })).body.error).toBe('visitor_pass_invalid');
    expect((await w.client().post('/visit', { code: 'K7QF-M2XP-9HTR-WC4D' })).body.error).toBe('visitor_pass_invalid');
  });

  test('an unopened code stops working after a week', async () => {
    const w = await world();
    const boss = await w.admin();
    const p = await w.pass(boss);
    await w.t.db.execute(sql`update visitor_passes set code_expires_at = now() - interval '1 minute'`);
    const r = await w.client().post('/visit', { code: p.code });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('visitor_pass_invalid');
    expect((await boss.get('/ops/visitor-passes')).body.items[0].status).toBe('expired');
  });

  test('a member entering a code keeps their session; the code stays unused', async () => {
    const w = await world();
    const boss = await w.admin();
    const maya = await w.member('maya');
    const p = await w.pass(boss);
    const r = await maya.post('/visit', { code: p.code });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('already_member');
    expect(maya.cookies.has('anti_visitor')).toBe(false);
    expect((await maya.get('/me')).body.handle).toBe('maya');
    await w.visitor(p.code); // still good for whoever it was meant for
  });

  test('guessing codes is rate limited per address', async () => {
    const w = await world();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await w.client().post('/visit', { code: 'AAAA-AAAA' })).status;
    expect(last).toBe(429);
  });
});

describe('visitor passes: the end', () => {
  test('revoked: the next request says the hour is up and the cookie goes', async () => {
    const w = await world();
    const boss = await w.admin();
    const p = await w.pass(boss);
    const v = await w.visitor(p.code);
    expect((await v.get('/feed')).status).toBe(200);
    expect((await boss.post(`/ops/visitor-passes/${p.id}/revoke`)).body.status).toBe('revoked');
    const r = await v.get('/feed');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('visitor_expired');
    expect(v.cookies.has('anti_visitor')).toBe(false);
    expect((await v.get('/me')).body.error).toBe('unauthenticated'); // a stranger again
    expect((await boss.post(`/ops/visitor-passes/${crypto.randomUUID()}/revoke`)).status).toBe(404);
  });

  test('the hour runs out', async () => {
    const w = await world();
    const boss = await w.admin();
    const p = await w.pass(boss);
    const v = await w.visitor(p.code);
    await w.t.db.execute(sql`update visitor_passes set expires_at = now() - interval '1 second'`);
    const r = await v.get('/me');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('visitor_expired');
    expect((await boss.get('/ops/visitor-passes')).body.items[0].status).toBe('ended');
    // entering another code from the same browser works even with the stale cookie
    const p2 = await w.pass(boss);
    const v2 = w.client();
    v2.cookies.set('anti_visitor', 'stale');
    expect((await v2.post('/visit', { code: p2.code })).status).toBe(200);
    expect((await v2.get('/me')).body.visitor).toBeTruthy();
  });

  test('leaving early: the cookie goes, the code is still used up', async () => {
    const w = await world();
    const boss = await w.admin();
    const p = await w.pass(boss);
    const v = await w.visitor(p.code);
    expect((await v.post('/visit/leave')).status).toBe(200);
    expect(v.cookies.has('anti_visitor')).toBe(false);
    expect((await v.get('/me')).status).toBe(401);
    expect((await w.client().post('/visit', { code: p.code })).body.error).toBe('visitor_pass_used');
  });

  test('a visitor who signs in is a member: the member wins and the visitor cookie goes', async () => {
    const w = await world();
    const boss = await w.admin();
    const maya = await w.member('maya');
    const p = await w.pass(boss);
    const v = new Client(w.app, maya.authn);
    expect((await v.post('/visit', { code: p.code })).status).toBe(200);
    expect((await v.get('/me')).body.visitor).toBeTruthy();
    expect((await v.login()).status).toBe(200);
    expect((await v.get('/me')).body.handle).toBe('maya');
    expect(v.cookies.has('anti_visitor')).toBe(false);
    expect((await v.post('/posts', { body: 'back as myself' })).status).toBe(200);
  });

  test('old passes are purged after 30 days', async () => {
    const w = await world();
    const boss = await w.admin();
    await w.pass(boss);
    await w.pass(boss);
    await w.t.db.execute(sql`update visitor_passes set created_at = now() - interval '31 days' where id = (select id from visitor_passes limit 1)`);
    const r = await runJob(w.t.db, JOBS.find((j) => j.name === 'cleanup')!, { storage: w.storage, payments: w.payments });
    expect(r.status === 'ran' && r.result.visitorPasses).toBe(1);
    expect((await boss.get('/ops/visitor-passes')).body.items).toHaveLength(1);
  });
});
