import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { FILE } from '@anti/shared';
import { JOBS, runJob } from '../src/lib/jobs';
import { cleanup, setup, type Client } from './client';

/**
 * RFC §10.24: cards from outside anti. Anyone with a member's share link can make them a card:
 * a typed name instead of an account, up to five photos. It waits in the member's private tray.
 */
afterEach(cleanup);

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle, handle)).status).toBe(200);
    return c;
  };
  const cleanupJob = () => runJob(w.t.db, JOBS.find((j) => j.name === 'cleanup')!, { storage: w.storage, payments: w.payments, push: w.push });
  return { ...w, rowsOf, member, cleanupJob };
}

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 30, g: 30, b: 200 } } }).png().toBuffer();

/** what the share page's form sends: fields, a JSON list of captions, the photos */
async function send(c: Client, handle: string, fields: Record<string, string> = {}, photos: number | File[] = 1) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: 'Riya', headline: 'How I know Maya', ...fields })) form.append(k, v);
  const files = typeof photos === 'number'
    ? await Promise.all(Array.from({ length: photos }, async (_, i) => new File([await png() as BlobPart], `p${i}.png`, { type: 'image/png' })))
    : photos;
  for (const f of files) form.append('photos', f);
  const r = await c.raw('POST', `/public/file/${handle}/cards`, form);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

describe('cards from outside anti', () => {
  test('only a shared File takes them; the card waits in the private tray under the typed name', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const out = w.client(); // nobody: no session at all

    expect((await send(out, 'maya')).status).toBe(404); // the link is off
    expect((await send(out, 'nobody')).status).toBe(404);
    await maya.patch('/me', { filePublic: true });
    const r = await send(out, 'maya', { name: '  Riya   Sen ', description: 'We shared a desk.', captions: JSON.stringify(['the desk', '']) }, 2);
    expect(r).toEqual({ status: 200, body: { ok: true } });

    const tray = (await maya.get('/me/file/tray')).body.items;
    expect(tray).toHaveLength(1);
    expect(tray[0]).toMatchObject({
      headline: 'How I know Maya', description: 'We shared a desk.', maker: null, guest: 'Riya Sen',
      own: false, mine: false, state: 'sent', publicOk: true, page: null,
    });
    expect(tray[0].photos.map((p: any) => p.caption)).toEqual(['the desk', '']);
    // she is told, with the name and no member behind it
    const bell = (await maya.get('/notifications')).body.items.find((n: any) => n.kind === 'file_card_received');
    expect(bell).toMatchObject({ actor: null, guestName: 'Riya Sen', cardTitle: 'How I know Maya' });
    // nothing shows anywhere until she says yes
    expect((await theo.get('/members/maya/file')).body.pages.every((p: any) => p.card === null)).toBe(true);
    expect((await out.get('/public/file/maya')).body.pages.every((p: any) => p.card === null)).toBe(true);
    const key = tray[0].photos[0].url.split('/').pop();
    expect((await out.get(`/public/file/maya/media/${key}`)).status).toBe(404);
  });

  test('placed, it shows inside and on the share page; the tab is the name; no one-per-person rule', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const out = w.client();
    await maya.patch('/me', { filePublic: true });
    await send(out, 'maya', { name: 'Riya of the long name here', headline: 'First' });
    await send(out, 'maya', { name: 'Riya of the long name here', headline: 'Second' });
    const [second, first] = (await maya.get('/me/file/tray')).body.items;
    expect([first.headline, second.headline]).toEqual(['First', 'Second']);

    expect((await maya.put('/me/file/pages/1', { cardId: first.id })).status).toBe(400); // gift pages only
    expect((await maya.put('/me/file/pages/7', { cardId: first.id })).status).toBe(200);
    expect((await maya.put('/me/file/pages/8', { cardId: second.id })).status).toBe(200); // the same name twice is fine
    const inside = (await theo.get('/members/maya/file')).body;
    expect(inside.pages[7]).toMatchObject({ label: 'Riya of the lo', card: { headline: 'First', guest: 'Riya of the long name here', maker: null, canReport: true } });
    expect(Array.from(inside.pages[7].label)).toHaveLength(FILE.labelMax);
    const outside = (await out.get('/public/file/maya')).body;
    expect(outside.pages[8]).toMatchObject({ label: 'Riya of the lo', card: { headline: 'Second', guest: 'Riya of the long name here' } });
    const pic = await out.raw('GET', (outside.pages[7].card.photos[0].url as string).replace('/api', ''));
    expect(pic.status).toBe(200);
    // placing rings nobody: there is no maker to tell
    expect((await w.rowsOf(sql`select count(*)::int as n from notifications where kind = 'file_card_placed'`))[0].n).toBe(0);
  });

  test('it needs a name, a headline and 1 to 5 photos; a robot that fills the trap is thanked and nothing is kept', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const out = w.client();
    await maya.patch('/me', { filePublic: true });
    expect((await send(out, 'maya', { name: '  ' })).status).toBe(400);
    expect((await send(out, 'maya', { name: 'x'.repeat(FILE.guestNameMax + 1) })).status).toBe(400);
    expect((await send(out, 'maya', { headline: '' })).status).toBe(400);
    expect((await send(out, 'maya', {}, 0)).status).toBe(400);
    expect((await send(out, 'maya', {}, FILE.guestPhotosMax + 1)).status).toBe(400);
    expect(await send(out, 'maya', { website: 'http://spam.example' })).toEqual({ status: 200, body: { ok: true } });
    // something that is not a picture: refused, and the pictures that came with it are not kept
    const mixed = [new File([await png() as BlobPart], 'ok.png', { type: 'image/png' }), new File(['not a picture'], 'x.png', { type: 'image/png' })];
    expect((await send(out, 'maya', {}, mixed)).status).toBe(415);
    expect((await w.rowsOf(sql`select count(*)::int as n from file_cards`))[0].n).toBe(0);
    expect(w.storage.files.size).toBe(0);
    expect((await maya.get('/me/file/tray')).body.items).toEqual([]);
    // five photos is fine
    expect((await send(out, 'maya', {}, FILE.guestPhotosMax)).status).toBe(200);
    expect(w.storage.files.size).toBe(FILE.guestPhotosMax);
  });

  test('three an hour from one internet connection, however many Files; the tray itself has no limit', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const out = w.client();
    await maya.patch('/me', { filePublic: true });
    await theo.patch('/me', { filePublic: true });
    expect((await send(out, 'maya', { headline: 'One' })).status).toBe(200);
    expect((await send(out, 'theo', { headline: 'Two' })).status).toBe(200);
    expect((await send(out, 'maya', { headline: 'Three' })).status).toBe(200);
    const fourth = await send(w.client(), 'maya', { headline: 'Four' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.detail).toContain('Three cards an hour');
    // words that do not fit are turned away before they count
    expect((await send(out, 'maya', { headline: '' })).status).toBe(400);
    // an hour on, the same connection may send again, and they keep piling up
    await w.rowsOf(sql`delete from rate_limits`);
    for (const h of ['Five', 'Six', 'Seven']) expect((await send(out, 'maya', { headline: h })).status).toBe(200);
    expect((await maya.get('/me/file/tray')).body.items).toHaveLength(5);
  });

  test('turning one down erases it and its photos; a visitor on a pass can send one like anyone outside', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await w.rowsOf(sql`update users set role = 'ops' where handle = 'maya'`);
    await maya.patch('/me', { filePublic: true });
    const pass = await maya.post('/ops/visitor-passes', { label: 'test' });
    const v = w.client();
    expect((await v.post('/visit', { code: pass.body.code })).status).toBe(200);
    expect((await send(v, 'maya')).status).toBe(200);
    const [c] = (await maya.get('/me/file/tray')).body.items;
    expect(w.storage.files.size).toBe(1);
    expect((await maya.post(`/me/file/tray/${c.id}/decline`)).status).toBe(200);
    expect((await maya.get('/me/file/tray')).body.items).toEqual([]);
    expect((await w.rowsOf(sql`select count(*)::int as n from file_cards`))[0].n).toBe(0);
    expect(w.storage.files.size).toBe(0);
  });

  test('one that waits off the File for 30 days is erased; one in the File stays; coming off a page starts the wait again', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const out = w.client();
    await maya.patch('/me', { filePublic: true });
    await send(out, 'maya', { headline: 'Waiting' });
    await send(out, 'maya', { headline: 'Placed' });
    await send(out, 'maya', { headline: 'Taken off' });
    const tray = (await maya.get('/me/file/tray')).body.items;
    const id = (h: string) => tray.find((c: any) => c.headline === h).id;
    await maya.put('/me/file/pages/7', { cardId: id('Placed') });
    await maya.put('/me/file/pages/8', { cardId: id('Taken off') });
    // a month and a day pass
    await w.rowsOf(sql`update file_cards set sent_at = sent_at - interval '31 days', updated_at = updated_at - interval '31 days', created_at = created_at - interval '31 days'`);
    expect((await maya.put('/me/file/pages/8', { cardId: null })).status).toBe(200);
    await w.cleanupJob();
    expect((await maya.get('/me/file/tray')).body.items.map((c: any) => c.headline)).toEqual(['Taken off']);
    expect((await maya.get('/members/maya/file')).body.pages[7].card.headline).toBe('Placed');
    expect(w.storage.files.size).toBe(2);
    // a member's card that waits is never swept
    const theo = await w.member('theo');
    const up = await theo.upload('/uploads', await png());
    const made = (await theo.post('/me/file/cards', { headline: 'From Theo', photos: [{ id: up.body.id }], forHandle: 'maya' })).body;
    await theo.post(`/me/file/cards/${made.id}/send`);
    await w.rowsOf(sql`update file_cards set sent_at = sent_at - interval '31 days', updated_at = updated_at - interval '31 days'`);
    await w.cleanupJob();
    expect((await maya.get('/me/file/tray')).body.items.map((c: any) => c.headline)).toEqual(['From Theo']);
  });

  test('reports and admin removal work as for any card; nobody is told when it goes', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const boss = await w.member('boss');
    await w.rowsOf(sql`update users set role = 'ops' where handle = 'boss'`);
    const out = w.client();
    await maya.patch('/me', { filePublic: true });
    await send(out, 'maya', { headline: 'Unkind' });
    await send(out, 'maya', { headline: 'Also unkind' });
    const tray = (await maya.get('/me/file/tray')).body.items;
    const a = tray.find((c: any) => c.headline === 'Unkind');
    const b = tray.find((c: any) => c.headline === 'Also unkind');
    // from the tray: she reports it, an admin removes it
    expect((await maya.post(`/file/cards/${a.id}/flag`, { reason: 'cruel' })).status).toBe(200);
    const q = (await boss.get('/ops/flags')).body.find((x: any) => x.kind === 'file_card');
    expect(q).toMatchObject({ cardId: a.id, fileOf: 'maya', author: null, flags: 1 });
    expect(q.body).toContain('signed "Riya"');
    expect((await boss.post(`/ops/file/cards/${a.id}/resolve`, { resolution: 'removed' })).status).toBe(200);
    // in the File: an admin removes it outright
    await maya.put('/me/file/pages/7', { cardId: b.id });
    expect((await boss.get('/members/maya/file')).body.pages[7].card.canModerate).toBe(true);
    expect((await boss.post(`/ops/file/cards/${b.id}/remove`)).status).toBe(200);
    expect((await w.rowsOf(sql`select count(*)::int as n from file_cards`))[0].n).toBe(0);
    expect((await w.rowsOf(sql`select count(*)::int as n from notifications where kind = 'file_card_removed'`))[0].n).toBe(0);
    expect(w.storage.files.size).toBe(0);
  });
});
