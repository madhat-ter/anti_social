import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { MONOLOGUE } from '@anti/shared';
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

/** a few bytes that start like a WebM file, which is all the server sniffs */
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(200).fill(7)]);
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, ...Array(200).fill(3)]);

async function sendAudio(c: Client, o: { bytes?: Uint8Array; durationMs?: number; peaks?: unknown; source?: string } = {}) {
  const form = new FormData();
  form.append('file', new File([(o.bytes ?? WEBM) as BlobPart], 'take.webm', { type: 'audio/webm' }));
  form.append('durationMs', String(o.durationMs ?? 42_000));
  form.append('peaks', JSON.stringify(o.peaks ?? Array.from({ length: 96 }, (_, i) => i % 100)));
  if (o.source) form.append('source', o.source);
  const r = await c.raw('POST', '/monologues/audio', form);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function monologue(c: Client, extra: Record<string, unknown> = {}, audio: Parameters<typeof sendAudio>[1] = {}) {
  const a = await sendAudio(c, audio);
  expect(a.status).toBe(200);
  const r = await c.post('/posts', {
    body: '', monologue: { audioId: a.body.id, title: 'On walking slowly', kind: 'thought', mine: true }, ...extra,
  });
  expect(r.status).toBe(200);
  return r.body;
}

describe('monologues (RFC §10.22)', () => {
  test('a recording becomes a post: title, kind, waveform, in the feed and on the Monologue page', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const p = await monologue(ana);
    expect(p.monologue).toMatchObject({ title: 'On walking slowly', kind: 'thought', durationMs: 42_000, source: 'recorded' });
    expect(p.monologue.peaks.length).toBe(MONOLOGUE.peaks);
    expect(p.body).toBe('');

    const feed = await ben.get('/feed');
    expect(feed.body.items.map((x: any) => x.id)).toContain(p.id);
    await ben.post('/posts', { body: 'just words' });
    const page = await ben.get('/monologues');
    expect(page.body.items.map((x: any) => x.id)).toEqual([p.id]);
    expect((await ben.get('/monologues?kind=thought')).body.items.length).toBe(1);
    expect((await ben.get('/monologues?kind=song')).body.items.length).toBe(0);
    // the profile shelf
    expect((await ben.get('/members/ana/monologues')).body.items.map((x: any) => x.id)).toEqual([p.id]);
    // it counts as a post for the lurker rule
    const c = await w.rowsOf(sql`select kind from contributions where ref_id = ${p.id}::uuid`);
    expect(c.map((x) => x.kind)).toEqual(['post']);
  });

  test('replies and likes work as on any post; a note can carry mentions', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const p = await monologue(ana, { body: 'recorded on the roof, @ben' });
    expect(p.mentions).toEqual(['ben']);
    expect((await ben.post(`/posts/${p.id}/like`)).status).toBe(200);
    const reply = await ben.post('/posts', { body: 'loved this', parentId: p.id });
    expect(reply.status).toBe(200);
    const thread = await ana.get(`/posts/${p.id}`);
    expect(thread.body.root.monologue.title).toBe('On walking slowly');
    expect(thread.body.root.likeCount).toBe(1);
    expect(thread.body.replies.length).toBe(1);
    // a monologue with no note is named by its title in notifications
    const bare = await monologue(ana);
    await ben.post(`/posts/${bare.id}/like`);
    const n = await ana.get('/notifications');
    const like = n.body.items.find((x: any) => x.kind === 'like' && x.post.id === bare.id);
    expect(like.post.snippet).toBe('On walking slowly');
  });

  test('the server checks the sound: real audio only, five minutes at most, a size cap', async () => {
    const w = await world();
    const ana = await w.member('ana');
    expect((await sendAudio(ana, { bytes: new Uint8Array(300).fill(1) })).status).toBe(415);
    expect((await sendAudio(ana, { durationMs: MONOLOGUE.maxSeconds * 1000 + 5_000 })).status).toBe(400);
    expect((await sendAudio(ana, { durationMs: 200 })).status).toBe(400);
    const m4a = await sendAudio(ana, { bytes: M4A, source: 'uploaded' });
    expect(m4a.status).toBe(200);
    const stored = [...w.storage.files.entries()].find(([k]) => m4a.body.url.endsWith(k));
    expect(stored?.[1].contentType).toBe('audio/mp4');
    // a broken waveform becomes a flat line, not an error
    const flat = await sendAudio(ana, { peaks: 'nonsense' });
    expect(flat.body.peaks.length).toBe(MONOLOGUE.peaks);
  });

  test('a monologue stands alone, needs a title and a kind, and must be yours to share', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const a = (await sendAudio(ana)).body.id;
    const base = { body: '', monologue: { audioId: a, title: 'x', kind: 'song', mine: true } };
    expect((await ana.post('/posts', { ...base, monologue: { ...base.monologue, mine: false } })).status).toBe(400);
    expect((await ana.post('/posts', { ...base, monologue: { ...base.monologue, title: '  ' } })).status).toBe(400);
    expect((await ana.post('/posts', { ...base, monologue: { ...base.monologue, kind: 'rant' } })).status).toBe(400);
    const root = (await ana.post('/posts', { body: 'hello' })).body;
    expect((await ana.post('/posts', { ...base, parentId: root.id })).status).toBe(400);
    // someone else's recording
    expect((await ben.post('/posts', base)).status).toBe(400);
    expect((await ana.post('/posts', base)).status).toBe(200);
    // posted once only
    expect((await ana.post('/posts', base)).status).toBe(400);
  });

  test('title and kind can be edited in the window; a plain post has no title', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const p = await monologue(ana);
    const e = await ana.patch(`/posts/${p.id}`, { body: 'a note after all', title: 'On walking', kind: 'yap' });
    expect(e.status).toBe(200);
    expect(e.body.monologue).toMatchObject({ title: 'On walking', kind: 'yap' });
    expect(e.body.body).toBe('a note after all');
    const plain = (await ana.post('/posts', { body: 'hi' })).body;
    expect((await ana.patch(`/posts/${plain.id}`, { body: 'hi', title: 'nope' })).status).toBe(400);
  });

  test('deleting erases the sound; so does an admin removing it', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const boss = await w.member('boss');
    await w.rowsOf(sql`update users set role = 'ops' where handle = 'boss'`);
    const p = await monologue(ana);
    const before = w.storage.files.size;
    expect((await ana.del(`/posts/${p.id}`)).status).toBe(200);
    expect(w.storage.files.size).toBe(before - 1);
    expect((await w.rowsOf(sql`select 1 from monologues where post_id = ${p.id}::uuid`)).length).toBe(0);

    const q = await monologue(ana);
    const n = w.storage.files.size;
    expect((await boss.post(`/ops/posts/${q.id}/remove`)).status).toBe(200);
    expect(w.storage.files.size).toBe(n - 1);
    expect((await boss.get('/monologues')).body.items.length).toBe(0);
  });

  test('closing an account takes its monologues with it', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await monologue(ana);
    await sendAudio(ana); // one never posted
    expect((await ana.del('/me')).status).toBe(200);
    expect(w.storage.files.size).toBe(0);
    expect((await ben.get('/monologues')).body.items.length).toBe(0);
  });

  test('the player can ask for part of the file (Safari needs it)', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const p = await monologue(ana);
    const path = p.monologue.url.replace(/^\/api/, '');
    const whole = await ana.raw('GET', path);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(whole.headers.get('content-type')).toBe('audio/webm');
    const part = await ana.raw('GET', path, undefined, { range: 'bytes=0-9' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-9/${WEBM.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    const tail = await ana.raw('GET', path, undefined, { range: 'bytes=-4' });
    expect((await tail.arrayBuffer()).byteLength).toBe(4);
    expect((await ana.raw('GET', path, undefined, { range: 'bytes=9999-' })).status).toBe(416);
  });

  test('the Monologue page has its own "new since" line', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    await monologue(ana);
    const first = await ben.get('/monologues?visit=1');
    expect(first.body.visit.newPosts).toBe(1);
    expect(first.body.visit.capped).toBe(true);
    const newest = first.body.items[0].createdAt;
    expect((await ben.post('/monologues/caught-up', { through: newest })).status).toBe(200);
    const again = await ben.get('/monologues?visit=1');
    expect(again.body.visit.newPosts).toBe(0);
    expect(again.body.visit.capped).toBe(false);
    // the feed's own line did not move
    const feed = await ben.get('/feed?visit=1');
    expect(feed.body.visit.capped).toBe(true);
  });

  test('search finds a monologue by its title', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const p = await monologue(ana);
    const r = await ana.get('/search?q=walking');
    expect(r.body.posts.map((x: any) => x.id)).toContain(p.id);
  });

  test('waiting recordings are capped: the oldest makes room', async () => {
    const w = await world();
    const ana = await w.member('ana');
    for (let i = 0; i < MONOLOGUE.maxPending + 2; i++) expect((await sendAudio(ana)).status).toBe(200);
    const pending = await w.rowsOf(sql`select 1 from monologues where post_id is null`);
    expect(pending.length).toBe(MONOLOGUE.maxPending);
    expect(w.storage.files.size).toBe(MONOLOGUE.maxPending);
  });
});
