import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@anti/db/testing';
import { createApp } from '../src/app';
import { FakeAuthenticator } from './fake-authenticator';
import { Client, cleanup, setup, ORIGIN, cfg } from './client';

afterEach(cleanup);

describe('registration', () => {
  test('join -> active with recovery code and session', async () => {
    const { mint, client } = await setup();
    const c = client();
    const r = await c.register(await mint(), 'alice', 'Alice');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('active');
    expect(r.body.recoveryCode).toMatch(/^[A-Za-z0-9-]{8,}$/);
    expect(r.body.sessionToken).toBeUndefined();
    expect(c.cookies.has('anti_session')).toBe(true);

    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ handle: 'alice', displayName: 'Alice', state: 'active', waitlist: null, lurker: null });
    expect(me.body.activatedAt).toBeString();

    const pks = await c.get('/me/passkeys');
    expect(pks.body).toHaveLength(1);
  });

  test('used invite cannot be reused', async () => {
    const { mint, client } = await setup();
    const code = await mint();
    expect((await client().register(code, 'alice')).status).toBe(200);
    const o = await client().post('/auth/register/options', { code, handle: 'bob', displayName: 'Bob' });
    expect(o.status).toBe(400);
    expect(o.body.error).toBe('invite_invalid');
  });

  test('cap full -> waitlisted with queue position', async () => {
    const { mint, client } = await setup({ seatCap: 1 });
    const a = client();
    expect((await a.register(await mint(), 'alice')).body.state).toBe('active');
    const b = client();
    const r = await b.register(await mint(), 'bob');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('waitlisted');
    const me = await b.get('/me');
    expect(me.body.state).toBe('waitlisted');
    expect(me.body.waitlist.position).toBe(1);
    expect(me.body.waitlist.offeredUntil).toBeNull();

    const c = client();
    await c.register(await mint(), 'carol');
    expect((await c.get('/me')).body.waitlist.position).toBe(2);
  });

  test('replayed challenge is rejected', async () => {
    const { mint, client } = await setup();
    const c = client();
    const o = await c.post('/auth/register/options', { code: await mint(), handle: 'alice', displayName: 'A' });
    const response = await c.authn.create(o.body.options, ORIGIN);
    expect((await c.post('/auth/register/verify', { challengeId: o.body.challengeId, response })).status).toBe(200);
    const again = await c.post('/auth/register/verify', { challengeId: o.body.challengeId, response });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  test('wrong origin in clientData is rejected', async () => {
    const { mint, client } = await setup();
    const c = client();
    const o = await c.post('/auth/register/options', { code: await mint(), handle: 'alice', displayName: 'A' });
    const response = await c.authn.create(o.body.options, 'http://evil.example');
    const r = await c.post('/auth/register/verify', { challengeId: o.body.challengeId, response });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('passkey_invalid');
    // nothing was created
    expect((await c.get('/me')).status).toBe(401);
  });
});

describe('login and sessions', () => {
  test('login with passkey -> new session; counter advances', async () => {
    const { t, mint, client } = await setup();
    const c = client();
    const reg = await c.register(await mint(), 'alice');
    expect(reg.status).toBe(200);
    const credId = c.authn.credentials[0]!;
    const idStr = Buffer.from(credId.id).toString('base64url');

    const c2 = new Client((c as any).app, c.authn);
    const l1 = await c2.login();
    expect(l1.status).toBe(200);
    expect(l1.body.state).toBe('active');
    expect((await c2.get('/me')).body.handle).toBe('alice');
    const [{ counter: n1 }] = ((await t.db.execute(sql`select counter from passkeys where id = ${idStr}`)) as any).rows as any;
    expect(Number(n1)).toBe(1);

    const l2 = await new Client((c as any).app, c.authn).login();
    expect(l2.status).toBe(200);
    const [{ counter: n2 }] = ((await t.db.execute(sql`select counter from passkeys where id = ${idStr}`)) as any).rows as any;
    expect(Number(n2)).toBe(2);
    expect(c.authn.counterOf(idStr)).toBe(2);
  });

  test('replaying an old assertion (stale counter) is rejected', async () => {
    const { mint, client } = await setup();
    const c = client();
    await c.register(await mint(), 'alice');
    const o1 = await c.post('/auth/login/options');
    const resp1 = await c.authn.get(o1.body.options, ORIGIN);
    expect((await c.post('/auth/login/verify', { challengeId: o1.body.challengeId, response: resp1 })).status).toBe(200);
    // new challenge, but reuse the old signed response (wrong challenge)
    const o2 = await c.post('/auth/login/options');
    const r = await c.post('/auth/login/verify', { challengeId: o2.body.challengeId, response: resp1 });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('passkey_invalid');
  });

  test('unknown credential -> 401 passkey_invalid', async () => {
    const { mint, client } = await setup();
    await client().register(await mint(), 'alice');
    const stranger = client();
    // stranger's authenticator has a credential the server does not know
    const alien = new FakeAuthenticator();
    const o = await alien.create({ rp: { id: 'localhost' }, challenge: 'abc', user: { id: 'x' } }, ORIGIN);
    expect(o.id).toBeString();
    const lo = await stranger.post('/auth/login/options');
    const response = await alien.get(lo.body.options, ORIGIN);
    const r = await stranger.post('/auth/login/verify', { challengeId: lo.body.challengeId, response });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('passkey_invalid');
  });

  test('mobile flow: sessionToken in body + Bearer auth', async () => {
    const { mint, client } = await setup();
    const m = client();
    m.mobile = true;
    const reg = await m.register(await mint(), 'mobi');
    expect(reg.body.sessionToken).toBeString();

    const bare = new Client((m as any).app, m.authn);
    bare.mobile = true;
    const l = await bare.login();
    expect(l.status).toBe(200);
    expect(l.body.sessionToken).toBeString();
    expect(l.body.sessionToken).not.toBe(reg.body.sessionToken);

    // Bearer only, no cookie jar
    const api = new Client((m as any).app);
    api.bearer = l.body.sessionToken;
    const me = await api.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe('mobi');

    api.bearer = 'garbage';
    expect((await api.get('/me')).status).toBe(401);
  });

  test('logout invalidates the session', async () => {
    const { mint, client } = await setup();
    const c = client();
    await c.register(await mint(), 'alice');
    const token = c.cookies.get('anti_session')!;
    expect((await c.post('/auth/logout')).body).toEqual({ ok: true });
    expect((await c.get('/me')).status).toBe(401);
    // the old token itself is dead, not merely the cleared cookie
    c.cookies.set('anti_session', token);
    expect((await c.get('/me')).status).toBe(401);
  });

  test('banned user session -> 401; banned login -> 403 account_unavailable', async () => {
    const { t, mint, client } = await setup();
    const admin = client();
    await admin.register(await mint(), 'boss');
    const victim = client();
    await victim.register(await mint(), 'victim');
    expect((await victim.get('/me')).status).toBe(200);
    const [{ id: vid }] = ((await t.db.execute(sql`select id from users where handle = 'victim'`)) as any).rows as any;
    const [{ id: aid }] = ((await t.db.execute(sql`select id from users where handle = 'boss'`)) as any).rows as any;
    await t.db.execute(sql`select ban_user(${vid}::uuid, ${aid}::uuid)`);

    expect((await victim.get('/me')).status).toBe(401);
    const l = await new Client((victim as any).app, victim.authn).login();
    expect(l.status).toBe(403);
    expect(l.body.error).toBe('account_unavailable');
  });
});

describe('passkey management', () => {
  test('add a second passkey, delete one, cannot delete the last', async () => {
    const { mint, client } = await setup();
    const c = client();
    await c.register(await mint(), 'alice');
    const first = Buffer.from(c.authn.credentials[0]!.id).toString('base64url');

    // second device
    const second = new Client((c as any).app);
    second.cookies = c.cookies;
    const added = await second.addPasskey('Laptop');
    expect(added.status).toBe(200);
    const secondId = added.body.id as string;

    const list = await c.get('/me/passkeys');
    expect(list.body).toHaveLength(2);
    expect(list.body.find((p: any) => p.id === secondId).deviceLabel).toBe('Laptop');

    // adding the same authenticator again would be excluded; the new device can log in
    const loginViaSecond = await new Client((c as any).app, second.authn).login();
    expect(loginViaSecond.status).toBe(200);

    expect((await c.del(`/me/passkeys/${first}`)).body).toEqual({ ok: true });
    expect((await c.get('/me/passkeys')).body).toHaveLength(1);

    const last = await c.del(`/me/passkeys/${secondId}`);
    expect(last.status).toBe(409);
    expect(last.body.error).toBe('last_passkey');
    expect((await c.get('/me/passkeys')).body).toHaveLength(1);
  });

  test('cannot delete someone else\'s passkey', async () => {
    const { mint, client } = await setup();
    const a = client();
    await a.register(await mint(), 'alice');
    const b = client();
    await b.register(await mint(), 'bob');
    const aliceKey = Buffer.from(a.authn.credentials[0]!.id).toString('base64url');
    const r = await b.del(`/me/passkeys/${aliceKey}`);
    expect(r.status).toBe(404);
    expect((await a.get('/me/passkeys')).body).toHaveLength(1);
  });
});

describe('recovery', () => {
  test('recover: old passkey dead, old sessions revoked, code rotated', async () => {
    const { mint, client } = await setup();
    const old = client();
    const reg = await old.register(await mint(), 'alice');
    const oldCode = reg.body.recoveryCode as string;
    expect((await old.get('/me')).status).toBe(200);

    const fresh = client(); // new device, new authenticator, no session
    const rec = await fresh.recover('alice', oldCode);
    expect(rec.status).toBe(200);
    const newCode = rec.body.recoveryCode as string;
    expect(newCode).not.toBe(oldCode);
    expect((await fresh.get('/me')).body.handle).toBe('alice');

    // old session revoked
    expect((await old.get('/me')).status).toBe(401);
    // old passkey no longer logs in
    const oldLogin = await new Client((old as any).app, old.authn).login();
    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body.error).toBe('passkey_invalid');
    // new passkey does
    expect((await new Client((old as any).app, fresh.authn).login()).status).toBe(200);
    expect((await fresh.get('/me/passkeys')).body).toHaveLength(1);

    // old code fails, new code works
    const reuse = await client().recover('alice', oldCode);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toBe('recovery_failed');
    expect((await client().recover('alice', newCode)).status).toBe(200);
  });

  test('wrong recovery code and unknown handle -> 401 recovery_failed', async () => {
    const { mint, client } = await setup();
    await client().register(await mint(), 'alice');
    const wrong = await client().post('/auth/recover/options', { handle: 'alice', recoveryCode: 'AAAA-BBBB-CCCC-DDDD' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('recovery_failed');
    const unknown = await client().post('/auth/recover/options', { handle: 'nobody', recoveryCode: 'AAAA-BBBB-CCCC-DDDD' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe('recovery_failed');
    expect(unknown.body).toEqual(wrong.body);
  });

  test('recovery code is case/format insensitive', async () => {
    const { mint, client } = await setup();
    const reg = await client().register(await mint(), 'alice');
    const messy = (reg.body.recoveryCode as string).toLowerCase().replace(/-/g, ' ');
    expect((await client().recover('ALICE', messy)).status).toBe(200);
  });
});

describe('invites', () => {
  test('seated member: 2 invites, third -> invite_limit; redeemed shows redeemedBy', async () => {
    const { mint, client } = await setup();
    const a = client();
    await a.register(await mint(), 'alice');

    const i1 = await a.post('/me/invites');
    const i2 = await a.post('/me/invites');
    expect(i1.status).toBe(200);
    expect(i1.body.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    expect(i1.body.expiresAt).toBeString();
    expect(i2.status).toBe(200);
    expect(i2.body.code).not.toBe(i1.body.code);

    const third = await a.post('/me/invites');
    expect(third.status).toBe(409);
    expect(third.body.error).toBe('invite_limit');

    const before = await a.get('/me/invites');
    expect(before.body).toHaveLength(2);
    expect(before.body.every((i: any) => i.status === 'open' && i.redeemedBy === null)).toBe(true);

    const b = client();
    const reg = await b.register(i1.body.code, 'bobby');
    expect(reg.status).toBe(200);
    expect((await b.get('/me')).body.invitedBy).toEqual({ handle: 'alice' });

    const after = await a.get('/me/invites');
    const redeemed = after.body.filter((i: any) => i.status === 'redeemed');
    expect(redeemed).toHaveLength(1);
    expect(redeemed[0].redeemedBy).toEqual({ handle: 'bobby' });
    expect(redeemed[0].redeemedAt).toBeString();
    expect(after.body.filter((i: any) => i.status === 'open')).toHaveLength(1);

    // slot freed up
    expect((await a.post('/me/invites')).status).toBe(200);
  });

  test('waitlisted user cannot create invites or list them', async () => {
    const { mint, client } = await setup({ seatCap: 1 });
    await client().register(await mint(), 'alice');
    const w = client();
    expect((await w.register(await mint(), 'wally')).body.state).toBe('waitlisted');
    const r = await w.post('/me/invites');
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('no_seat');
    expect((await w.get('/me/invites')).status).toBe(403);
  });

  test('unauthenticated invite creation -> 401', async () => {
    const { client } = await setup();
    expect((await client().post('/me/invites')).status).toBe(401);
  });
});

describe('account deletion', () => {
  test('DELETE /me frees the seat and promotes the waitlist', async () => {
    const { t, mint, client } = await setup({ seatCap: 1 });
    const a = client();
    await a.register(await mint(), 'alice');
    const w = client();
    expect((await w.register(await mint(), 'wally')).body.state).toBe('waitlisted');

    const d = await a.del('/me');
    expect(d.status).toBe(200);
    expect(d.body).toEqual({ ok: true });
    expect((await a.get('/me')).status).toBe(401);
    expect((await new Client((a as any).app, a.authn).login()).status).toBeOneOf([401, 403]);

    // A new invitee (priority 1) is activated directly; only reinstating members get paid offers.
    const me = await w.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.state).toBe('active');
    expect(me.body.waitlist).toBeNull();
    const [{ n }] = ((await t.db.execute(sql`select seats_used() as n`)) as any).rows as any;
    expect(Number(n)).toBe(1);
  });
});

describe('csrf with real sessions', () => {
  test('cookie session + foreign Origin -> 403 bad_origin on writes', async () => {
    const { mint, client } = await setup();
    const c = client();
    await c.register(await mint(), 'alice');
    const r = await (c as any).app.handle(
      new Request('http://localhost/me', {
        method: 'DELETE',
        headers: { origin: 'http://evil.example', cookie: `anti_session=${c.cookies.get('anti_session')}` },
      }),
    );
    expect(r.status).toBe(403);
    expect((await c.get('/me')).status).toBe(200);
  });
});

