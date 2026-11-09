import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

async function world() {
  const w = await setup({ seatCap: 20 });
  const member = async (handle: string, displayName = handle) => {
    const c = w.client();
    const r = await c.register(await w.mint(), handle, displayName);
    expect(r.status).toBe(200);
    return c;
  };
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  return { ...w, member, rowsOf };
}

const createPet = async (c: Client, name = 'Max', species = 'dog', extra: Record<string, unknown> = {}) => {
  const r = await c.post('/pets', { name, species, ...extra });
  expect(r.status).toBe(200);
  return r.body;
};

describe('Pet Corner (RFC §10.17)', () => {
  test('a pet is created with a drawn look and shows on its owner profile', async () => {
    const w = await world();
    const mira = await w.member('mira', 'Mira');
    const pet = await createPet(mira, 'Max', 'dog', { avatarVariant: 7 });
    expect(pet).toMatchObject({
      name: 'Max', species: 'dog', avatar: { variant: 7, url: null }, owner: { handle: 'mira', displayName: 'Mira' },
    });
    const profile = await mira.get('/members/mira');
    expect(profile.body.pets.map((p: any) => p.name)).toEqual(['Max']);
    expect((await mira.get('/pets/mine')).body.items.length).toBe(1);
  });

  test('three pets at most; bad names and species are refused', async () => {
    const w = await world();
    const mira = await w.member('mira');
    for (const name of ['Max', 'Milo', 'Kiki']) await createPet(mira, name);
    const over = await mira.post('/pets', { name: 'Fourth', species: 'cat' });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe('pet_limit');
    expect((await mira.post('/pets', { name: '', species: 'dog' })).status).toBe(400);
    expect((await mira.post('/pets', { name: 'Ham', species: 'hamster' })).status).toBe(400);
    expect((await mira.post('/pets', { name: 'Bit', species: 'dog', avatarVariant: -1 })).status).toBe(400);
  });

  test('a pet post goes to Pet Corner, not the feed, and is not a contribution', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const ben = await w.member('ben');
    const pet = await createPet(mira, 'Max');
    const made = await mira.post('/posts', { body: 'Walked by the river today.', petId: pet.id, petLabel: 'advice' });
    expect(made.status).toBe(200);
    expect(made.body.body).toBe('Walked by the river today.');

    const feed = await ben.get('/feed');
    expect(feed.body.items.map((p: any) => p.id)).not.toContain(made.body.id);
    const corner = await ben.get('/pets');
    const card = corner.body.items.find((p: any) => p.id === made.body.id);
    expect(card).toMatchObject({ label: 'advice', pet: { name: 'Max', owner: { handle: 'mira' } } });

    const contributions = await w.rowsOf(sql`
      select count(*)::int as n from contributions
       where user_id = (select id from users where handle = 'mira') and ref_id = ${made.body.id}::uuid`);
    expect(contributions[0].n).toBe(0);
  });

  test('replies and likes on a pet post tell the owner', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const ben = await w.member('ben');
    const pet = await createPet(mira, 'Max');
    const post = await mira.post('/posts', { body: 'A good nap.', petId: pet.id });
    expect((await ben.post('/posts', { body: 'Good boy', parentId: post.body.id })).status).toBe(200);
    expect((await ben.post(`/posts/${post.body.id}/like`)).status).toBe(200);
    const kinds = await w.rowsOf(sql`
      select kind from notifications where user_id = (select id from users where handle = 'mira')
        and kind in ('like', 'reply') order by kind`);
    expect(kinds.map((k) => k.kind)).toEqual(['like', 'reply']);
  });

  test('pet posts stand alone: no parent, collab or event; only your own pet', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const ben = await w.member('ben');
    const pet = await createPet(mira, 'Max');
    const root = await mira.post('/posts', { body: 'A member post' });
    expect((await mira.post('/posts', { body: 'x', petId: pet.id, parentId: root.body.id })).status).toBe(400);
    expect((await ben.post('/posts', { body: 'Not mine', petId: pet.id })).status).toBe(404);
    expect((await mira.post('/posts', { body: 'Missing', petId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
  });

  test('deleting a pet deletes its posts and replies', async () => {
    const w = await world();
    const mira = await w.member('mira');
    const ben = await w.member('ben');
    const pet = await createPet(mira, 'Max');
    const post = await mira.post('/posts', { body: 'Hello', petId: pet.id });
    await ben.post('/posts', { body: 'Hi Max', parentId: post.body.id });
    const gone = await mira.del(`/pets/${pet.id}`);
    expect(gone.status).toBe(200);
    expect((await mira.get('/pets')).body.items.length).toBe(0);
    expect((await ben.get(`/posts/${post.body.id}`)).status).toBe(404);
    const left = await w.rowsOf(sql`select count(*)::int as n from posts where pet_id is not null`);
    expect(left[0].n).toBe(0);
  });
});
