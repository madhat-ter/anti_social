import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { IMAGE_MAX_BYTES, POSTS_PER_HOUR } from '@anti/shared';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup();
  const member = async (handle: string, displayName = handle) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle, displayName);
    expect(r.status).toBe(200);
    return c;
  };
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const uid = async (handle: string) => (await rowsOf(sql`select id from users where handle = ${handle}`))[0].id as string;
  return { ...w, member, rowsOf, uid };
}

const pngBytes = (w = 40, h = 20) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();

async function newPost(c: Client, body: string, extra: Record<string, unknown> = {}) {
  const r = await c.post('/posts', { body, ...extra });
  expect(r.status).toBe(200);
  return r.body;
}

describe('access control', () => {
  test('unauthenticated -> 401, waitlisted -> 403 no_seat', async () => {
    const w = await setup({ seatCap: 1 });
    const anon = w.client();
    expect((await anon.get('/feed')).status).toBe(401);
    expect((await anon.post('/posts', { body: 'x' })).status).toBe(401);
    expect((await anon.get('/notifications/unread-count')).status).toBe(401);

    await w.client().register(await w.mint(), 'alice');
    const b = w.client();
    expect((await b.register(await w.mint(), 'bob')).body.state).toBe('waitlisted');
    // notifications are open to any signed-in user (account updates reach the waitlisted); see lifecycle.test.ts
    for (const p of ['/feed', '/members', '/search?q=a', '/media/x.webp']) {
      const r = await b.get(p);
      expect([p, r.status, r.body.error]).toEqual([p, 403, 'no_seat']);
    }
    expect((await b.post('/posts', { body: 'hi' })).body.error).toBe('no_seat');
    expect((await b.upload('/uploads', await pngBytes())).body.error).toBe('no_seat');
  });
});

describe('posts and feed', () => {
  test('create, order newest first, cursor pagination', async () => {
    const { member } = await world();
    const a = await member('alice', 'Alice A');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await newPost(a, `  post ${i}  `)).id);

    const p = await newPost(a, 'last');
    expect(p).toMatchObject({
      body: 'last', deleted: false, parentId: null, rootId: null, replyCount: 0, likeCount: 0, likedByMe: false,
      images: [], canEdit: true, canDelete: true, editedAt: null,
      author: { handle: 'alice', displayName: 'Alice A', state: 'active' },
    });
    expect((await newPost(a, '  trimmed ')).body).toBe('trimmed');

    const page1 = await a.get('/feed?limit=3');
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((x: any) => x.body)).toEqual(['trimmed', 'last', 'post 4']);
    expect(page1.body.nextCursor).toBeString();
    const page2 = await a.get(`/feed?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items.map((x: any) => x.body)).toEqual(['post 3', 'post 2', 'post 1']);
    const page3 = await a.get(`/feed?limit=3&cursor=${encodeURIComponent(page2.body.nextCursor)}`);
    expect(page3.body.items.map((x: any) => x.body)).toEqual(['post 0']);
    expect(page3.body.nextCursor).toBeNull();
    expect((await a.get('/feed?cursor=garbage')).status).toBe(400);
    expect((await a.get('/feed?limit=999')).body.items.length).toBe(7);
  });

  test('body validation', async () => {
    const { member } = await world();
    const a = await member('alice');
    for (const body of [{ body: '' }, { body: '   ' }, {}, { body: 'x'.repeat(501) }]) {
      const r = await a.post('/posts', body);
      expect([JSON.stringify(body).slice(0, 20), r.status, r.body.error]).toEqual([JSON.stringify(body).slice(0, 20), 400, 'body_invalid']);
    }
    expect((await a.post('/posts', { body: 'x'.repeat(500) })).status).toBe(200);
    expect((await a.post('/posts', { body: 'hi', parentId: crypto.randomUUID() })).body.error).toBe('parent_not_found');
    expect((await a.post('/posts', { body: 'hi', parentId: 'nope' })).body.error).toBe('parent_not_found');
    expect((await a.post('/posts', { body: 'hi', imageIds: ['nope'] })).body.error).toBe('image_invalid');
  });

  test('rate limit: 21st post in an hour -> 429', async () => {
    const { member, t, uid } = await world();
    const a = await member('alice');
    const id = await uid('alice');
    await t.db.execute(sql`
      insert into posts(author_id, body, created_at)
      select ${id}::uuid, 'bulk ' || g, now() - interval '30 minutes' from generate_series(1, ${POSTS_PER_HOUR}) g`);
    const r = await a.post('/posts', { body: 'one too many' });
    expect([r.status, r.body.error]).toEqual([429, 'rate_limited']);
    await t.db.execute(sql`update posts set created_at = now() - interval '2 hours' where author_id = ${id}::uuid`);
    expect((await a.post('/posts', { body: 'fine now' })).status).toBe(200);
  });

  test('edit within window, after window, and not author', async () => {
    const { member, t } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const p = await newPost(a, 'orignal');

    expect((await b.patch(`/posts/${p.id}`, { body: 'hax' })).body.error).toBe('not_author');
    expect((await a.patch(`/posts/${p.id}`, { body: '' })).body.error).toBe('body_invalid');
    const e = await a.patch(`/posts/${p.id}`, { body: ' original ' });
    expect(e.status).toBe(200);
    expect(e.body.body).toBe('original');
    expect(e.body.editedAt).toBeString();
    expect((await a.get('/feed')).body.items[0].editedAt).toBeString();
    expect((await a.patch(`/posts/${crypto.randomUUID()}`, { body: 'x' })).status).toBe(404);

    await t.db.execute(sql`update posts set created_at = now() - interval '16 minutes' where id = ${p.id}::uuid`);
    const late = await a.patch(`/posts/${p.id}`, { body: 'too late' });
    expect([late.status, late.body.error]).toEqual([409, 'edit_window_closed']);
    const view = await a.get(`/posts/${p.id}`);
    expect(view.body.root).toMatchObject({ body: 'original', canEdit: false, canDelete: true });
  });

  test('delete: tombstone in thread, gone from feed, contribution removed, not author', async () => {
    const { member, rowsOf, uid } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const root = await newPost(a, 'root post');
    const reply = await newPost(b, 'bob reply', { parentId: root.id });
    const aid = await uid('alice');
    const bid = await uid('bob');
    expect((await rowsOf(sql`select 1 from contributions where ref_id = ${root.id}::uuid and kind = 'post'`)).length).toBe(1);

    expect((await b.del(`/posts/${root.id}`)).body.error).toBe('not_author');
    expect((await a.del(`/posts/${root.id}`)).body).toEqual({ ok: true });
    expect((await a.del(`/posts/${root.id}`)).status).toBe(404);
    expect((await rowsOf(sql`select 1 from contributions where user_id = ${aid}::uuid`)).length).toBe(0);
    expect((await rowsOf(sql`select 1 from contributions where user_id = ${bid}::uuid`)).length).toBe(1);

    expect((await a.get('/feed')).body.items).toHaveLength(0);
    const th = await b.get(`/posts/${reply.id}`);
    expect(th.status).toBe(200);
    expect(th.body.focusId).toBe(reply.id);
    expect(th.body.root).toMatchObject({ id: root.id, deleted: true, body: '', images: [], canEdit: false, canDelete: false });
    expect(th.body.replies.map((r: any) => r.body)).toEqual(['bob reply']);
    expect((await a.patch(`/posts/${root.id}`, { body: 'zombie' })).status).toBe(404);

    // deleting a reply leaves a tombstone, keeps the thread
    expect((await b.del(`/posts/${reply.id}`)).status).toBe(200);
    const th2 = await b.get(`/posts/${root.id}`);
    expect(th2.body.replies).toHaveLength(1);
    expect(th2.body.replies[0]).toMatchObject({ deleted: true, body: '' });
  });
});

describe('threads', () => {
  test('reply, reply-to-reply roots and counts', async () => {
    const { member } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const root = await newPost(a, 'root');
    const r1 = await newPost(b, 'r1', { parentId: root.id });
    const r2 = await newPost(a, 'r2', { parentId: r1.id });
    expect(r1).toMatchObject({ parentId: root.id, rootId: root.id });
    expect(r2).toMatchObject({ parentId: r1.id, rootId: root.id });

    // replies are not in the feed; root's replyCount counts the whole thread
    const feed = await a.get('/feed');
    expect(feed.body.items.map((x: any) => x.id)).toEqual([root.id]);
    expect(feed.body.items[0].replyCount).toBe(2);

    for (const focus of [root.id, r1.id, r2.id]) {
      const th = await b.get(`/posts/${focus}`);
      expect(th.status).toBe(200);
      expect(th.body.root.id).toBe(root.id);
      expect(th.body.replies.map((x: any) => x.body)).toEqual(['r1', 'r2']);
      expect(th.body.focusId).toBe(focus);
    }
    const th = await b.get(`/posts/${root.id}`);
    expect(th.body.replies[0].replyCount).toBe(1);
    expect(th.body.replies[1].replyCount).toBe(0);
    expect((await b.get(`/posts/${crypto.randomUUID()}`)).body.error).toBe('not_found');
    expect((await b.get('/posts/not-a-uuid')).status).toBe(404);

    const mine = await a.get('/members/alice/posts');
    expect(mine.body.items.map((x: any) => x.body)).toEqual(['r2', 'root']);
  });
});

describe('likes and notifications', () => {
  test('like idempotency, counts, unlike', async () => {
    const { member } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const p = await newPost(a, 'likeable');
    expect((await b.post(`/posts/${p.id}/like`)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await b.post(`/posts/${p.id}/like`)).body).toEqual({ likeCount: 1, likedByMe: true });
    expect((await a.post(`/posts/${p.id}/like`)).body).toEqual({ likeCount: 2, likedByMe: true });
    const f = (await b.get('/feed')).body.items[0];
    expect(f).toMatchObject({ likeCount: 2, likedByMe: true });
    expect((await b.del(`/posts/${p.id}/like`)).body).toEqual({ likeCount: 1, likedByMe: false });
    expect((await b.del(`/posts/${p.id}/like`)).body).toEqual({ likeCount: 1, likedByMe: false });
    expect((await b.get('/feed')).body.items[0]).toMatchObject({ likeCount: 1, likedByMe: false });
    expect((await b.post(`/posts/${crypto.randomUUID()}/like`)).status).toBe(404);
  });

  test('reply and like notifications, unread count, mark read', async () => {
    const { member } = await world();
    const a = await member('alice', 'Alice');
    const b = await member('bob', 'Bob');
    const p = await newPost(a, 'hello world, this is the root');

    // registration queues an 'activated' notification; clear it so we only count social ones
    await a.post('/notifications/read', {});
    await b.post('/notifications/read', {});

    // self-notify never
    await a.post(`/posts/${p.id}/like`);
    await newPost(a, 'self reply', { parentId: p.id });
    expect((await a.get('/notifications/unread-count')).body).toEqual({ unreadCount: 0 });

    const reply = await newPost(b, 'nice', { parentId: p.id });
    await b.post(`/posts/${p.id}/like`);
    await b.del(`/posts/${p.id}/like`);
    await b.post(`/posts/${p.id}/like`); // relike: no second notification
    expect((await a.get('/notifications/unread-count')).body).toEqual({ unreadCount: 2 });
    // replying to a reply notifies that reply's author, not the root's
    await newPost(a, 'thanks', { parentId: reply.id });
    expect((await b.get('/notifications/unread-count')).body).toEqual({ unreadCount: 1 });

    const list = await a.get('/notifications');
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(2);
    expect(list.body.nextCursor).toBeNull();
    const kinds = list.body.items.map((n: any) => n.kind).sort();
    expect(kinds).toEqual(['activated', 'like', 'reply']);
    const act = list.body.items.find((n: any) => n.kind === 'activated');
    expect(act).toMatchObject({ actor: null, post: null });
    const like = list.body.items.find((n: any) => n.kind === 'like');
    expect(like).toMatchObject({
      readAt: null, actor: { handle: 'bob', displayName: 'Bob' },
      post: { id: p.id, rootId: p.id, snippet: 'hello world, this is the root' },
    });
    const rep = list.body.items.find((n: any) => n.kind === 'reply');
    expect(rep.post).toMatchObject({ id: reply.id, rootId: p.id, snippet: 'nice' });

    const one = await a.post('/notifications/read', { ids: [like.id] });
    expect(one.body).toEqual({ ok: true, unreadCount: 1 });
    expect((await a.get('/notifications')).body.items.find((n: any) => n.id === like.id).readAt).toBeString();
    const all = await a.post('/notifications/read', {});
    expect(all.body).toEqual({ ok: true, unreadCount: 0 });
    // other users' notifications are untouched
    expect((await b.get('/notifications/unread-count')).body.unreadCount).toBe(1);

    const pg = await a.get('/notifications?limit=1');
    expect(pg.body.items).toHaveLength(1);
    expect(pg.body.nextCursor).toBeString();
  });
});

describe('images', () => {
  test('upload strips metadata, converts to WebP, attaches, serves', async () => {
    const { member, storage, client } = await world();
    const a = await member('alice');
    // 100x50 JPEG with EXIF orientation 6 (rotate 90deg) and GPS data
    const jpeg = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } },
      })
      .toBuffer();
    const inMeta = await sharp(jpeg).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.orientation).toBe(6);

    const up = await a.upload('/uploads', jpeg, 'image/jpeg', 'p.jpg');
    expect(up.status).toBe(200);
    expect(up.body.url).toMatch(/^\/api\/media\/[A-Za-z0-9-]+\.webp$/);
    expect(up.body).toMatchObject({ width: 50, height: 100 }); // auto-rotated

    const key = up.body.url.replace('/api/media/', '');
    const stored = storage.files.get(key)!;
    expect(stored.contentType).toBe('image/webp');
    const outMeta = await sharp(stored.bytes).metadata();
    expect(outMeta.format).toBe('webp');
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();
    expect([outMeta.width, outMeta.height]).toEqual([50, 100]);

    const p = await newPost(a, '', { imageIds: [up.body.id] });
    expect(p.body).toBe('');
    expect(p.images).toEqual([{ id: up.body.id, url: up.body.url, width: 50, height: 100 }]);
    expect((await a.get('/feed')).body.items[0].images).toHaveLength(1);

    const m = await a.raw('GET', up.body.url.replace('/api', ''));
    expect(m.status).toBe(200);
    expect(m.headers.get('content-type')).toBe('image/webp');
    expect(m.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await sharp(new Uint8Array(await m.arrayBuffer())).metadata()).format).toBe('webp');
    expect((await a.raw('GET', '/media/missing.webp')).status).toBe(404);
    expect((await client().raw('GET', up.body.url.replace('/api', ''))).status).toBe(401);

    // attached image cannot be reused; deleting the post removes the blob
    expect((await a.post('/posts', { body: 'again', imageIds: [up.body.id] })).body.error).toBe('image_invalid');
    expect((await a.del(`/posts/${p.id}`)).status).toBe(200);
    expect(storage.files.has(key)).toBe(false);
  });

  test('large images are downscaled to 2048, png and gif accepted', async () => {
    const { member } = await world();
    const a = await member('alice');
    const big = await pngBytes(3000, 1000);
    const up = await a.upload('/uploads', big);
    expect(up.body).toMatchObject({ width: 2048, height: 683 });
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'blue' } }).gif().toBuffer();
    expect((await a.upload('/uploads', gif, 'image/gif', 'a.gif')).status).toBe(200);
  });

  test('>5MB -> 413, non-image -> 415, max 4 images, other user upload -> image_invalid', async () => {
    const { member } = await world();
    const a = await member('alice');
    const b = await member('bob');
    const huge = new Uint8Array(IMAGE_MAX_BYTES + 1);
    const r = await a.upload('/uploads', huge);
    expect([r.status, r.body.error]).toEqual([413, 'image_too_large']);
    const bad = await a.upload('/uploads', new TextEncoder().encode('not an image'), 'text/plain', 'x.txt');
    expect([bad.status, bad.body.error]).toEqual([415, 'image_unsupported']);
    const trunc = await a.upload('/uploads', (await pngBytes()).subarray(0, 30));
    expect(trunc.status).toBe(415);

    const mine = await a.upload('/uploads', await pngBytes());
    const theirs = await b.upload('/uploads', await pngBytes());
    const stolen = await a.post('/posts', { body: 'x', imageIds: [theirs.body.id] });
    expect([stolen.status, stolen.body.error]).toEqual([400, 'image_invalid']);
    expect((await a.post('/posts', { body: 'x', imageIds: [crypto.randomUUID()] })).body.error).toBe('image_invalid');
    // failed post left my upload unattached
    expect((await a.post('/posts', { body: 'ok', imageIds: [mine.body.id] })).status).toBe(200);

    const five: string[] = [];
    for (let i = 0; i < 5; i++) five.push((await a.upload('/uploads', await pngBytes())).body.id);
    const tooMany = await a.post('/posts', { body: 'x', imageIds: five });
    expect([tooMany.status, tooMany.body.error]).toEqual([400, 'image_invalid']);
    const four = await a.post('/posts', { body: 'x', imageIds: five.slice(0, 4) });
    expect(four.body.images).toHaveLength(4);
  });
});

describe('search and members', () => {
  test('search finds posts and members', async () => {
    const w = await world();
    const a = await w.member('alice', 'Alice Wonder');
    await w.member('alicia', 'Someone Else');
    await w.member('bob', 'Bobby Alison');
    await newPost(a, 'Gardening tips for tomatoes');
    const hidden = await newPost(a, 'secret tomatoes hidden');
    const gone = await newPost(a, 'tomatoes deleted');
    await a.del(`/posts/${gone.id}`);
    await w.t.db.execute(sql`update posts set hidden_at = now() where id = ${hidden.id}::uuid`);
    await newPost(a, 'unrelated text');

    const r = await a.get('/search?q=tomatoes');
    expect(r.status).toBe(200);
    expect(r.body.posts.map((p: any) => p.body)).toEqual(['Gardening tips for tomatoes']);
    expect(r.body.members).toEqual([]);

    const m = await a.get('/search?q=ali');
    expect(m.body.members.map((x: any) => x.handle)).toEqual(['alice', 'alicia', 'bob']); // prefix matches first
    expect(m.body.members[0]).toMatchObject({ displayName: 'Alice Wonder', postCount: 2, invitedBy: null });
    expect((await a.get('/search?q=%25')).body.members).toEqual([]); // LIKE wildcards are escaped

    for (const q of ['', '   ', 'x'.repeat(101)]) {
      expect((await a.get('/search?q=' + encodeURIComponent(q))).body.error).toBe('query_invalid');
    }
    expect((await a.get('/search')).body.error).toBe('query_invalid');
  });

  test('members list, profile, member posts', async () => {
    const w = await world();
    const a = await w.member('alice', 'Alice');
    const b = await w.member('bob', 'Bob');
    const c = await w.member('carol', 'Carol');
    await w.t.db.execute(sql`update users set invited_by = (select id from users where handle = 'alice') where handle = 'bob'`);
    await w.t.db.execute(sql`
      update users set activated_at = now() - interval '1 day' * case handle when 'alice' then 3 when 'bob' then 2 else 1 end`);

    const list = await a.get('/members?limit=2');
    expect(list.body.items.map((m: any) => m.handle)).toEqual(['carol', 'bob']);
    expect(list.body.nextCursor).toBeString();
    const rest = await a.get(`/members?limit=2&cursor=${encodeURIComponent(list.body.nextCursor)}`);
    expect(rest.body.items.map((m: any) => m.handle)).toEqual(['alice']);
    expect(rest.body.nextCursor).toBeNull();

    const prof = await a.get('/members/BOB');
    expect(prof.status).toBe(200);
    expect(prof.body).toMatchObject({
      handle: 'bob', displayName: 'Bob', bio: '', state: 'active', invitedBy: { handle: 'alice' }, postCount: 0,
    });
    expect(prof.body.activatedAt).toBeString();
    expect((await a.get('/members/nobody')).body.error).toBe('not_found');

    const p1 = await newPost(b, 'bob one');
    await newPost(b, 'bob reply', { parentId: p1.id });
    const gone = await newPost(b, 'bob gone');
    await b.del(`/posts/${gone.id}`);
    await newPost(c, 'carol post');
    const posts = await a.get('/members/bob/posts');
    expect(posts.body.items.map((x: any) => x.body)).toEqual(['bob reply', 'bob one']);
    expect((await a.get('/members/bob/posts?limit=1')).body.nextCursor).toBeString();
    expect((await a.get('/members/bob')).body.postCount).toBe(2);

    // archived profiles still show; deleted accounts and their posts' authors vanish
    await w.t.db.execute(sql`update users set state = 'archived' where handle = 'carol'`);
    expect((await a.get('/members/carol')).body.state).toBe('archived');
    expect((await a.get('/members')).body.items.map((m: any) => m.handle)).not.toContain('carol');
    await w.t.db.execute(sql`select delete_account((select id from users where handle = 'bob'))`);
    expect((await a.get('/members/bob')).status).toBe(404);
    const feed = await a.get('/feed');
    expect(feed.body.items.find((x: any) => x.body === 'bob one').author).toBeNull();
  });
});
