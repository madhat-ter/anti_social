import { afterEach, describe, expect, test } from 'bun:test';
import { ageOn, utcToday } from '@anti/shared';
import { setOps } from '../src/lib/moderation';
import { cleanup, setup, TEST_SETUP } from './client';

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

describe('birthdays', () => {
  test('month and day only, and only when shown; never the year or an age', async () => {
    const w = await world();
    const ana = await w.member('ana'); // born TEST_SETUP.birthday = 1995-05-17
    const ben = await w.member('ben');
    const post = (await ana.post('/posts', { body: 'hi' })).body;
    expect(post.author.birthday).toEqual({ month: 5, day: 17 });
    expect((await ben.get('/members/ana')).body.birthday).toEqual({ month: 5, day: 17 });
    for (const path of ['/members/ana', '/feed', '/members', '/search?q=ana', `/posts/${post.id}`]) {
      const json = JSON.stringify((await ben.get(path)).body);
      expect(json).not.toContain('1995');
      expect(json).not.toContain('"age"');
    }
    await ana.patch('/me', { birthdayPublic: false });
    expect((await ben.get('/members/ana')).body.birthday).toBeNull();
    expect((await ben.get('/feed')).body.items[0].author.birthday).toBeNull();
    // your own full date is yours to see
    expect((await ana.get('/me')).body).toMatchObject({ birthday: TEST_SETUP.birthday, birthdayPublic: false });
  });

  test('admins see ages and correct birthdays; under 13 closes the account after a confirmation', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const kid = await w.member('kid');
    const list = (await boss.get('/ops/members')).body;
    expect(list.find((m: any) => m.handle === 'kid').age).toBe(ageOn(TEST_SETUP.birthday, utcToday()));

    expect((await boss.post('/ops/users/kid/birthday', { birthday: '2000-01-02' })).body).toMatchObject({ handle: 'kid', closed: false });
    expect((await kid.get('/me')).body.birthday).toBe('2000-01-02');
    expect((await boss.post('/ops/users/kid/birthday', { birthday: '2000-13-01' })).body.error).toBe('birthday_invalid');
    // members cannot change a birthday, theirs or anyone's
    expect((await kid.post('/ops/users/kid/birthday', { birthday: '1990-01-01' })).status).toBe(404);
    expect((await kid.patch('/me', { birthday: '1990-01-01' })).body.birthday).toBe('2000-01-02');

    const young = `${utcToday().y - 10}-01-01`;
    const ask = await boss.post('/ops/users/kid/birthday', { birthday: young });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toBe('underage');
    expect((await kid.get('/me')).status).toBe(200);
    expect((await boss.post('/ops/users/kid/birthday', { birthday: young, confirmUnderage: true })).body).toMatchObject({ closed: true });
    expect((await kid.get('/me')).status).toBe(401);
    expect((await boss.get('/ops/members')).body.some((m: any) => m.handle === 'kid')).toBe(false);

    // the last admin cannot be closed this way
    expect((await boss.post('/ops/users/boss/birthday', { birthday: young, confirmUnderage: true })).body.error).toBe('last_admin');
  });
});
