import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
import { setOps } from '../src/lib/moderation';
import { previewWipe, wipeUser } from '../src/lib/wipe';
import { cleanup, setup } from './client';

afterEach(cleanup);

/** The ops `wipe` command: a demo account and everything it made, gone for real. */
async function world() {
  const w = await setup({ seatCap: 20 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const count = async (q: ReturnType<typeof sql>) => Number((await rows<{ n: number }>(w.t.db, q))[0]!.n);
  return { ...w, member, count };
}

describe('ops wipe (hard delete of a demo account)', () => {
  test('preview says what would go, and changes nothing', async () => {
    const w = await world();
    const bot = await w.member('bot');
    const human = await w.member('human');
    const post = (await bot.post('/posts', { body: 'A demo post.' })).body;
    await human.post('/posts', { body: 'A real reply.', parentId: post.id });
    await bot.post('/collabs', { title: 'Demo zine', description: 'x', interests: ['writing'], roles: [], teamMax: 4, joinMode: 'open' });
    await bot.post('/events', { title: 'Demo picnic', description: 'x', location: 'Park', startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() });

    const p = await previewWipe(w.t.db, 'bot');
    expect(p).toMatchObject({ handle: 'bot', role: 'member', posts: 1, joinedCollabs: 1, cohostedEvents: 0, pets: 0, projects: 0, repliesByOthers: 1 });
    expect(p.hostedCollabs.map((c) => c.title)).toEqual(['Demo zine']);
    expect(p.hostedEvents.map((e) => e.title)).toEqual(['Demo picnic']);
    // untouched
    expect(await w.count(sql`select count(*)::int as n from users where handle = 'bot'`)).toBe(1);
    expect(await w.count(sql`select count(*)::int as n from posts where body = 'A demo post.'`)).toBe(1);
  });

  test('wipes the account, its posts, its collabs and its events; a human reply stays', async () => {
    const w = await world();
    const bot = await w.member('bot');
    const human = await w.member('human');
    const post = (await bot.post('/posts', { body: 'A demo post.' })).body;
    const reply = (await human.post('/posts', { body: 'A real reply.', parentId: post.id })).body;
    await bot.post('/posts', { body: 'A demo reply of its own.', parentId: post.id });
    const collab = (await bot.post('/collabs', { title: 'Demo zine', description: 'x', interests: ['writing'], roles: [], teamMax: 4, joinMode: 'open' })).body;
    await human.post(`/collabs/${collab.id}/join`, {});
    const event = (await bot.post('/events', { title: 'Demo picnic', description: 'x', location: 'Park', startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })).body;
    await human.post(`/events/${event.id}/rsvp`, {});
    const pet = (await bot.post('/pets', { name: 'Rex', species: 'dog' })).body;
    await bot.post('/posts', { body: 'Woof.', petId: pet.id, petLabel: 'everyday' });

    const r = await wipeUser(w.t.db, '@bot');
    expect(r).toMatchObject({ handle: 'bot', posts: 3, collabs: 1, events: 1 });

    expect(await w.count(sql`select count(*)::int as n from users where handle = 'bot'`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from posts where body = 'A demo post.'`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from posts where body = 'A demo reply of its own.'`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from pets where name = 'Rex'`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from collabs where title = 'Demo zine'`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from events where title = 'Demo picnic'`)).toBe(0);
    // the human and their reply are still there; the reply lost the post it answered
    expect(await w.count(sql`select count(*)::int as n from users where handle = 'human'`)).toBe(1);
    const [left] = await rows<{ parent_id: string | null }>(w.t.db, sql`select parent_id from posts where id = ${reply.id}::uuid`);
    expect(left!.parent_id).toBeNull();
    expect(await w.count(sql`select count(*)::int as n from collab_members where user_id = (select id from users where handle = 'human')`)).toBe(0);
    expect(await w.count(sql`select count(*)::int as n from event_rsvps where user_id = (select id from users where handle = 'human')`)).toBe(0);
  });

  test('an admin is refused unless asked for by name, and the last admin always is', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const denied = await wipeUser(w.t.db, 'boss').catch((e) => e);
    expect(denied.code).toBe('is_admin');
    const last = await wipeUser(w.t.db, 'boss', { forceAdmin: true }).catch((e) => e);
    expect(last.code).toBe('last_admin');

    // with a second admin, --force-admin works
    await w.member('second');
    await setOps(w.t.db, 'second', true);
    const gone = await wipeUser(w.t.db, 'boss', { forceAdmin: true });
    expect(gone.handle).toBe('boss');
    expect(await w.count(sql`select count(*)::int as n from users where handle = 'boss'`)).toBe(0);
  });

  test('an unknown handle is a plain not_found', async () => {
    const w = await world();
    const e = await wipeUser(w.t.db, 'nobody').catch((x) => x);
    expect(e.code).toBe('not_found');
  });
});
