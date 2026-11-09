import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { cleanup, setup } from './client';

afterEach(cleanup);

/** RFC §10.10: half an hour of looking, then an hour away. */
async function world() {
  const w = await setup({ seatCap: 20 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const run = (q: ReturnType<typeof sql>) => w.t.db.execute(q);
  return { ...w, member, run };
}

describe('screen time', () => {
  test('heartbeats add up, one beat carries at most a minute, and nothing is counted twice', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const s0 = (await maya.get('/me/screen-time')).body;
    expect(s0).toMatchObject({ usedSeconds: 0, limitSeconds: 1800, restSeconds: 3600, lockedUntil: null, windowStartedAt: null });

    expect((await maya.post('/me/screen-time/beat', { seconds: 30 })).body.usedSeconds).toBe(30);
    expect((await maya.post('/me/screen-time/beat', { seconds: 999 })).body.usedSeconds).toBe(90); // clamped to 60
    const s = (await maya.get('/me/screen-time')).body;
    expect(s.usedSeconds).toBe(90);
    expect(s.windowStartedAt).not.toBeNull();
  });

  test('at thirty minutes the member is locked out for an hour: only the lock screen, the timer and signing out answer', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    await theo.post('/posts', { body: 'Still here.' });
    expect((await maya.get('/feed')).status).toBe(200);

    let last: any = null;
    for (let i = 0; i < 30; i++) last = (await maya.post('/me/screen-time/beat', { seconds: 60 })).body;
    expect(last.usedSeconds).toBe(1800);
    expect(last.lockedUntil).not.toBeNull();
    const until = new Date(last.lockedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(3500_000);
    expect(until - Date.now()).toBeLessThanOrEqual(3600_000);

    // the walls
    const feed = await maya.get('/feed');
    expect(feed.status).toBe(403);
    expect(feed.body.error).toBe('rest_time');
    expect(feed.body.detail).toBe(last.lockedUntil);
    expect((await maya.post('/posts', { body: 'one more' })).status).toBe(403);
    expect((await maya.get('/members')).status).toBe(403);
    // the doors
    expect((await maya.get('/me')).status).toBe(200);
    expect((await maya.get('/me/screen-time')).body.lockedUntil).toBe(last.lockedUntil);
    // beats while locked count nothing
    expect((await maya.post('/me/screen-time/beat', { seconds: 60 })).body.usedSeconds).toBe(1800);
    // others are untouched
    expect((await theo.get('/feed')).status).toBe(200);

    // the hour passes: a fresh half hour, and the feed answers again
    await w.run(sql`update screen_time set locked_until = now() - interval '1 second'`);
    const fresh = (await maya.get('/me/screen-time')).body;
    expect(fresh).toMatchObject({ usedSeconds: 0, lockedUntil: null, windowStartedAt: null });
    expect((await maya.get('/feed')).status).toBe(200);

    // signing out works while locked
    for (let i = 0; i < 30; i++) await maya.post('/me/screen-time/beat', { seconds: 60 });
    expect((await maya.get('/feed')).status).toBe(403);
    expect((await maya.post('/auth/logout', {})).status).toBe(200);
  });

  test('an hour away opens a fresh half hour even before it was spent', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await maya.post('/me/screen-time/beat', { seconds: 60 });
    await maya.post('/me/screen-time/beat', { seconds: 60 });
    expect((await maya.get('/me/screen-time')).body.usedSeconds).toBe(120);
    await w.run(sql`update screen_time set updated_at = now() - interval '61 minutes'`);
    expect((await maya.get('/me/screen-time')).body.usedSeconds).toBe(0);
    expect((await maya.post('/me/screen-time/beat', { seconds: 10 })).body.usedSeconds).toBe(10);
  });

  test('an admin sees the timer count on and is never locked out', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await w.run(sql`update users set role = 'ops' where handle = 'boss'`);
    expect((await boss.get('/me/screen-time')).body.exempt).toBe(true);
    let last: any = null;
    for (let i = 0; i < 32; i++) last = (await boss.post('/me/screen-time/beat', { seconds: 60 })).body;
    expect(last.usedSeconds).toBe(1920); // past the half hour, uncapped
    expect(last.lockedUntil).toBeNull();
    expect((await boss.get('/feed')).status).toBe(200);
    // a lock left over from before they were made admin is dropped
    await w.run(sql`update screen_time set locked_until = now() + interval '30 minutes'`);
    expect((await boss.get('/feed')).status).toBe(200);
    const s = (await boss.get('/me/screen-time')).body;
    expect(s.lockedUntil).toBeNull();
  });

  test('a visitor has no screen time of their own', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await w.t.db.execute(sql`update users set role = 'ops' where handle = 'boss'`);
    const p = (await boss.post('/ops/visitor-passes', { label: '' })).body;
    const v = w.client();
    expect((await v.post('/visit', { code: p.code })).status).toBe(200);
    expect((await v.get('/me/screen-time')).status).toBe(403);
  });
});
