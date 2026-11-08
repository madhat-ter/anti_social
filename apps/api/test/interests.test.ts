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

describe('members add their own interests', () => {
  test('anyone adds a missing one; it joins the shared list; duplicates come back as the existing one', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const r = await ana.post('/interests', { label: '  bonsai   trees ' });
    expect(r.body).toEqual({ slug: 'bonsai-trees', label: 'Bonsai trees', added: true });
    expect((await ben.get('/interests')).body.items.map((i: any) => i.slug)).toContain('bonsai-trees');
    expect((await ben.post('/interests', { label: 'BONSAI TREES' })).body).toEqual({ slug: 'bonsai-trees', label: 'Bonsai trees', added: false });
    expect((await ben.post('/interests', { label: 'music' })).body).toEqual({ slug: 'music', label: 'Music', added: false });
    expect((await ben.post('/interests', { label: 'Café culture' })).body.slug).toBe('cafe-culture');
    const nepali = (await ben.post('/interests', { label: 'मादल' })).body;
    expect(nepali.slug).toMatch(/^x-[0-9a-f]{10}$/);
    expect((await ana.post('/interests', { label: 'मादल' })).body).toMatchObject({ slug: nepali.slug, added: false });
    expect((await ben.put('/me/interests', { interests: ['bonsai-trees', nepali.slug] })).body.interests).toHaveLength(2);

    for (const bad of ['x', 'a'.repeat(31), 'visit www.spam.com', '<script>', '!!!']) {
      expect((await ana.post('/interests', { label: bad })).body.error).toBe('interest_invalid');
    }
  });

  test('five new ones a day; admins see who added what and remove them everywhere', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    for (const l of ['Kites', 'Origami', 'Chess', 'Birding', 'Pottery']) expect((await ana.post('/interests', { label: l })).body.added).toBe(true);
    expect((await ana.post('/interests', { label: 'Juggling' })).status).toBe(429);
    expect((await ana.post('/interests', { label: 'kites' })).body.added).toBe(false);

    await ana.put('/me/interests', { interests: ['kites', 'music'] });
    expect((await ana.get('/ops/interests')).status).toBe(404);
    const list = (await boss.get('/ops/interests')).body.items;
    expect(list.slice(0, 5).map((i: any) => i.addedBy)).toEqual(['ana', 'ana', 'ana', 'ana', 'ana']);
    expect(list.find((i: any) => i.slug === 'kites').uses).toEqual({ members: 1, collabs: 0, events: 0 });
    expect(list.find((i: any) => i.slug === 'music').addedBy).toBeNull();

    expect((await ana.del('/ops/interests/kites')).status).toBe(404);
    expect((await boss.del('/ops/interests/kites')).body).toEqual({ removed: true });
    expect((await ana.get('/me')).body.interests).toEqual(['music']);
    expect((await boss.del('/ops/interests/kites')).status).toBe(404);
  });
});