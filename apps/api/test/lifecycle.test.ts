import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { JOBS, runJob, type Job } from '../src/lib/jobs';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

const job = (name: string) => JOBS.find((j) => j.name === name)!;

async function world(seatCap = 3) {
  const w = await setup({ seatCap });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const uid = async (handle: string) => (await rowsOf(sql`select id from users where handle = ${handle}`))[0].id as string;
  const member = async (handle: string) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle);
    expect(r.status).toBe(200);
    return c;
  };
  const tick = () => runJob(w.t.db, job('lifecycle'), { storage: w.storage, payments: w.payments });
  /** Makes `handle` look like a member who has read daily for 10 days for 40 days, without posting. */
  const makeLurker = async (handle: string) => {
    const id = await uid(handle);
    await w.t.db.execute(sql`update users set activated_at = now() - interval '40 days',
      last_seen_at = now(), last_seen_on = current_date where id = ${id}`);
    for (let d = 0; d < 10; d++)
      await w.t.db.execute(sql`insert into user_seen_days(user_id, day) values (${id}, current_date - ${d}::int) on conflict do nothing`);
  };
  const goQuiet = async (handle: string, days: number) => {
    await w.t.db.execute(sql`update users set activated_at = now() - interval '60 days',
      last_seen_at = now() - make_interval(days => ${days}), last_seen_on = current_date - ${days}::int where handle = ${handle}`);
  };
  return { ...w, rowsOf, uid, member, tick, makeLurker, goQuiet };
}

const me = async (c: Client) => (await c.get('/me')).body;

describe('scheduled jobs', () => {
  test('runJob takes the job lock and runs the body', async () => {
    const w = await world();
    const seen: string[] = [];
    const probe: Job = {
      name: 'probe', everyMs: 1,
      run: async (tx) => {
        const held = await tx.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`);
        seen.push(String((held as any).rows[0].n));
        return { ok: 1 };
      },
    };
    expect(await runJob(w.t.db, probe, { storage: w.storage, payments: w.payments })).toEqual({ status: 'ran', result: { ok: 1 } });
    expect(Number(seen[0])).toBeGreaterThanOrEqual(1);
  });

  test('a failing job rolls back its work', async () => {
    const w = await world();
    const bad: Job = {
      name: 'bad', everyMs: 1,
      run: async (tx) => {
        await tx.execute(sql`update settings set value = '999' where key = 'seat_cap'`);
        throw new Error('boom');
      },
    };
    await expect(runJob(w.t.db, bad, { storage: w.storage, payments: w.payments })).rejects.toThrow('boom');
    expect((await w.rowsOf(sql`select value from settings where key = 'seat_cap'`))[0].value).toBe(3);
  });

  test('cleanup removes expired sessions/challenges and orphaned uploads only', async () => {
    const w = await world();
    const a = await w.member('alice');
    const id = await w.uid('alice');
    await w.t.db.execute(sql`insert into sessions(token_hash, user_id, client, expires_at) values ('old', ${id}, 'web', now() - interval '1 minute')`);
    await w.t.db.execute(sql`insert into auth_challenges(challenge, purpose, expires_at) values ('c', 'login', now() - interval '1 minute')`);
    await w.storage.put('old.webp', new Uint8Array([1]), 'image/webp');
    await w.storage.put('new.webp', new Uint8Array([1]), 'image/webp');
    await w.t.db.execute(sql`insert into post_images(uploader_id, r2_key, width, height, created_at)
      values (${id}, 'old.webp', 1, 1, now() - interval '25 hours'), (${id}, 'new.webp', 1, 1, now())`);

    const r = await runJob(w.t.db, job('cleanup'), { storage: w.storage, payments: w.payments });
    expect(r).toEqual({ status: 'ran', result: { sessions: 1, challenges: 1, uploads: 1, rateLimits: 0, visitorPasses: 0 } });
    expect(w.storage.files.has('old.webp')).toBe(false);
    expect(w.storage.files.has('new.webp')).toBe(true);
    expect((await a.get('/me')).status).toBe(200); // live session survives
  });
});

describe('lurker flow', () => {
  test('flagged → /me shows grace and progress → two posts clear the flag on the next tick', async () => {
    const w = await world();
    const a = await w.member('alice');
    await w.makeLurker('alice');
    await w.tick();

    const m = await me(a);
    expect(m.state).toBe('flagged_lurker');
    expect(m.lurker).toMatchObject({ contributions: 0, required: 2 });
    const graceMs = new Date(m.lurker.graceEndsAt).getTime() - new Date(m.lurker.flaggedAt).getTime();
    expect(graceMs).toBe(7 * 86_400_000);

    // flagged members keep their seat and can post
    expect((await a.post('/posts', { body: 'hello again' })).status).toBe(200);
    expect((await me(a)).lurker.contributions).toBe(1);
    await w.tick();
    expect((await me(a)).state).toBe('flagged_lurker');

    expect((await a.post('/posts', { body: 'and again' })).status).toBe(200);
    await w.tick();
    const after = await me(a);
    expect(after.state).toBe('active');
    expect(after.lurker).toBeNull();

    const n = await a.get('/notifications');
    expect(n.body.items.map((i: any) => i.kind)).toContain('lurker_warning');
  });

  test('a post deleted during grace does not count', async () => {
    const w = await world();
    const a = await w.member('alice');
    await w.makeLurker('alice');
    await w.tick();
    const p = await a.post('/posts', { body: 'quick' });
    expect((await me(a)).lurker.contributions).toBe(1);
    await a.del(`/posts/${p.body.id}`);
    expect((await me(a)).lurker.contributions).toBe(0);
  });

  test('replies to your own post do not count; replies to someone else do', async () => {
    const w = await world();
    const a = await w.member('alice');
    const b = await w.member('bob');
    await w.makeLurker('alice');
    await w.tick();
    const mine = await a.post('/posts', { body: 'my post' });
    expect((await me(a)).lurker.contributions).toBe(1);
    // self-reply, and a reply to that self-reply: neither counts
    const self = await a.post('/posts', { body: 'replying to myself', parentId: mine.body.id });
    expect(self.status).toBe(200);
    await a.post('/posts', { body: 'still me', parentId: self.body.id });
    expect((await me(a)).lurker.contributions).toBe(1);
    // bob replies in alice's thread; alice answering bob counts
    const theirs = await b.post('/posts', { body: 'hi alice', parentId: mine.body.id });
    expect((await a.post('/posts', { body: 'hi bob', parentId: theirs.body.id })).status).toBe(200);
    expect((await me(a)).lurker.contributions).toBe(2);
  });

  test('grace expiry archives with reason lurker_grace_expired', async () => {
    const w = await world();
    const a = await w.member('alice');
    await w.makeLurker('alice');
    await w.tick();
    await w.t.db.execute(sql`update users set lurker_flagged_at = now() - interval '8 days' where handle = 'alice'`);
    await w.tick();
    const m = await me(a);
    expect(m.state).toBe('archived');
    expect(m.archived).toEqual({ reason: 'lurker_grace_expired', wasMember: true });
    expect((await a.get('/feed')).body.error).toBe('no_seat');
  });
});

describe('waitlist and reinstatement', () => {
  test('waitlisted user sees position and total, and is told when seated', async () => {
    const w = await world(1);
    const a = await w.member('alice');
    const b = w.client();
    expect((await b.register(await w.mint(), 'bob')).body.state).toBe('waitlisted');
    const c = w.client();
    await c.register(await w.mint(), 'carol');

    expect((await me(b)).waitlist).toEqual({ position: 1, total: 2, priority: 'new', offeredUntil: null });
    expect((await me(c)).waitlist).toMatchObject({ position: 2, total: 2 });
    expect((await b.get('/notifications')).status).toBe(200);

    await a.del('/me'); // frees the seat → bob promoted
    const mb = await me(b);
    expect(mb.state).toBe('active');
    expect(mb.waitlist).toBeNull();
    expect((await b.get('/notifications')).body.items.map((i: any) => i.kind)).toEqual(['activated']);
    expect((await me(c)).waitlist).toMatchObject({ position: 1, total: 1 });
  });

  test('inactive member is archived, rejoins with priority, gets a held seat', async () => {
    const w = await world(2);
    const a = await w.member('alice');
    const b = await w.member('bob');
    await w.goQuiet('alice', 31);
    await w.tick();
    // the 30-day rule is "not seen"; alice signing in afterwards does not undo it
    let m = await me(a);
    expect(m.state).toBe('archived');
    expect(m.archived).toEqual({ reason: 'inactive', wasMember: true });
    expect(m.waitlist).toBeNull();

    await w.member('carol'); // takes alice's seat
    const d = w.client();
    await d.register(await w.mint(), 'dave'); // waitlisted, priority new

    expect((await a.post('/me/waitlist/rejoin')).status).toBe(200);
    m = await me(a);
    expect(m.waitlist).toMatchObject({ position: 1, priority: 'reinstating', offeredUntil: null });
    expect((await me(d)).waitlist.position).toBe(2);

    await b.del('/me'); // seat frees → held for alice, not given to dave
    m = await me(a);
    expect(m.state).toBe('archived');
    const left = new Date(m.waitlist.offeredUntil).getTime() - Date.now();
    expect(left).toBeGreaterThan(71 * 3_600_000);
    expect(left).toBeLessThanOrEqual(72 * 3_600_000);
    expect((await me(d)).state).toBe('waitlisted');
    expect((await a.get('/notifications')).body.items.map((i: any) => i.kind)).toContain('seat_offered');

    // offer lapses → next tick releases it to dave; alice can rejoin again
    await w.t.db.execute(sql`update waitlist set offer_expires_at = now() - interval '1 second' where user_id = ${await w.uid('alice')}`);
    await w.tick();
    expect((await me(d)).state).toBe('active');
    m = await me(a);
    expect(m.waitlist).toBeNull();
    expect((await a.get('/notifications')).body.items[0].kind).toBe('seat_offer_expired');
    expect((await a.post('/me/waitlist/rejoin')).status).toBe(200);
  });

  test('waitlisted user unseen for 60 days decays out, rejoins as a new invitee', async () => {
    const w = await world(1);
    const a = await w.member('alice');
    const b = w.client();
    await b.register(await w.mint(), 'bob');
    await w.t.db.execute(sql`update users set last_seen_at = now() - interval '61 days', last_seen_on = current_date - 61 where handle = 'bob'`);
    await w.tick();

    const m = await me(b);
    expect(m.state).toBe('archived');
    expect(m.archived).toEqual({ reason: 'waitlist_decay', wasMember: false });

    expect((await b.post('/me/waitlist/rejoin')).status).toBe(200);
    expect((await me(b)).waitlist).toMatchObject({ priority: 'new', position: 1 });
    await a.del('/me');
    expect((await me(b)).state).toBe('active'); // new invitees are seated free, no offer
  });

  test('rejoin is refused for seated users', async () => {
    const w = await world();
    const a = await w.member('alice');
    expect((await a.post('/me/waitlist/rejoin')).body.error).toBe('rejoin_not_applicable');
  });
});
