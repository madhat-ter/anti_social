import { afterEach, describe, expect, test } from 'bun:test';
import { setOps } from '../src/lib/moderation';
import { cleanup, setup } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 10 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  return { ...w, member };
}

describe('interests', () => {
  test('the starting list, picking up to ten, and showing them on the member', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const list = (await ana.get('/interests')).body.items;
    expect(list).toHaveLength(30);
    expect(list[0]).toEqual({ slug: 'animation', label: 'Animation' });

    expect((await ana.put('/me/interests', { interests: ['music', 'film', 'film', 'hiking'] })).body).toEqual({ interests: ['film', 'hiking', 'music'] });
    expect((await ana.get('/me')).body.interests).toEqual(['film', 'hiking', 'music']);
    expect((await ben.get('/members/ana')).body.interests).toEqual(['film', 'hiking', 'music']);
    expect((await ben.get('/members')).body.items.find((m: any) => m.handle === 'ben').interests).toEqual([]);

    expect((await ana.put('/me/interests', { interests: ['knitting-on-mars'] })).body.error).toBe('interests_invalid');
    const eleven = list.slice(0, 11).map((i: any) => i.slug);
    expect((await ana.put('/me/interests', { interests: eleven })).body.error).toBe('interests_invalid');
    expect((await ana.put('/me/interests', { interests: [] })).body.interests).toEqual([]);
  });

  test('admins add interests; members cannot', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana');
    expect((await ana.post('/ops/interests', { label: 'Pottery' })).status).toBe(404);
    expect((await boss.post('/ops/interests', { label: '  Street   food ' })).body).toEqual({ slug: 'street-food', label: 'Street food' });
    expect((await boss.post('/ops/interests', { label: 'street food' })).body.error).toBe('interest_exists');
    expect((await boss.post('/ops/interests', { label: 'x' })).body.error).toBe('interest_invalid');
    expect((await ana.put('/me/interests', { interests: ['street-food'] })).body.interests).toEqual(['street-food']);
  });
});
