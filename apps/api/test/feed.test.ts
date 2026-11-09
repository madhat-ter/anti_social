import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { cleanup, setup, type Client } from './client';

/** RFC §10.11: the feed stays newest first; these are the display rules on top of it. */
afterEach(cleanup);

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string, by?: Client) => {
    const c = w.client();
    const code = by ? (await by.post('/me/invites')).body.code : await w.mint();
    const r = await c.register(code, handle);
    expect(r.status).toBe(200);
    return c;
  };
  const uid = async (handle: string) => (await rowsOf(sql`select id from users where handle = ${handle}`))[0].id as string;
  /** pretend the member joined long ago: out of the 21-day "new here" window */
  const veteran = async (handle: string) => {
    await w.t.db.execute(sql`update users set activated_at = now() - interval '60 days' where handle = ${handle}`);
  };
  const say = async (c: Client, body: string, extra: Record<string, unknown> = {}) => {
    const r = await c.post('/posts', { body, ...extra });
    expect(r.status).toBe(200);
    return r.body;
  };
  /** move a post back in time (and its replies' window with it, when asked) */
  const age = async (id: string, hours: number) => {
    await w.t.db.execute(sql`update posts set created_at = now() - make_interval(hours => ${hours}) where id = ${id}::uuid`);
  };
  return { ...w, rowsOf, member, uid, veteran, say, age };
}

describe('labels: new here, first post', () => {
  test('a member in their first three weeks is "new"; afterwards not', async () => {
    const { member, veteran, say } = await world();
    const a = await member('alice');
    const b = await member('bob');
    await veteran('alice');
    await say(a, 'old hand');
    await say(b, 'newcomer');
    const items = (await b.get('/feed')).body.items;
    expect(items.map((x: any) => [x.body, x.author.isNew])).toEqual([['newcomer', true], ['old hand', false]]);
  });

  test('firstPost marks exactly one root post per author, ignoring replies, collab and event updates, and deleted posts', async () => {
    const { member, say, age } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const first = await say(a, 'one');
    expect(first.firstPost).toBe(true);
    const second = await say(a, 'two');
    expect(second.firstPost).toBe(false);
    const reply = await say(b, 'hi', { parentId: first.id });
    expect(reply.firstPost).toBe(false);
    // bob's reply does not use up his first post
    expect((await say(b, 'bob here')).firstPost).toBe(true);
    const feed = (await b.get('/feed')).body.items;
    expect(feed.filter((x: any) => x.firstPost).map((x: any) => x.body).sort()).toEqual(['bob here', 'one']);
    // deleting the first post hands the label to the next one
    expect((await a.del(`/posts/${first.id}`)).status).toBe(200);
    const after = (await b.get('/feed')).body.items;
    expect(after.find((x: any) => x.body === 'two').firstPost).toBe(true);
    // three weeks on, a first post is just a post
    await age(second.id, 22 * 24);
    expect((await b.get('/feed')).body.items.find((x: any) => x.body === 'two').firstPost).toBe(false);
  });
});

describe('order is likes-proof', () => {
  test('likes and replies never move a post; the feed is strictly newest first', async () => {
    const { member, say } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const old = await say(a, 'old');
    await say(a, 'middle');
    await say(a, 'new');
    for (const c of [a, b]) await c.post(`/posts/${old.id}/like`);
    await say(b, 'a reply', { parentId: old.id });
    const items = (await b.get('/feed')).body.items;
    expect(items.map((x: any) => x.body)).toEqual(['new', 'middle', 'old']);
    const keys = items.map((x: any) => `${x.createdAt}|${x.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);
  });
});

describe('the "new since" line and the end', () => {
  test('a first visit reaches a week back; caught-up moves the line forward only, and never past now', async () => {
    const { member, say, rowsOf, uid } = await world();
    const a = await member('alice');
    const b = await member('bob');
    await say(a, 'one');
    const v1 = (await b.get('/feed?visit=1')).body;
    expect(v1.items.length).toBe(1);
    expect(v1.visit).toMatchObject({ capped: true, newPosts: 1 });
    expect(Date.now() - Date.parse(v1.visit.since)).toBeGreaterThan(6.9 * 86_400_000);
    expect(typeof v1.visit.visitId).toBe('number');

    const through = v1.items[0].createdAt;
    const r = await b.post('/feed/caught-up', { through, visitId: v1.visit.visitId });
    expect(r.status).toBe(200);
    expect(r.body.seenThrough).toBe(through);
    const [log] = await rowsOf(sql`select new_posts, caught_up_at from feed_visits where id = ${v1.visit.visitId}`);
    expect(log.new_posts).toBe(1);
    expect(log.caught_up_at).not.toBeNull();

    // older "through" does nothing; a future one is clamped to now
    await b.post('/feed/caught-up', { through: '2001-01-01T00:00:00.000Z' });
    expect((await b.post('/feed/caught-up', { through: '2001-01-01T00:00:00.000Z' })).body.seenThrough).toBe(through);
    const future = (await b.post('/feed/caught-up', { through: '2999-01-01T00:00:00.000Z' })).body.seenThrough;
    expect(Date.parse(future)).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await b.post('/feed/caught-up', { through: 'yesterday' })).status).toBe(400);

    // the next visit starts at the line; only posts after it are new, and your own never count
    await b.post('/feed/caught-up', { through }); // (no-op, already past it)
    await w_reset(rowsOf, await uid('bob'), through);
    await say(a, 'two');
    await say(b, 'mine');
    const v2 = (await b.get('/feed?visit=1')).body.visit;
    expect(v2).toMatchObject({ since: through, capped: false, newPosts: 1 });
  });

  test('a reload resumes the frozen line, clamped to the week; the poll never starts a visit', async () => {
    const { member, say, rowsOf } = await world();
    const a = await member('alice');
    await say(a, 'x');
    const before = (await rowsOf(sql`select count(*)::int as n from feed_visits`))[0].n;
    expect((await a.get('/feed')).body.visit).toBeUndefined();
    const r = await a.get(`/feed?since=${encodeURIComponent('2001-01-01T00:00:00.000Z')}`);
    expect(r.body.visit.capped).toBe(true);
    expect(r.body.visit.visitId).toBeNull();
    const t = new Date(Date.now() - 3_600_000).toISOString();
    expect((await a.get(`/feed?since=${encodeURIComponent(t)}`)).body.visit).toMatchObject({ since: t, capped: false });
    expect((await a.get('/feed?since=soon')).status).toBe(400);
    expect((await rowsOf(sql`select count(*)::int as n from feed_visits`))[0].n).toBe(before);
    // a later page never carries the visit
    expect((await a.get('/feed?visit=1&limit=1')).body.nextCursor).toBeNull();
  });

  test('visitors read the week and leave no trace', async () => {
    const { member, say, rowsOf, client } = await world();
    const admin = await member('boss');
    await rowsOf(sql`update users set role = 'ops' where handle = 'boss'`);
    await say(admin, 'hello');
    const pass = await admin.post('/ops/visitor-passes', { label: 'test' });
    expect(pass.status).toBe(200);
    const v = client();
    expect((await v.post('/visit', { code: pass.body.code })).status).toBe(200);
    const before = (await rowsOf(sql`select count(*)::int as n from feed_visits`))[0].n;
    const r = await v.get('/feed?visit=1');
    expect(r.status).toBe(200);
    expect(r.body.visit).toMatchObject({ capped: true, visitId: null, newPosts: 1 });
    expect((await rowsOf(sql`select count(*)::int as n from feed_visits`))[0].n).toBe(before);
    expect((await v.post('/feed/caught-up', { through: new Date().toISOString() })).status).toBe(403);
    // and nobody sees a like count but the author
    expect(r.body.items[0].likeCount).toBeNull();
  });
});

describe('rows around the posts: conversations and events', () => {
  /** alice posts, then the viewer's line is set a little after it */
  async function scene() {
    const w = await world();
    const alice = await w.member('alice');
    const bob = await w.member('bob');
    const cleo = await w.member('cleo');
    const viewer = await w.member('vee');
    const root = await w.say(alice, 'thoughts on the park?');
    await w.age(root.id, 10);
    const line = new Date(Date.now() - 5 * 3_600_000).toISOString();
    await w_reset(w.rowsOf, await w.uid('vee'), line);
    const visit = async () => (await viewer.get('/feed?visit=1')).body.visit;
    return { ...w, alice, bob, cleo, viewer, root, line, visit };
  }

  test('two other people replying after the line make one row, at the newest reply', async () => {
    const s = await scene();
    await s.say(s.bob, 'love it', { parentId: s.root.id });
    expect((await s.visit()).threads).toEqual([]); // one person is not a conversation
    const last = await s.say(s.cleo, 'me too', { parentId: s.root.id });
    const v = await s.visit();
    expect(v.threads.length).toBe(1);
    expect(v.threads[0]).toMatchObject({ rootId: s.root.id, repliers: 2, at: last.createdAt, author: { handle: 'alice' } });
  });

  test('self-replies, your own replies, replies by one person twice and late replies do not count', async () => {
    const s = await scene();
    await s.say(s.alice, 'bump', { parentId: s.root.id });
    await s.say(s.viewer, 'hm', { parentId: s.root.id });
    await s.say(s.bob, 'a', { parentId: s.root.id });
    await s.say(s.bob, 'b', { parentId: s.root.id });
    expect((await s.visit()).threads).toEqual([]);
    // a reply more than 72 h after the post does not count: move the post back past the window
    const late = await s.say(s.cleo, 'late', { parentId: s.root.id });
    expect((await s.visit()).threads.length).toBe(1);
    await s.age(s.root.id, 80);
    await w_reset(s.rowsOf, await s.uid('vee'), new Date(Date.now() - 79 * 3_600_000).toISOString());
    expect((await s.visit()).threads).toEqual([]);
    expect(late.id).toBeString();
  });

  test('deleting the second reply removes the row; a post newer than the line gets none', async () => {
    const s = await scene();
    await s.say(s.bob, 'one', { parentId: s.root.id });
    const r2 = await s.say(s.cleo, 'two', { parentId: s.root.id });
    expect((await s.visit()).threads.length).toBe(1);
    await s.cleo.del(`/posts/${r2.id}`);
    expect((await s.visit()).threads).toEqual([]);
    const fresh = await s.say(s.alice, 'brand new');
    await s.say(s.bob, 'x', { parentId: fresh.id });
    await s.say(s.cleo, 'y', { parentId: fresh.id });
    expect((await s.visit()).threads).toEqual([]);
  });

  test('event rows: new public events by others; not your own, cancelled or past ones. The end card picks yours first', async () => {
    const s = await scene();
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const base = { description: 'x', location: 'park' };
    const ev = (await s.alice.post('/events', { ...base, title: 'Picnic', startsAt: inDays(3) })).body;
    await s.viewer.post('/events', { ...base, title: 'Mine', startsAt: inDays(2) });
    const gone = (await s.bob.post('/events', { ...base, title: 'Off', startsAt: inDays(4) })).body;
    await s.rowsOf(sql`update events set cancelled_at = now() where id = ${gone.id}::uuid`);
    const v = await s.visit();
    expect(v.events.map((e: any) => e.title)).toEqual(['Picnic']);
    expect(v.events[0]).toMatchObject({ id: ev.id, going: 0, host: { handle: 'alice' } });
    // soonest visible event first ("Mine" is in 2 days), until you are going to one
    expect(v.nextEvent).toMatchObject({ title: 'Mine', imGoing: false });
    expect((await s.viewer.post(`/events/${ev.id}/rsvp`)).status).toBe(200);
    expect((await s.visit()).nextEvent).toMatchObject({ title: 'Picnic', imGoing: true, going: 1 });
  });
});

describe('replies say what they answer (RFC §10.12)', () => {
  test('a reply in a member list carries its thread’s post: author and a snippet; a post carries none', async () => {
    const { member, say } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const root = await say(a, 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate.');
    const r1 = await say(b, 'In!', { parentId: root.id });
    await say(a, 'Great', { parentId: r1.id });
    const list = (await a.get('/members/bob/posts')).body.items;
    expect(list[0].replyTo).toEqual({
      rootId: root.id, author: { handle: 'alice', displayName: 'alice' },
      snippet: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate.',
    });
    expect((await a.get('/members/alice/posts')).body.items.map((x: any) => x.replyTo?.rootId ?? null)).toEqual([root.id, null]);
    // a deleted post says nothing about itself
    await a.del(`/posts/${root.id}`);
    expect((await a.get('/members/bob/posts')).body.items[0].replyTo).toMatchObject({ rootId: root.id, snippet: '' });
  });
});

/** set a member's line directly (tests only) */
async function w_reset(rowsOf: (q: ReturnType<typeof sql>) => Promise<any[]>, id: string, through: string) {
  await rowsOf(sql`update users set feed_seen_through = ${through}::timestamptz where id = ${id}::uuid`);
}

describe('the inviter hears about a first post', () => {
  test('once, for the first feed post only, and not for an invite minted by the system', async () => {
    const { member, say, rowsOf, uid } = await world();
    const host = await member('host');
    const guest = await member('guest', host);
    const p = await say(guest, 'hello everyone');
    await say(guest, 'and again');
    const n = await rowsOf(sql`select user_id, payload from notifications where kind = 'invitee_first_post'`);
    expect(n.length).toBe(1);
    expect(n[0].user_id).toBe(await uid('host'));
    expect(n[0].payload).toMatchObject({ postId: p.id, actorId: await uid('guest') });
    const list = (await host.get('/notifications')).body.items;
    expect(list.find((x: any) => x.kind === 'invitee_first_post')).toMatchObject({ actor: { handle: 'guest' }, post: { id: p.id } });

    // the host's own first post (invited by nobody) rings no one
    await say(host, 'me too');
    expect((await rowsOf(sql`select count(*)::int as n from notifications where kind = 'invitee_first_post'`))[0].n).toBe(1);
  });

  test('deleting the first post and posting again does not ring twice', async () => {
    const { member, say, rowsOf } = await world();
    const host = await member('host');
    const guest = await member('guest', host);
    const p = await say(guest, 'oops');
    await guest.del(`/posts/${p.id}`);
    await say(guest, 'take two');
    expect((await rowsOf(sql`select count(*)::int as n from notifications where kind = 'invitee_first_post'`))[0].n).toBe(1);
  });

  test('a reply first is not a first post', async () => {
    const { member, say, rowsOf } = await world();
    const host = await member('host');
    const guest = await member('guest', host);
    const root = await say(host, 'welcome');
    await say(guest, 'thanks', { parentId: root.id });
    expect((await rowsOf(sql`select count(*)::int as n from notifications where kind = 'invitee_first_post'`))[0].n).toBe(0);
  });
});
