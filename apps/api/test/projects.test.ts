import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { scalar } from '@anti/db';
import { PROJECTS_MAX, PROJECT_IMAGES_MAX } from '@anti/shared';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup();
  const member = async (handle: string) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle, handle);
    expect(r.status).toBe(200);
    return c;
  };
  return { ...w, member };
}

const png = (w = 40, h = 20) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 30, b: 200 } } }).png().toBuffer();

async function upload(c: Client): Promise<{ id: string; key: string }> {
  const r = await c.upload('/uploads', await png());
  expect(r.status).toBe(200);
  return { id: r.body.id, key: r.body.url.split('/').pop() };
}

describe('projects', () => {
  test('create with images; the contents list shows the first image as the cover', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const a = await upload(maya);
    const b = await upload(maya);
    const r = await maya.post('/me/projects', {
      title: '  Veloce  ', summary: 'A massage gun for people who hate massage guns.', body: 'Long write-up.\n\n\n\nSecond part.',
      year: '2026', role: 'Industrial designer', tools: ['Fusion 360', 'fusion 360', 'KeyShot'], team: 'Group of two', duration: '3 weeks',
      images: [
        { id: a.id, layout: 'left', heading: 'Concept', text: 'Why it looks like that.', caption: 'Early foam models' },
        { id: b.id },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      title: 'Veloce', year: 2026, role: 'Industrial designer', tools: ['Fusion 360', 'KeyShot'], team: 'Group of two',
      duration: '3 weeks', draft: false, mine: true, handle: 'maya', body: 'Long write-up.\n\nSecond part.',
      images: [
        { id: a.id, layout: 'left', heading: 'Concept', text: 'Why it looks like that.', caption: 'Early foam models', width: 40, height: 20 },
        { id: b.id, layout: 'full', heading: '', text: '', caption: '' },
      ],
    });
    expect(r.body.images[0].url).toBe(`/api/media/${a.key}`);

    const list = (await theo.get('/members/maya/projects')).body.items;
    expect(list).toEqual([{ id: r.body.id, title: 'Veloce', year: 2026, role: 'Industrial designer', draft: false, hidden: false, cover: { url: `/api/media/${a.key}`, width: 40, height: 20 } }]);
    const seen = (await theo.get(`/members/maya/projects/${r.body.id}`)).body;
    expect(seen).toMatchObject({ title: 'Veloce', mine: false });
    expect((await theo.get(`/members/theo/projects/${r.body.id}`)).status).toBe(404); // wrong owner in the path
    // the attached upload is no longer a pending post image: it cannot go on a post
    expect((await maya.post('/posts', { body: 'x', imageIds: [a.id] })).body.error).toBe('image_invalid');
  });

  test('drafts are only visible to their owner', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const d = (await maya.post('/me/projects', { title: 'Secret', draft: true })).body;
    const live = (await maya.post('/me/projects', { title: 'Public' })).body;
    expect((await maya.get('/members/maya/projects')).body.items.map((p: { title: string }) => p.title)).toEqual(['Secret', 'Public']);
    expect((await theo.get('/members/maya/projects')).body.items.map((p: { title: string }) => p.title)).toEqual(['Public']);
    expect((await theo.get(`/members/maya/projects/${d.id}`)).status).toBe(404);
    expect((await maya.get(`/members/maya/projects/${d.id}`)).body.title).toBe('Secret');
    await maya.patch(`/me/projects/${d.id}`, { draft: false });
    expect((await theo.get(`/members/maya/projects/${d.id}`)).body.title).toBe('Secret');
    expect((await theo.get(`/members/maya/projects/${live.id}`)).status).toBe(200);
  });

  test('update: fields change on their own; images replace the list, dropped ones lose their blob', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const a = await upload(maya);
    const b = await upload(maya);
    const p = (await maya.post('/me/projects', { title: 'Lamp', images: [{ id: a.id }, { id: b.id }] })).body;
    // fields only: images untouched
    const r1 = await maya.patch(`/me/projects/${p.id}`, { summary: 'A lamp.' });
    expect(r1.body.images.map((i: { id: string }) => i.id)).toEqual([a.id, b.id]);
    // reorder and annotate, drop a, add c
    const c = await upload(maya);
    const r2 = await maya.patch(`/me/projects/${p.id}`, { images: [{ id: c.id, layout: 'right', heading: 'Detail' }, { id: b.id, caption: 'Night' }] });
    expect(r2.body.images).toMatchObject([{ id: c.id, layout: 'right', heading: 'Detail' }, { id: b.id, caption: 'Night' }]);
    expect(w.storage.files.has(a.key)).toBe(false);
    expect(w.storage.files.has(b.key)).toBe(true);
    // the cover follows the first image
    expect((await maya.get('/members/maya/projects')).body.items[0].cover.url).toBe(`/api/media/${c.key}`);
  });

  test('only your own pending uploads can be attached; limits hold', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const theirs = await upload(theo);
    const stolen = await maya.post('/me/projects', { title: 'Nope', images: [{ id: theirs.id }] });
    expect([stolen.status, stolen.body.error]).toEqual([400, 'project_invalid']);
    expect((await maya.post('/me/projects', { title: 'Nope', images: [{ id: crypto.randomUUID() }] })).body.error).toBe('project_invalid');
    // an image already on a post cannot be attached
    const onPost = await upload(maya);
    await maya.post('/posts', { body: 'x', imageIds: [onPost.id] });
    expect((await maya.post('/me/projects', { title: 'Nope', images: [{ id: onPost.id }] })).body.error).toBe('project_invalid');
    // a failed create leaves nothing behind
    expect((await maya.get('/members/maya/projects')).body.items).toEqual([]);

    expect((await maya.post('/me/projects', { title: '' })).body.error).toBe('project_invalid');
    expect((await maya.post('/me/projects', { title: 'x'.repeat(81) })).body.error).toBe('project_invalid');
    expect((await maya.post('/me/projects', { title: 'x', year: 1800 })).body.error).toBe('project_invalid');
    expect((await maya.post('/me/projects', { title: 'x', images: [{ id: crypto.randomUUID(), layout: 'diagonal' }] })).body.error).toBe('project_invalid');
    const many = [];
    for (let i = 0; i <= PROJECT_IMAGES_MAX; i++) many.push({ id: (await upload(maya)).id });
    expect((await maya.post('/me/projects', { title: 'x', images: many })).body.error).toBe('project_invalid');

    for (let i = 0; i < PROJECTS_MAX; i++) expect((await maya.post('/me/projects', { title: `P${i}` })).status).toBe(200);
    const over = await maya.post('/me/projects', { title: 'One too many' });
    expect([over.status, over.body.error]).toEqual([409, 'project_limit']);
  });

  test('reorder, delete (with blobs), and no contribution is ever recorded', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const a = (await maya.post('/me/projects', { title: 'A' })).body;
    const b = (await maya.post('/me/projects', { title: 'B' })).body;
    const c = (await maya.post('/me/projects', { title: 'C' })).body;
    expect((await maya.post('/me/projects/order', { ids: [c.id, a.id] })).body).toEqual({ ok: true });
    expect((await maya.get('/members/maya/projects')).body.items.map((p: { title: string }) => p.title)).toEqual(['C', 'A', 'B']);
    expect((await theo.post('/me/projects/order', { ids: [a.id] })).status).toBe(404);
    expect((await theo.patch(`/me/projects/${a.id}`, { title: 'Mine now' })).status).toBe(404);
    expect((await theo.del(`/me/projects/${a.id}`)).status).toBe(404);

    const img = await upload(maya);
    await maya.patch(`/me/projects/${b.id}`, { images: [{ id: img.id }] });
    expect((await maya.del(`/me/projects/${b.id}`)).body).toEqual({ ok: true });
    expect(w.storage.files.has(img.key)).toBe(false);
    expect((await maya.get(`/members/maya/projects/${b.id}`)).status).toBe(404);
    expect((await maya.del(`/me/projects/${b.id}`)).status).toBe(404);

    expect(Number(await scalar<number>(w.t.db, sql`select count(*)::int from contributions`))).toBe(0);
  });

  test('seated only; banned owners vanish; a deleted account takes its projects along', async () => {
    const w = await setup({ seatCap: 2 });
    const member = async (h: string) => { const c = w.client(); await c.register(await w.mint(), h, h); return c; };
    const maya = await member('maya');
    const theo = await member('theo');
    const p = (await theo.post('/me/projects', { title: 'Chair' })).body;
    const waiting = w.client();
    await waiting.register(await w.mint(), 'pat');
    expect((await waiting.get('/members/theo/projects')).body.error).toBe('no_seat');
    expect((await waiting.post('/me/projects', { title: 'x' })).body.error).toBe('no_seat');
    expect((await w.client().get('/members/theo/projects')).status).toBe(401);

    await w.t.db.execute(sql`update users set state = 'banned' where handle = 'theo'`);
    expect((await maya.get('/members/theo/projects')).status).toBe(404);
    expect((await maya.get(`/members/theo/projects/${p.id}`)).status).toBe(404);

    await w.t.db.execute(sql`delete from users where handle = 'theo'`);
    expect(Number(await scalar<number>(w.t.db, sql`select count(*)::int from projects`))).toBe(0);
  });
});
