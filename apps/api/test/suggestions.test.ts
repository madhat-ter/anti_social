import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { SUGGESTIONS_PER_DAY } from '@anti/shared';
import { cleanup, setup } from './client';

afterEach(cleanup);

async function world(seatCap?: number) {
  const w = await setup(seatCap ? { seatCap } : {});
  const member = async (handle: string) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle, handle);
    expect(r.status).toBe(200);
    return c;
  };
  return { ...w, member };
}

describe('picks', () => {
  test('suggest, then see it as a random pick with its author', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');

    expect((await theo.get('/suggestions/random')).body).toEqual({ item: null });

    const r = await maya.post('/suggestions', { kind: 'movie', title: '  Perfect Days  ', note: 'Watch it alone, late.' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'movie', title: 'Perfect Days', note: 'Watch it alone, late.', mine: true, author: { handle: 'maya' } });

    const seen = (await theo.get('/suggestions/random')).body.item;
    expect(seen).toMatchObject({ id: r.body.id, title: 'Perfect Days', mine: false, author: { handle: 'maya', displayName: 'maya' } });
  });

  test('"another" excludes the one on screen; kind filter works', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const a = (await maya.post('/suggestions', { kind: 'book', title: 'Stoner' })).body;
    const b = (await maya.post('/suggestions', { kind: 'food', title: 'Khao soi at Mae' })).body;
    for (let i = 0; i < 5; i++) {
      expect((await maya.get(`/suggestions/random?exclude=${a.id}`)).body.item.id).toBe(b.id);
    }
    expect((await maya.get('/suggestions/random?kind=book')).body.item.id).toBe(a.id);
    expect((await maya.get('/suggestions/random?kind=nonsense')).status).toBe(400);
  });

  test('validation: title required and bounded, note bounded, kind must be known', async () => {
    const w = await world();
    const maya = await w.member('maya');
    expect((await maya.post('/suggestions', { kind: 'place', title: '   ' })).body.error).toBe('title_invalid');
    expect((await maya.post('/suggestions', { kind: 'place', title: 'x'.repeat(81) })).body.error).toBe('title_invalid');
    expect((await maya.post('/suggestions', { kind: 'place', title: 'Lido', note: 'y'.repeat(141) })).body.error).toBe('note_invalid');
    expect((await maya.post('/suggestions', { kind: 'podcast', title: 'Nope' })).status).toBe(400);
    expect((await maya.post('/suggestions', { kind: 'place', title: 'Lido', note: '' })).body.note).toBeNull();
  });

  test(`rate limit: ${SUGGESTIONS_PER_DAY} a day`, async () => {
    const w = await world();
    const maya = await w.member('maya');
    for (let i = 0; i < SUGGESTIONS_PER_DAY; i++) {
      expect((await maya.post('/suggestions', { kind: 'food', title: `Dish ${i}` })).status).toBe(200);
    }
    const over = await maya.post('/suggestions', { kind: 'food', title: 'One too many' });
    expect([over.status, over.body.error]).toEqual([429, 'rate_limited']);
  });

  test('only the author removes a pick; removed picks are never shown', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    const p = (await maya.post('/suggestions', { kind: 'place', title: 'The lido at night' })).body;
    expect((await theo.del(`/suggestions/${p.id}`)).body.error).toBe('not_author');
    expect((await maya.del(`/suggestions/${p.id}`)).body).toEqual({ ok: true });
    expect((await theo.get('/suggestions/random')).body.item).toBeNull();
    expect((await maya.del(`/suggestions/${p.id}`)).status).toBe(404);
  });

  test("a member's picks list; picks of banned members disappear", async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    await theo.post('/suggestions', { kind: 'book', title: 'Piranesi' });
    await theo.post('/suggestions', { kind: 'movie', title: 'Paterson' });
    const list = (await maya.get('/members/THEO/suggestions')).body.items;
    expect(list.map((x: { title: string }) => x.title)).toEqual(['Paterson', 'Piranesi']);

    await w.t.db.execute(sql`update users set state = 'banned' where handle = 'theo'`);
    expect((await maya.get('/suggestions/random')).body.item).toBeNull();
    expect((await maya.get('/members/theo/suggestions')).body.items).toEqual([]);
  });

  test('seated only', async () => {
    const w = await world(1);
    await w.member('maya');
    const waiting = w.client();
    await waiting.register(await w.mint(), 'pat');
    expect((await waiting.get('/suggestions/random')).body.error).toBe('no_seat');
    expect((await waiting.post('/suggestions', { kind: 'food', title: 'x' })).body.error).toBe('no_seat');
    expect((await w.client().get('/suggestions/random')).status).toBe(401);
  });
});
