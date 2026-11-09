import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { pinProblem } from '@anti/shared';
import { cleanup, setup, TEST_SETUP, type Client } from './client';

/** RFC §10.13: joining with an invite and a 6-digit PIN, signing in with handle + PIN. */
afterEach(cleanup);

const PIN = '739206';

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  /** joins with a PIN (and finishes setup, like a real member) */
  const join = async (handle: string, pin = PIN) => {
    const c = w.client();
    const r = await c.post('/auth/join', { code: await w.mint(), handle, displayName: handle, pin });
    expect(r.status).toBe(200);
    expect((await c.put('/me/setup', TEST_SETUP)).status).toBe(200);
    return { c, recovery: r.body.recoveryCode as string };
  };
  const signIn = (handle: string, pin: string, c: Client = w.client()) => c.post('/auth/pin/login', { handle, pin });
  return { ...w, rowsOf, join, signIn };
}

describe('pinProblem', () => {
  test('refuses anything obvious, and the member’s own birthday', () => {
    for (const p of ['12345', '1234567', 'abcdef', '000000', '777777', '123456', '654321', '012345', '121212', '123123'])
      expect([p, pinProblem(p)]).not.toEqual([p, null]);
    expect(pinProblem('170595', '1995-05-17')).toContain('birthday');
    expect(pinProblem('051795', '1995-05-17')).toContain('birthday');
    expect(pinProblem('170595')).toBeNull();
    expect(pinProblem(PIN, '1995-05-17')).toBeNull();
  });
});

describe('joining and signing in', () => {
  test('a newcomer joins with a PIN, gets a recovery code, and signs in with handle + PIN', async () => {
    const w = await world();
    const weak = await w.client().post('/auth/join', { code: await w.mint(), handle: 'nova', displayName: 'Nova', pin: '111111' });
    expect(weak.body.error).toBe('pin_weak');
    const { c, recovery } = await w.join('nova');
    expect(recovery).toMatch(/^[A-Z0-9-]{30,}$/);
    expect((await c.get('/me')).body).toMatchObject({ handle: 'nova', state: 'active', pinSet: true });
    const [row] = await w.rowsOf(sql`select pin_hash from users where handle = 'nova'`);
    expect(row.pin_hash).toStartWith('$argon2id$');

    const fresh = w.client();
    const r = await w.signIn('@Nova', PIN, fresh);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('active');
    expect((await fresh.get('/me')).body.handle).toBe('nova');
  });

  test('a wrong PIN and an unknown handle get the same answer', async () => {
    const w = await world();
    await w.join('nova');
    const a = await w.signIn('nova', '999999');
    const b = await w.signIn('nobody', '999999');
    expect([a.status, a.body]).toEqual([401, { error: 'pin_invalid', detail: 'That handle and PIN don’t match.' }]);
    expect([b.status, b.body]).toEqual([a.status, a.body]);
  });

  test('a banned member with the right PIN is still turned away', async () => {
    const w = await world();
    await w.join('nova');
    await w.rowsOf(sql`update users set state = 'banned' where handle = 'nova'`);
    expect((await w.signIn('nova', PIN)).body.error).toBe('account_unavailable');
  });
});

describe('guessing', () => {
  test('five wrong rest the account 15 minutes (the right PIN waits too); the member is told', async () => {
    const w = await world();
    await w.join('nova');
    for (let i = 0; i < 4; i++) expect((await w.signIn('nova', '999999')).body.error).toBe('pin_invalid');
    const fifth = await w.signIn('nova', '999999');
    expect([fifth.status, fifth.body.error]).toEqual([423, 'pin_resting']);
    const [u] = await w.rowsOf(sql`select pin_locked_until, pin_locks from users where handle = 'nova'`);
    const mins = (new Date(u.pin_locked_until).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThan(16);
    expect((await w.signIn('nova', PIN)).body.error).toBe('pin_resting');
    expect((await w.rowsOf(sql`select count(*)::int as n from notifications where kind = 'pin_locked'`))[0].n).toBe(1);
  });

  test('ten wrong in a day lock PIN sign-in until a reset; the second rest is twice as long', async () => {
    const w = await world();
    await w.join('nova');
    for (let i = 0; i < 5; i++) await w.signIn('nova', '999999');
    await w.rowsOf(sql`update users set pin_locked_until = now() - interval '1 second' where handle = 'nova'`);
    for (let i = 0; i < 4; i++) expect((await w.signIn('nova', '999999')).body.error).toBe('pin_invalid');
    const tenth = await w.signIn('nova', '999999');
    expect([tenth.status, tenth.body.error]).toEqual([423, 'pin_blocked']);
    expect((await w.signIn('nova', PIN)).body.error).toBe('pin_blocked');
    expect((await w.rowsOf(sql`select count(*)::int as n from notifications where kind = 'pin_blocked'`))[0].n).toBe(1);
  });

  test('the right PIN clears the count', async () => {
    const w = await world();
    await w.join('nova');
    for (let i = 0; i < 4; i++) await w.signIn('nova', '999999');
    expect((await w.signIn('nova', PIN)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await w.signIn('nova', '999999')).body.error).toBe('pin_invalid');
  });

  test('the second rest doubles', async () => {
    const w = await world();
    await w.join('nova');
    await w.rowsOf(sql`update users set pin_locks = 1 where handle = 'nova'`);
    for (let i = 0; i < 5; i++) await w.signIn('nova', '999999');
    const [u] = await w.rowsOf(sql`select pin_locked_until from users where handle = 'nova'`);
    expect((new Date(u.pin_locked_until).getTime() - Date.now()) / 60_000).toBeGreaterThan(29);
  });
});

describe('forgot your PIN', () => {
  test('the recovery code: new PIN, unlocked, every device and passkey gone, a new recovery code', async () => {
    const w = await world();
    const { c, recovery } = await w.join('nova');
    await w.rowsOf(sql`update users set pin_blocked_at = now() where handle = 'nova'`);
    const fresh = w.client();
    const weak = await fresh.post('/auth/pin/reset', { handle: 'nova', code: recovery, pin: '170595' });
    expect(weak.body.error).toBe('pin_weak'); // her birthday
    const r = await fresh.post('/auth/pin/reset', { handle: 'nova', code: recovery, pin: '738204' });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCode).toBeString();
    expect(r.body.recoveryCode).not.toBe(recovery);
    expect((await c.get('/me')).status).toBe(401); // the old device is out
    expect((await fresh.get('/me')).body.handle).toBe('nova');
    expect((await w.signIn('nova', '738204')).status).toBe(200);
    // the old recovery code is spent
    expect((await w.client().post('/auth/pin/reset', { handle: 'nova', code: recovery, pin: '640217' })).body.error).toBe('reset_failed');
  });

  test('an admin’s code: one hour, one use, never for yourself; the member is told', async () => {
    const w = await world();
    const boss = await w.join('boss');
    const other = await w.join('chief');
    await w.rowsOf(sql`update users set role = 'ops' where handle in ('boss', 'chief')`);
    await w.join('nova');
    const member = await w.join('mona');
    expect((await member.c.post('/ops/users/nova/pin-reset')).status).toBe(404);
    expect((await boss.c.post('/ops/users/boss/pin-reset')).body.error).toBe('pin_reset_self');
    expect((await other.c.post('/ops/users/boss/pin-reset')).status).toBe(200);

    const first = (await boss.c.post('/ops/users/nova/pin-reset')).body;
    const second = (await boss.c.post('/ops/users/nova/pin-reset')).body;
    expect(second.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // a new code retires the older one
    expect((await w.client().post('/auth/pin/reset', { handle: 'nova', code: first.code, pin: '738204' })).body.error).toBe('reset_failed');
    await w.rowsOf(sql`update users set pin_locked_until = now() + interval '1 hour' where handle = 'nova'`);
    const ok = await w.client().post('/auth/pin/reset', { handle: 'nova', code: second.code, pin: '738204' });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCode).toBeNull();
    expect((await w.signIn('nova', '738204')).status).toBe(200); // unlocked too
    expect((await w.client().post('/auth/pin/reset', { handle: 'nova', code: second.code, pin: '640217' })).body.error).toBe('reset_failed');
    const n = await w.rowsOf(sql`select count(*)::int as n from notifications n join users u on u.id = n.user_id where u.handle = 'nova' and kind = 'pin_reset_code'`);
    expect(n[0].n).toBe(2);
    const log = await w.rowsOf(sql`select count(*)::int as n from pin_resets r join users u on u.id = r.created_by where u.handle = 'boss'`);
    expect(log[0].n).toBe(2);

    // an hour later the code is dead
    const third = (await boss.c.post('/ops/users/nova/pin-reset')).body;
    await w.rowsOf(sql`update pin_resets set expires_at = now() - interval '1 second' where used_at is null`);
    expect((await w.client().post('/auth/pin/reset', { handle: 'nova', code: third.code, pin: '640217' })).body.error).toBe('reset_failed');
  });
});

describe('changing the PIN', () => {
  test('needs the current PIN, refuses weak ones, and signs out every other device', async () => {
    const w = await world();
    const { c } = await w.join('nova');
    const phone = w.client();
    expect((await w.signIn('nova', PIN, phone)).status).toBe(200);
    expect((await c.put('/me/pin', { pin: '738204' })).body.error).toBe('pin_invalid');
    expect((await c.put('/me/pin', { pin: '738204', currentPin: '000001' })).body.error).toBe('pin_invalid');
    expect((await c.put('/me/pin', { pin: '170595', currentPin: PIN })).body.error).toBe('pin_weak');
    expect((await c.put('/me/pin', { pin: '738204', currentPin: PIN })).status).toBe(200);
    expect((await c.get('/me')).status).toBe(200);
    expect((await phone.get('/me')).status).toBe(401);
    expect((await w.signIn('nova', PIN)).body.error).toBe('pin_invalid');
    expect((await w.signIn('nova', '738204')).status).toBe(200);
  });

  test('a member who joined with a passkey has no PIN yet, and chooses one without a current PIN', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'olde');
    expect((await c.get('/me')).body.pinSet).toBe(false);
    expect((await w.signIn('olde', PIN)).body.error).toBe('pin_invalid');
    expect((await c.put('/me/pin', { pin: PIN })).status).toBe(200);
    expect((await c.get('/me')).body.pinSet).toBe(true);
    expect((await w.signIn('olde', PIN)).status).toBe(200);
  });
});
