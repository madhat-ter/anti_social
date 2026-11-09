import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 30 });
  const member = async (handle: string, displayName = handle) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle, displayName);
    expect(r.status).toBe(200);
    return c;
  };
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  return { ...w, member, rowsOf };
}

async function newPost(c: Client, body: string, extra: Record<string, unknown> = {}) {
  const r = await c.post('/posts', { body, ...extra });
  expect(r.status).toBe(200);
  return r.body;
}

describe('mentions (RFC §10.16)', () => {
  test('a real @handle is stored and notifies once', async () => {
    const w = await world();
    const mira = await w.member('mira', 'Mira');
    const ben = await w.member('ben', 'Ben');
    const p = await newPost(ben, 'look at this, @mira');
    expect(p.mentions).toEqual(['mira']);

    const stored = await w.rowsOf(sql`select user_id from post_mentions where post_id = ${p.id}::uuid`);
    expect(stored.length).toBe(1);
    const notes = await w.rowsOf(sql`
      select kind, payload from notifications
       where user_id = (select id from users where handle = 'mira') and kind = 'mention'`);
    expect(notes.length).toBe(1);
    expect(notes[0].payload.postId).toBe(p.id);
    // nothing reaches the author
    const self = await w.rowsOf(sql`
      select 1 from notifications where user_id = (select id from users where handle = 'ben') and kind = 'mention'`);
    expect(self.length).toBe(0);
    void mira;
  });

  test('unknown words and your own handle stay plain text', async () => {
    const w = await world();
    await w.member('mira');
    const ben = await w.member('ben');
    const p = await newPost(ben, 'hi @nobody_here and @ben, mail me@example.com');
    expect(p.mentions).toEqual([]);
    const stored = await w.rowsOf(sql`select 1 from post_mentions where post_id = ${p.id}::uuid`);
    expect(stored.length).toBe(0);
  });

  test('replying to someone and mentioning them pings once (reply wins)', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const ben = await w.member('ben');
    const root = await newPost(mira, 'root');
    const reply = await newPost(ben, 'answering you @mira', { parentId: root.id });
    expect(reply.mentions).toEqual(['mira']);
    const notes = await w.rowsOf(sql`
      select kind from notifications
       where user_id = (select id from users where handle = 'mira') and payload->>'postId' = ${reply.id}`);
    expect(notes.map((n) => n.kind)).toEqual(['reply']);
  });

  test('at most ten people per post', async () => {
    const w = await world();
    const author = await w.member('author');
    for (let i = 1; i <= 11; i++) await w.member(`user${i}`);
    const body = 'hello ' + Array.from({ length: 11 }, (_, i) => `@user${i + 1}`).join(' ');
    const p = await newPost(author, body);
    expect(p.mentions.length).toBe(10);
    const stored = await w.rowsOf(sql`select 1 from post_mentions where post_id = ${p.id}::uuid`);
    expect(stored.length).toBe(10);
  });

  test('an edit adds and removes mentions; only new people are told', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const cara = await w.member('cara');
    const ben = await w.member('ben');
    const p = await newPost(ben, 'hello @mira');
    expect((await ben.patch(`/posts/${p.id}`, { body: 'hello @mira and @cara' })).status).toBe(200);
    const after = await ben.get(`/posts/${p.id}`);
    expect(after.status).toBe(200);
    expect(after.body.root.mentions.sort()).toEqual(['mira', 'cara']);
    const noteFor = async (handle: string) => (await w.rowsOf(sql`
      select kind from notifications
       where user_id = (select id from users where handle = ${handle}) and payload->>'postId' = ${p.id}`)).length;
    expect(await noteFor('mira')).toBe(1);
    expect(await noteFor('cara')).toBe(1);

    expect((await ben.patch(`/posts/${p.id}`, { body: 'hello @cara' })).status).toBe(200);
    const again = await ben.get(`/posts/${p.id}`);
    expect(again.status).toBe(200);
    expect(again.body.root.mentions).toEqual(['cara']);
    expect(await noteFor('mira')).toBe(1); // removing a mention does not unsend, nor send again
    void mira;
    void cara;
  });

  test('the picker searches seated members only, never yourself', async () => {
    const w = await world();
    const mira = await w.member('mira', 'Mira Sen');
    const ben = await w.member('ben', 'Ben Ok');
    await w.member('noor', 'Noor Noor');
    const byHandle = await ben.get('/members/mention?q=ad');
    expect(byHandle.status).toBe(200);
    expect(byHandle.body.items[0].handle).toBe('mira');
    const all = await ben.get('/members/mention');
    expect(all.body.items.length).toBeLessThanOrEqual(8);
    expect(all.body.items.map((i: any) => i.handle)).not.toContain('ben');
    const byName = await ben.get('/members/mention?q=Noor');
    expect(byName.body.items.map((i: any) => i.handle)).toContain('noor');
    void mira;
  });
});
