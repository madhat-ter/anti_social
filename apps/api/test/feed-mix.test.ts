import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { mixFeed, mixRand } from '@anti/shared';
import { cleanup, setup, type Client } from './client';

/** RFC §10.23: the newest post on top, the rest of what is new mixed, nobody twice in a row. */
afterEach(cleanup);

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const post = (id: string, handle: string | null, hoursAgo: number) =>
  ({ id, createdAt: new Date(NOW - hoursAgo * HOUR).toISOString(), author: handle ? { handle } : null });
/** the owner's scene: Maya and Inês post, then Rafi posts ten in a row */
const burst = () => [
  post('maya-walk', 'maya', 2.5),
  post('ines-zine', 'ines', 2.2),
  ...Array.from({ length: 10 }, (_, i) => post(`rafi-${i}`, 'rafi', 1.6 - i * 0.15)),
];
const handles = (xs: { author: { handle: string } | null }[]) => xs.map((x) => x.author?.handle ?? '-');

describe('mixFeed (pure)', () => {
  test('the newest post stays first, and two posts or fewer are simply newest first', () => {
    for (let seed = 1; seed < 40; seed++) expect(mixFeed(burst(), seed)[0]!.id).toBe('rafi-9');
    expect(mixFeed([post('a', 'x', 3), post('b', 'y', 1)], 7).map((p) => p.id)).toEqual(['b', 'a']);
    expect(mixFeed([], 7)).toEqual([]);
  });

  test('the same seed gives the same order; other seeds give other orders', () => {
    const list = [...burst(), post('juno', 'juno', 3), post('theo', 'theo', 4), post('ana', 'ana', 5)];
    const a = mixFeed(list, 42).map((p) => p.id);
    expect(mixFeed([...list].reverse(), 42).map((p) => p.id)).toEqual(a);
    const others = new Set(Array.from({ length: 20 }, (_, i) => mixFeed(list, 100 + i).map((p) => p.id).join()));
    expect(others.size).toBeGreaterThan(5);
    // nothing lost, nothing doubled
    expect([...a].sort()).toEqual(list.map((p) => p.id).sort());
  });

  test('a burst does not bury the others: never twice in a row while anyone else is waiting', () => {
    for (let seed = 1; seed < 60; seed++) {
      const h = handles(mixFeed(burst(), seed));
      // Maya and Inês come right after Rafi's newest, then Rafi again
      expect(h.slice(0, 4).sort()).toEqual(['ines', 'maya', 'rafi', 'rafi']);
      expect(h[1]).not.toBe('rafi');
    }
  });

  test('the same person is kept apart when there are enough others', () => {
    const list = [
      ...Array.from({ length: 4 }, (_, i) => post(`r${i}`, 'rafi', i * 0.5)),
      ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((h, i) => post(h, h, 0.2 + i * 0.4)),
    ];
    for (let seed = 1; seed < 40; seed++) {
      const h = handles(mixFeed(list, seed));
      const at = h.flatMap((x, i) => (x === 'rafi' ? [i] : []));
      for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThan(3);
    }
  });

  test('newer posts usually come first, but not always', () => {
    const list = [post('top', 'z', 0), post('fresh', 'a', 1), post('old', 'b', 48)];
    let freshFirst = 0;
    for (let seed = 1; seed <= 400; seed++) if (mixFeed(list, seed)[1]!.id === 'fresh') freshFirst++;
    // odds 0.94 : 0.06 (one hour old against two days old)
    expect(freshFirst).toBeGreaterThan(350);
    // within half a day it is a real mix
    const close = [post('top', 'z', 0), post('a', 'a', 1), post('b', 'b', 7)];
    let aFirst = 0;
    for (let seed = 1; seed <= 400; seed++) if (mixFeed(close, seed)[1]!.id === 'a') aFirst++;
    expect(aFirst).toBeGreaterThan(200);
    expect(aFirst).toBeLessThan(360);
  });

  test('deleted authors count as separate people; mixRand stays inside (0, 1)', () => {
    const list = [post('x', null, 0), post('y', null, 1), post('z', null, 2), post('w', 'w', 3)];
    expect(mixFeed(list, 3)).toHaveLength(4);
    for (let s = 0; s < 500; s++) {
      const u = mixRand(s, `id-${s}`);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  });
});

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    await rowsOf(sql`update users set activated_at = now() - interval '60 days' where handle = ${handle}`);
    return c;
  };
  const say = async (c: Client, body: string, hoursAgo: number) => {
    const r = await c.post('/posts', { body });
    expect(r.status).toBe(200);
    await rowsOf(sql`update posts set created_at = now() - make_interval(secs => ${hoursAgo * 3600}) where id = ${r.body.id}::uuid`);
    return r.body as { id: string };
  };
  /** maya and ines post, then rafi posts eight; theo last read the feed 20 hours ago */
  const scene = async () => {
    const theo = await member('theo');
    const maya = await member('maya');
    const ines = await member('ines');
    const rafi = await member('rafi');
    await say(maya, 'old one', 40);
    await say(ines, 'older one', 50);
    await say(maya, 'river walk on saturday', 2.5);
    await say(ines, 'the zine is out', 2.2);
    for (let i = 0; i < 8; i++) await say(rafi, `tape ${i}`, 1.6 - i * 0.15);
    await rowsOf(sql`update users set feed_seen_through = now() - interval '20 hours' where handle = 'theo'`);
    return { theo, maya, ines, rafi };
  };
  return { ...w, rowsOf, member, say, scene };
}

/** every page of one visit, following the cursors */
async function walk(c: Client, first: string, limit = 3) {
  const r = await c.get(`${first}${first.includes('?') ? '&' : '?'}limit=${limit}`);
  expect(r.status).toBe(200);
  const items = [...r.body.items];
  let cursor = r.body.nextCursor as string | null;
  while (cursor) {
    const p = await c.get(`/feed?cursor=${cursor}&limit=${limit}`);
    expect(p.status).toBe(200);
    items.push(...p.body.items);
    cursor = p.body.nextCursor;
  }
  return { visit: r.body.visit, bodies: items.map((x: any) => x.body as string), handles: items.map((x: any) => x.author.handle as string) };
}

describe('GET /feed, mixed (the default)', () => {
  test('newest on top, the burst spread out, every post once, then older posts newest first', async () => {
    const { scene } = await world();
    const { theo } = await scene();
    const v = await walk(theo, '/feed?visit=1');
    expect(v.visit.mix).toMatchObject({ seed: expect.any(Number), until: expect.any(String) });
    expect(v.bodies[0]).toBe('tape 7');
    expect(v.handles.slice(1, 3).sort()).toEqual(['ines', 'maya']);
    expect(v.bodies).toHaveLength(12);
    expect(new Set(v.bodies).size).toBe(12);
    // the posts under the line keep time order
    expect(v.bodies.slice(-2)).toEqual(['old one', 'older one']);
  });

  test('the same visit resumed (reload) gives the same mix; a new visit draws a new seed', async () => {
    const { scene } = await world();
    const { theo } = await scene();
    const a = await walk(theo, '/feed?visit=1', 4);
    const { since } = a.visit;
    const { seed, until } = a.visit.mix;
    const again = await walk(theo, `/feed?since=${encodeURIComponent(since)}&seed=${seed}&until=${encodeURIComponent(until)}`, 5);
    expect(again.bodies).toEqual(a.bodies);
    expect(again.visit.mix).toEqual({ seed, until });
    const seeds = new Set<number>();
    for (let i = 0; i < 4; i++) seeds.add((await theo.get('/feed?visit=1')).body.visit.mix.seed);
    expect(seeds.size).toBeGreaterThan(1);
  });

  test('a post made after the visit began waits for the "new posts" poll, which stays newest first', async () => {
    const { scene, say } = await world();
    const { theo, maya } = await scene();
    const first = await theo.get('/feed?visit=1&limit=3');
    await say(maya, 'just now', 0);
    const later = await walk(theo, `/feed?cursor=${first.body.nextCursor}`);
    expect(later.bodies).not.toContain('just now');
    const poll = await theo.get('/feed');
    expect(poll.body.visit).toBeUndefined();
    expect(poll.body.items[0].body).toBe('just now');
    expect(poll.body.items[1].body).toBe('tape 7');
    expect(poll.body.items[2].body).toBe('tape 6');
  });

  test('nothing new: plain newest first, with nothing to mix', async () => {
    const { scene, rowsOf } = await world();
    const { theo } = await scene();
    await rowsOf(sql`update users set feed_seen_through = now() where handle = 'theo'`);
    const v = await walk(theo, '/feed?visit=1', 4);
    expect(v.bodies.slice(0, 3)).toEqual(['tape 7', 'tape 6', 'tape 5']);
    expect(v.visit.newPosts).toBe(0);
  });

  test('a forged cursor is refused', async () => {
    const { member } = await world();
    const a = await member('alice');
    const bad = Buffer.from('mix|1|soon|later|0|').toString('base64url');
    expect((await a.get(`/feed?cursor=${bad}`)).status).toBe(400);
  });
});

describe('Settings: newest first', () => {
  test('a member can choose newest first; it is saved on the account', async () => {
    const { scene } = await world();
    const { theo } = await scene();
    expect((await theo.get('/me')).body.feedOrder).toBe('mixed');
    expect((await theo.patch('/me', { feedOrder: 'sideways' })).status).toBe(400);
    const r = await theo.patch('/me', { feedOrder: 'newest' });
    expect(r.status).toBe(200);
    expect(r.body.feedOrder).toBe('newest');
    const v = await walk(theo, '/feed?visit=1', 5);
    expect(v.visit.mix).toBeNull();
    expect(v.bodies.slice(0, 4)).toEqual(['tape 7', 'tape 6', 'tape 5', 'tape 4']);
    expect((await theo.patch('/me', { feedOrder: 'mixed' })).body.feedOrder).toBe('mixed');
  });

  test('visitors always get the mixed feed', async () => {
    const { scene, rowsOf, client } = await world();
    const { maya } = await scene();
    await rowsOf(sql`update users set role = 'ops' where handle = 'maya'`);
    const pass = await maya.post('/ops/visitor-passes', { label: 'test' });
    const v = client();
    expect((await v.post('/visit', { code: pass.body.code })).status).toBe(200);
    expect((await v.get('/me')).body.feedOrder).toBe('mixed');
    const r = await v.get('/feed?visit=1');
    expect(r.body.visit.mix).not.toBeNull();
    expect(r.body.items[0].body).toBe('tape 7');
    expect(r.body.items[1].author.handle).not.toBe('rafi');
  });
});
