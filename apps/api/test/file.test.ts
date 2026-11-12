import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { FILE } from '@anti/shared';
import { cleanup, setup, type Client } from './client';

/** RFC §10.24: the File, a drawer of 12 pages (7 own, 5 for cards made for you), one card a page. */
afterEach(cleanup);

async function world() {
  const w = await setup();
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle, handle)).status).toBe(200);
    return c;
  };
  return { ...w, rowsOf, member };
}

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 30, g: 30, b: 200 } } }).png().toBuffer();
async function upload(c: Client): Promise<string> {
  const r = await c.upload('/uploads', await png());
  expect(r.status).toBe(200);
  return r.body.id;
}
const card = async (c: Client, headline: string, extra: Record<string, unknown> = {}) => {
  const r = await c.post('/me/file/cards', { headline, photos: [{ id: await upload(c) }], ...extra });
  expect(r.status).toBe(200);
  return r.body;
};

describe('the drawer', () => {
  test('everyone has 12 pages: 7 own (the first is "Me") and 5 for cards made for them, all empty at first', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const f = (await theo.get('/members/maya/file')).body;
    expect(f.mine).toBe(false);
    expect(f.owner.handle).toBe('maya');
    expect(f.pages).toHaveLength(12);
    expect(f.pages.map((p: any) => p.side)).toEqual([...Array(7).fill('own'), ...Array(5).fill('gift')]);
    expect(f.pages[0].label).toBe('ME');
    expect(f.pages.every((p: any) => p.card === null)).toBe(true);
    expect((await maya.get('/members/maya/file')).body.mine).toBe(true);
    expect((await maya.get('/members/nobody/file')).status).toBe(404);
  });

  test('a card made straight onto a page shows there, photos in order with their captions', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const a = await upload(maya);
    const b = await upload(maya);
    const r = await maya.post('/me/file/cards', {
      headline: '  Hello,   I am Maya ', description: 'I print zines.\r\n\r\n\r\n\r\nAsk me about paper.',
      photos: [{ id: a, caption: 'the print room' }, { id: b }], page: 0,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ headline: 'Hello, I am Maya', description: 'I print zines.\n\nAsk me about paper.', own: true, mine: true, page: 0 });
    expect(r.body.photos.map((p: any) => [p.id, p.caption])).toEqual([[a, 'the print room'], [b, '']]);
    const page = (await theo.get('/members/maya/file')).body.pages[0];
    expect(page.card).toMatchObject({ headline: 'Hello, I am Maya', mine: false, maker: { handle: 'maya' } });
    // the uploads moved: they cannot also go on a post
    expect((await maya.post('/posts', { body: 'x', imageIds: [a] })).status).toBe(400);
  });

  test('a card needs a headline and 1 to 20 photos; text limits hold', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const id = await upload(maya);
    expect((await maya.post('/me/file/cards', { headline: '', photos: [{ id }] })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x', photos: [] })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x' })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x'.repeat(FILE.headlineMax + 1), photos: [{ id }] })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x', description: 'y'.repeat(FILE.descriptionMax + 1), photos: [{ id }] })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x', photos: [{ id, caption: 'c'.repeat(FILE.captionMax + 1) }] })).status).toBe(400);
    expect((await maya.post('/me/file/cards', { headline: 'x', photos: [{ id }, { id }] })).status).toBe(400);
    // 20 photos fit
    const many = [{ id }];
    for (let i = 1; i < FILE.photosMax; i++) many.push({ id: await upload(maya) });
    const ok = await maya.post('/me/file/cards', { headline: 'twenty', photos: many });
    expect(ok.status).toBe(200);
    expect(ok.body.photos).toHaveLength(20);
    const extra = await upload(maya);
    const r = await maya.patch(`/me/file/cards/${ok.body.id}`, { photos: [...many, { id: extra }] });
    expect(r.status).toBe(400);
  });

  test('only your own pending uploads can go on a card', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const theirs = await upload(theo);
    expect((await maya.post('/me/file/cards', { headline: 'x', photos: [{ id: theirs }] })).status).toBe(400);
    expect((await w.rowsOf(sql`select count(*)::int as n from file_cards`))[0].n).toBe(0);
  });
});

describe('pages', () => {
  test('placing, moving and taking off a card; own cards only go on own pages', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const a = await card(maya, 'A');
    const b = await card(maya, 'B');
    expect(a.page).toBeNull();
    expect((await maya.put('/me/file/pages/2', { cardId: a.id })).status).toBe(200);
    expect((await maya.put('/me/file/pages/2', { cardId: b.id })).status).toBe(200); // B replaces A; A is kept
    let cards = (await maya.get('/me/file/cards')).body.items;
    expect(Object.fromEntries(cards.map((c: any) => [c.headline, c.page]))).toEqual({ A: null, B: 2 });
    // moving B to page 4 empties page 2
    expect((await maya.put('/me/file/pages/4', { cardId: b.id })).status).toBe(200);
    const pages = (await maya.get('/members/maya/file')).body.pages;
    expect(pages[2].card).toBeNull();
    expect(pages[4].card.headline).toBe('B');
    // the last five pages are for cards others made
    expect((await maya.put('/me/file/pages/7', { cardId: a.id })).status).toBe(400);
    expect((await maya.put('/me/file/pages/12', { cardId: a.id })).status).toBe(404);
    expect((await maya.put('/me/file/pages/4', { cardId: null })).status).toBe(200);
    cards = (await maya.get('/me/file/cards')).body.items;
    expect(cards.every((c: any) => c.page === null)).toBe(true);
  });

  test('labels: own pages 1–6 can be named (14 characters); "Me" and the gift pages cannot', async () => {
    const w = await world();
    const maya = await w.member('maya');
    expect((await maya.put('/me/file/pages/1', { label: '  Vintage  ' })).status).toBe(200);
    expect((await maya.get('/members/maya/file')).body.pages[1].label).toBe('Vintage');
    expect((await maya.put('/me/file/pages/1', { label: 'x'.repeat(FILE.labelMax + 1) })).status).toBe(400);
    expect((await maya.put('/me/file/pages/0', { label: 'Myself' })).status).toBe(400);
    expect((await maya.put('/me/file/pages/8', { label: 'Friends' })).status).toBe(400);
    expect((await maya.get('/members/maya/file')).body.pages[0].label).toBe('ME');
  });

  test('reordering moves a page with its label and card; "Me" stays first', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const me = await card(maya, 'Me card', { page: 0 });
    const a = await card(maya, 'A', { page: 1 });
    const c = await card(maya, 'C', { page: 3 });
    await maya.put('/me/file/pages/1', { label: 'Coffee' });
    await maya.put('/me/file/pages/3', { label: 'Wine' });
    expect((await maya.post('/me/file/pages/order', { order: [3, 1, 2, 4, 5, 6] })).status).toBe(200);
    const pages = (await maya.get('/members/maya/file')).body.pages;
    expect(pages.slice(0, 4).map((p: any) => [p.label, p.card?.id ?? null])).toEqual([
      ['ME', me.id], ['Wine', c.id], ['Coffee', a.id], ['', null],
    ]);
    expect((await maya.post('/me/file/pages/order', { order: [0, 1, 2, 3, 4, 5] })).status).toBe(400);
    expect((await maya.post('/me/file/pages/order', { order: [1, 1, 2, 3, 4, 5] })).status).toBe(400);
  });
});

describe('cards', () => {
  test('editing and deleting are the maker’s; a deleted card leaves its page and its photos are erased', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const c = await card(maya, 'First', { page: 1 });
    const extra = await upload(maya);
    const r = await maya.patch(`/me/file/cards/${c.id}`, { headline: 'Second', photos: [{ id: extra, caption: 'new' }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ headline: 'Second', page: 1 });
    expect(r.body.photos.map((p: any) => p.id)).toEqual([extra]);
    expect((await theo.patch(`/me/file/cards/${c.id}`, { headline: 'Mine now' })).status).toBe(404);
    expect((await theo.del(`/me/file/cards/${c.id}`)).status).toBe(404);
    expect((await theo.put('/me/file/pages/1', { cardId: c.id })).status).toBe(404);
    expect((await maya.del(`/me/file/cards/${c.id}`)).status).toBe(200);
    expect((await maya.get('/members/maya/file')).body.pages[1].card).toBeNull();
    expect((await w.rowsOf(sql`select count(*)::int as n from file_card_photos`))[0].n).toBe(0);
  });

  test(`at most ${FILE.draftsMax} cards may wait off the File; placed cards do not count`, async () => {
    const w = await world();
    const maya = await w.member('maya');
    for (let i = 0; i < FILE.draftsMax; i++) await card(maya, `draft ${i}`);
    const id = await upload(maya);
    expect((await maya.post('/me/file/cards', { headline: 'one too many', photos: [{ id }] })).status).toBe(409);
    expect((await maya.post('/me/file/cards', { headline: 'onto a page', photos: [{ id }], page: 5 })).status).toBe(200);
  });

  test('closing the account erases the File', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await card(maya, 'Me', { page: 0 });
    expect((await maya.del('/me')).status).toBe(200);
    expect((await w.rowsOf(sql`select (select count(*) from file_cards)::int as c, (select count(*) from file_pages)::int as p, (select count(*) from file_card_photos)::int as i`))[0])
      .toEqual({ c: 0, p: 0, i: 0 });
  });

  test('visitors can look at a File but not at "my cards", and cannot write', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await card(maya, 'Me', { page: 0 });
    await w.rowsOf(sql`update users set role = 'ops' where handle = 'maya'`);
    const pass = await maya.post('/ops/visitor-passes', { label: 'test' });
    const v = w.client();
    expect((await v.post('/visit', { code: pass.body.code })).status).toBe(200);
    expect((await v.get('/members/maya/file')).body.pages[0].card.headline).toBe('Me');
    expect((await v.get('/me/file/cards')).status).toBe(403);
    expect((await v.put('/me/file/pages/1', { label: 'x' })).status).toBe(403);
  });
});

describe('cards made for someone', () => {
  const gift = async (c: Client, forHandle: string, headline: string, extra: Record<string, unknown> = {}) => {
    const r = await c.post('/me/file/cards', { headline, photos: [{ id: await upload(c) }], forHandle, ...extra });
    expect(r.status).toBe(200);
    return r.body;
  };

  test('a card for someone is the maker’s draft until sent; then it waits in their private tray', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const ines = await w.member('ines');
    const c = await gift(theo, 'maya', 'Maya, by Theo', { publicOk: true });
    expect(c).toMatchObject({ own: false, mine: true, state: 'draft', for: { handle: 'maya' }, publicOk: true, page: null });
    expect((await maya.get('/me/file/tray')).body.items).toEqual([]);
    expect((await maya.get('/notifications')).body.items.filter((x: any) => x.kind.startsWith('file_'))).toEqual([]);
    // not for yourself, not for nobody, never straight onto a page
    expect((await theo.post('/me/file/cards', { headline: 'x', photos: [{ id: await upload(theo) }], forHandle: 'theo' })).status).toBe(400);
    expect((await theo.post('/me/file/cards', { headline: 'x', photos: [{ id: await upload(theo) }], forHandle: 'ghost' })).status).toBe(404);
    expect((await theo.post('/me/file/cards', { headline: 'x', photos: [{ id: await upload(theo) }], forHandle: 'maya', page: 8 })).status).toBe(400);

    const sent = await theo.post(`/me/file/cards/${c.id}/send`);
    expect(sent.body.state).toBe('sent');
    const tray = (await maya.get('/me/file/tray')).body.items;
    expect(tray.map((x: any) => [x.headline, x.maker.handle, x.mine])).toEqual([['Maya, by Theo', 'theo', false]]);
    expect((await maya.get('/notifications')).body.items[0]).toMatchObject({ kind: 'file_card_received', actor: { handle: 'theo' }, cardTitle: 'Maya, by Theo' });
    // nobody else sees it: not on her File, not in anyone else's tray
    expect((await ines.get('/members/maya/file')).body.pages.every((p: any) => p.card === null)).toBe(true);
    expect((await ines.get('/me/file/tray')).body.items).toEqual([]);
    expect((await ines.put('/me/file/pages/8', { cardId: c.id })).status).toBe(404);
    // her own cards list is only her own
    expect((await maya.get('/me/file/cards')).body.items).toEqual([]);
  });

  test('only the recipient places it, on a gift page; the maker is told, and the tab carries their handle', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const c = await gift(theo, 'maya', 'Maya, by Theo');
    // an unsent card cannot be placed
    expect((await maya.put('/me/file/pages/8', { cardId: c.id })).status).toBe(404);
    await theo.post(`/me/file/cards/${c.id}/send`);
    expect((await theo.put('/me/file/pages/8', { cardId: c.id })).status).toBe(404);
    expect((await maya.put('/me/file/pages/2', { cardId: c.id })).status).toBe(400); // her own half is hers
    expect((await maya.put('/me/file/pages/8', { cardId: c.id })).status).toBe(200);
    const page = (await theo.get('/members/maya/file')).body.pages[8];
    expect(page).toMatchObject({ side: 'gift', label: 'theo', card: { headline: 'Maya, by Theo', mine: true, state: 'placed' } });
    expect((await maya.get('/me/file/tray')).body.items).toEqual([]);
    const n = (await theo.get('/notifications')).body.items;
    expect(n[0]).toMatchObject({ kind: 'file_card_placed', actor: { handle: 'maya' }, cardTitle: 'Maya, by Theo' });
    // moving it to another gift page, or taking it off and putting it back, does not ring again
    await maya.put('/me/file/pages/9', { cardId: c.id });
    await maya.put('/me/file/pages/9', { cardId: null });
    expect((await maya.get('/me/file/tray')).body.items).toHaveLength(1); // off the page = back in the tray
    await maya.put('/me/file/pages/7', { cardId: c.id });
    expect((await theo.get('/notifications')).body.items.filter((x: any) => x.kind === 'file_card_placed')).toHaveLength(1);
    expect((await theo.get('/me/file/made')).body.items[0]).toMatchObject({ state: 'placed', for: { handle: 'maya' } });
  });

  test('declining is silent: the maker only sees "not in their File"', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const c = await gift(theo, 'maya', 'Hmm');
    await theo.post(`/me/file/cards/${c.id}/send`);
    expect((await theo.post(`/me/file/tray/${c.id}/decline`)).status).toBe(404);
    const before = (await theo.get('/notifications')).body.items.length;
    expect((await maya.post(`/me/file/tray/${c.id}/decline`)).status).toBe(200);
    expect((await maya.get('/me/file/tray')).body.items).toEqual([]);
    expect((await maya.put('/me/file/pages/8', { cardId: c.id })).status).toBe(404);
    expect((await theo.get('/notifications')).body.items.length).toBe(before);
    expect((await theo.get('/me/file/made')).body.items[0].state).toBe('sent');
    // a placed card can be turned down later too: it leaves the File
    const d = await gift(theo, 'maya', 'Second');
    await theo.post(`/me/file/cards/${d.id}/send`);
    await maya.put('/me/file/pages/8', { cardId: d.id });
    expect((await maya.post(`/me/file/tray/${d.id}/decline`)).status).toBe(200);
    expect((await maya.get('/members/maya/file')).body.pages[8].card).toBeNull();
  });

  test('an edit after the yes takes the card off the File and back to the tray; a new yes rings again', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const c = await gift(theo, 'maya', 'Kind words');
    await theo.post(`/me/file/cards/${c.id}/send`);
    await maya.put('/me/file/pages/8', { cardId: c.id });
    const r = await theo.patch(`/me/file/cards/${c.id}`, { headline: 'Different words' });
    expect(r.body).toMatchObject({ headline: 'Different words', state: 'sent', page: null });
    expect((await maya.get('/members/maya/file')).body.pages[8].card).toBeNull();
    expect((await maya.get('/me/file/tray')).body.items[0].headline).toBe('Different words');
    await new Promise((res) => setTimeout(res, 20));
    await maya.put('/me/file/pages/8', { cardId: c.id });
    expect((await theo.get('/notifications')).body.items.filter((x: any) => x.kind === 'file_card_placed')).toHaveLength(2);
    // the maker deletes it: gone from her File
    expect((await maya.del(`/me/file/cards/${c.id}`)).status).toBe(404);
    expect((await theo.del(`/me/file/cards/${c.id}`)).status).toBe(200);
    expect((await maya.get('/members/maya/file')).body.pages[8].card).toBeNull();
  });

  test('one card per maker in a File; at most three of yours wait with one person', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const ids: string[] = [];
    for (let i = 0; i < FILE.trayPerMaker + 1; i++) ids.push((await gift(theo, 'maya', `card ${i}`)).id);
    for (let i = 0; i < FILE.trayPerMaker; i++) expect((await theo.post(`/me/file/cards/${ids[i]}/send`)).status).toBe(200);
    expect((await theo.post(`/me/file/cards/${ids[3]}/send`)).status).toBe(409);
    expect((await maya.put('/me/file/pages/7', { cardId: ids[0] })).status).toBe(200);
    expect((await maya.put('/me/file/pages/8', { cardId: ids[1] })).status).toBe(409);
    // swapping on the same page is fine; and a placed card no longer counts as waiting
    expect((await maya.put('/me/file/pages/7', { cardId: ids[1] })).status).toBe(200);
    await maya.post(`/me/file/tray/${ids[0]}/decline`);
    expect((await theo.post(`/me/file/cards/${ids[3]}/send`)).status).toBe(200);
  });

  test('when the maker leaves, their card leaves her File', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const c = await gift(theo, 'maya', 'From Theo');
    await theo.post(`/me/file/cards/${c.id}/send`);
    await maya.put('/me/file/pages/8', { cardId: c.id });
    expect((await theo.del('/me')).status).toBe(200);
    expect((await maya.get('/members/maya/file')).body.pages[8]).toMatchObject({ card: null, label: '' });
  });
});