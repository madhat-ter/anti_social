import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { JOBS, runJob } from '../src/lib/jobs';
import { hit, LIMITS } from '../src/lib/ratelimit';
import { setOps } from '../src/lib/moderation';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world(seatCap = 20) {
  const w = await setup({ seatCap });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const job = (name: string) => runJob(w.t.db, JOBS.find((j) => j.name === name)!, { storage: w.storage, payments: w.payments, push: w.push });
  return { ...w, rowsOf, member, job };
}

const newPost = async (c: Client, body: string) => (await c.post('/posts', { body })).body;

describe('flags and ops', () => {
  test('5 distinct reports hide a post and alert ops; ops restores or removes it', async () => {
    const w = await world();
    const author = await w.member('auth0r');
    const ops = await w.member('opsy');
    await setOps(w.t.db, 'opsy', true);
    const reporters: Client[] = [];
    for (let i = 1; i <= 5; i++) reporters.push(await w.member(`rep${i}`));

    const p = await newPost(author, 'something questionable');
    expect((await author.post(`/posts/${p.id}/flag`)).body.error).toBe('own_post');
    expect((await reporters[0]!.get('/feed')).body.items[0].canReport).toBe(true);

    for (const r of reporters.slice(0, 4)) expect((await r.post(`/posts/${p.id}/flag`, { reason: 'rude' })).body).toEqual({ flagged: true });
    await reporters[0]!.post(`/posts/${p.id}/flag`); // same member again: still 4 distinct
    expect((await reporters[0]!.get(`/posts/${p.id}`)).status).toBe(200);

    await reporters[4]!.post(`/posts/${p.id}/flag`);
    expect((await reporters[0]!.get(`/posts/${p.id}`)).status).toBe(404);
    expect((await reporters[0]!.get('/feed')).body.items).toEqual([]);
    expect((await ops.get('/notifications')).body.items[0].kind).toBe('flag_threshold');

    // ops surface is invisible to members
    expect((await author.get('/ops/flags')).status).toBe(404);
    const q = (await ops.get('/ops/flags')).body;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ postId: p.id, author: 'auth0r', hidden: true, flags: 5 });
    expect(q[0].reasons).toEqual(['rude', 'rude', 'rude', 'rude']);

    expect((await ops.post(`/ops/flags/${p.id}/resolve`, { resolution: 'restored' })).body).toEqual({ resolution: 'restored' });
    expect((await reporters[0]!.get(`/posts/${p.id}`)).status).toBe(200);
    expect((await ops.get('/ops/flags')).body).toEqual([]);
    expect((await ops.post(`/ops/flags/${p.id}/resolve`, { resolution: 'removed' })).body.error).toBe('no_open_flags');

    // a second post gets removed: tombstoned, contribution taken back, author told
    const p2 = await newPost(author, 'actually bad');
    await reporters[0]!.post(`/posts/${p2.id}/flag`);
    await ops.post(`/ops/flags/${p2.id}/resolve`, { resolution: 'removed' });
    expect((await reporters[0]!.get(`/posts/${p2.id}`)).body.root.deleted).toBe(true);
    expect(await w.rowsOf(sql`select 1 from contributions where ref_id = ${p2.id}::uuid`)).toEqual([]);
    expect((await author.get('/notifications')).body.items[0].kind).toBe('post_removed');
  });

  test('ops ban: seat freed, sessions revoked, inviter penalised', async () => {
    const w = await world(3);
    const ops = await w.member('opsy');
    await setOps(w.t.db, 'opsy', true);
    const inviter = await w.member('inviter');
    const code = (await inviter.post('/me/invites')).body.code;
    const bad = w.client();
    await bad.register(code, 'troll');
    const waiting = w.client();
    expect((await waiting.register(await w.mint(), 'patient')).body.state).toBe('waitlisted');

    expect((await inviter.post('/ops/users/troll/ban')).status).toBe(404); // members can't
    expect((await ops.post('/ops/users/troll/ban')).body).toEqual({ banned: 'troll' });
    expect((await bad.get('/me')).status).toBe(401);
    expect((await waiting.get('/me')).body.state).toBe('active');
    expect((await inviter.post('/me/invites')).body.error).toBe('invite_penalty');
    expect((await ops.post('/ops/users/opsy/ban')).body.error).toBe('cannot_ban_ops');
    expect((await ops.post('/ops/users/troll/ban')).body.error).toBe('already_gone');

    const codes = (await ops.post('/ops/invites', { count: 3 })).body;
    expect(codes).toHaveLength(3);
    expect((await w.client().post('/invites/check', { code: codes[0].code })).body.valid).toBe(true);
  });
});

describe('production safety', () => {
  test('refuses dev settings in production; API responses carry security headers', async () => {
    const { loadConfig } = await import('../src/config');
    const { loadPaymentProvider } = await import('../src/config');
    const prod = { NODE_ENV: 'production', RP_ID: 'anti.example', WEB_ORIGIN: 'https://anti.example' };
    expect(loadConfig(prod).rpId).toBe('anti.example');
    expect(() => loadConfig({ ...prod, COOKIE_SECURE: 'false' })).toThrow('COOKIE_SECURE');
    expect(() => loadConfig({ ...prod, WEB_ORIGIN: 'http://anti.example' })).toThrow('https');
    expect(() => loadConfig({ ...prod, RP_ID: 'localhost' })).toThrow('RP_ID');
    expect(() => loadConfig({ ...prod, RP_ID: 'other.example' })).toThrow('RP_ID');
    expect(() => loadPaymentProvider(loadConfig(prod), prod)).toThrow('fake payment provider');

    const w = await world();
    const r = await w.client().raw('GET', '/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('rate limits', () => {
  test('invite checks are limited per IP; limits are per subject and per window', async () => {
    const w = await world();
    const anon = w.client();
    for (let i = 0; i < LIMITS.inviteCheck.limit; i++) expect((await anon.post('/invites/check', { code: 'AAAA-BBBB-CCCC-DDDD' })).status).toBe(200);
    const r = await anon.post('/invites/check', { code: 'AAAA-BBBB-CCCC-DDDD' });
    expect([r.status, r.body.error]).toEqual([429, 'rate_limited']);

    for (let i = 0; i < LIMITS.checkout.limit; i++) await hit(w.t.db, 'checkout', 'user-a');
    await expect(hit(w.t.db, 'checkout', 'user-a')).rejects.toThrow('rate_limited');
    await hit(w.t.db, 'checkout', 'user-b'); // someone else is unaffected
    await w.t.db.execute(sql`update rate_limits set window_start = window_start - interval '2 hours'`);
    await hit(w.t.db, 'checkout', 'user-a'); // new window
  });
});

describe('web push', () => {
  test('subscribe, fan out push-worthy notifications once, drop dead subscriptions', async () => {
    const w = await world();
    const a = await w.member('alice');
    const b = await w.member('bobby');
    expect((await a.get('/push/config')).body).toEqual({ enabled: true, publicKey: 'test-public-key' });
    expect((await a.post('/push/subscriptions', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'k', auth: 'a' } })).status).toBe(400);
    const sub = { endpoint: 'https://push.example.com/alice-1', keys: { p256dh: 'p', auth: 'a' } };
    expect((await a.post('/push/subscriptions', sub)).body).toEqual({ ok: true });
    await a.post('/push/subscriptions', sub); // idempotent

    await w.job('push'); // drain the 'activated' rows from joining
    w.push.sent.length = 0;

    const p = await newPost(a, 'hello from alice');
    await b.post(`/posts/${p.id}/like`); // in-app only
    await b.post('/posts', { body: 'hi alice!', parentId: p.id });
    const r1 = await w.job('push');
    expect(r1).toEqual({ status: 'ran', result: { sent: 1, skipped: 1, removed: 0, failed: 0 } });
    expect(w.push.sent).toEqual([{
      endpoint: sub.endpoint,
      msg: { title: '@bobby replied', body: 'hi alice!', url: expect.stringMatching(new RegExp(`^/p/${p.id}#`)), tag: expect.any(String) },
    }]);
    expect((await w.job('push')).result).toEqual({ sent: 0, skipped: 0, removed: 0, failed: 0 }); // nothing twice

    // notifications that sat unpushed for over an hour (downtime) are not sent late
    await b.post('/posts', { body: 'late reply', parentId: p.id });
    await w.t.db.execute(sql`update notifications set created_at = now() - interval '2 hours' where pushed_at is null`);
    expect((await w.job('push')).result).toMatchObject({ sent: 0, skipped: 1 });

    // the browser unsubscribed behind our back → 410 → row removed
    w.push.gone.add(sub.endpoint);
    await b.post('/posts', { body: 'are you there?', parentId: p.id });
    expect((await w.job('push')).result).toMatchObject({ sent: 0, removed: 1 });
    expect(await w.rowsOf(sql`select 1 from push_subscriptions`)).toEqual([]);

    await a.post('/push/subscriptions', sub);
    expect((await a.del('/push/subscriptions')).status).toBe(400); // body required
    expect((await a.req('DELETE', '/push/subscriptions', { endpoint: sub.endpoint })).body).toEqual({ ok: true });
  });
});
