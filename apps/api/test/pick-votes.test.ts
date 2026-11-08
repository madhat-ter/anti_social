import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
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

describe('picks: tried it', () => {
  test('vote good or not for me, with an optional remark; change, clear, take back', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cy = await w.member('cyd');
    const p = (await ana.post('/suggestions', { kind: 'movie', title: 'Perfect Days' })).body;
    expect(p).toMatchObject({ up: 0, down: 0, remarkCount: 0, myVote: null, latestRemark: null });

    expect((await ana.put(`/suggestions/${p.id}/vote`, { vote: 1 })).body.error).toBe('own_pick');
    let r = (await ben.put(`/suggestions/${p.id}/vote`, { vote: 1, remark: '  Quiet and   perfect. ' })).body;
    expect(r).toMatchObject({ up: 1, down: 0, myVote: 1, myRemark: 'Quiet and perfect.', remarkCount: 1 });
    expect(r.latestRemark).toMatchObject({ handle: 'ben', vote: 1, remark: 'Quiet and perfect.' });
    r = (await cy.put(`/suggestions/${p.id}/vote`, { vote: -1 })).body;
    expect(r).toMatchObject({ up: 1, down: 1, myVote: -1, myRemark: null, remarkCount: 1 });

    // changing the vote keeps the remark unless it is given; "" clears it
    r = (await ben.put(`/suggestions/${p.id}/vote`, { vote: -1 })).body;
    expect(r).toMatchObject({ up: 0, down: 2, myRemark: 'Quiet and perfect.' });
    expect((await ben.put(`/suggestions/${p.id}/vote`, { vote: -1, remark: 'x'.repeat(201) })).body.error).toBe('remark_invalid');
    r = (await ben.put(`/suggestions/${p.id}/vote`, { vote: 1, remark: '' })).body;
    expect(r).toMatchObject({ up: 1, myRemark: null, remarkCount: 0, latestRemark: null });
    r = (await cy.del(`/suggestions/${p.id}/vote`)).body;
    expect(r).toMatchObject({ up: 1, down: 0, myVote: null });

    // what ana (the suggester) sees, and the profile list
    expect((await ana.get(`/members/ana/suggestions`)).body.items[0]).toMatchObject({ up: 1, down: 0, mine: true });
    expect((await w.t.db.execute(sql`select count(*)::int as n from contributions`) as any).rows[0].n).toBe(0);
  });

  test('the suggester hears about remarks, not bare votes; everyone can read the list', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const cy = await w.member('cyd');
    const p = (await ana.post('/suggestions', { kind: 'food', title: 'Khao soi at Mae' })).body;
    await cy.put(`/suggestions/${p.id}/vote`, { vote: 1 });
    await ben.put(`/suggestions/${p.id}/vote`, { vote: -1, remark: 'Too spicy for me.' });
    await ben.put(`/suggestions/${p.id}/vote`, { vote: -1, remark: 'Too spicy for me.' }); // same text: no second note
    const notes = (await ana.get('/notifications')).body.items.filter((n: any) => n.kind === 'pick_remark');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pickTitle: 'Khao soi at Mae', actor: { handle: 'ben' } });

    const list = (await cy.get(`/suggestions/${p.id}/remarks`)).body;
    expect(list.canModerate).toBe(false);
    expect(list.items.map((x: any) => [x.handle, x.vote, x.remark])).toEqual([['ben', -1, 'Too spicy for me.'], ['cyd', 1, null]]);
  });

  test('admins remove a remark (the vote stays, the writer is told); members cannot', async () => {
    const w = await world();
    const boss = await w.member('boss');
    await setOps(w.t.db, 'boss', true);
    const ana = await w.member('ana');
    const ben = await w.member('ben');
    const p = (await ana.post('/suggestions', { kind: 'book', title: 'Piranesi' })).body;
    await ben.put(`/suggestions/${p.id}/vote`, { vote: 1, remark: 'something rude' });
    expect((await ana.del(`/ops/suggestions/${p.id}/remarks/ben`)).status).toBe(404);
    expect((await boss.get(`/suggestions/${p.id}/remarks`)).body.canModerate).toBe(true);
    expect((await boss.del(`/ops/suggestions/${p.id}/remarks/ben`)).body).toEqual({ removed: true });
    expect((await ben.get(`/members/ana/suggestions`)).body.items[0]).toMatchObject({ up: 1, myVote: 1, myRemark: null, remarkCount: 0 });
    const n = (await ben.get('/notifications')).body.items.find((x: any) => x.kind === 'remark_removed');
    expect(n.pickTitle).toBe('Piranesi');
  });

  test('rotation skips what you saw last, and favours well-rated picks without burying the rest', async () => {
    const w = await world();
    const ana = await w.member('ana');
    const voters = await Promise.all(['voter1', 'voter2', 'voter3', 'voter4', 'voter5', 'voter6'].map((h) => w.member(h)));
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) ids.push((await ana.post('/suggestions', { kind: 'book', title })).body.id);
    // the last five seen are skipped
    for (let i = 0; i < 10; i++) {
      const r = (await ana.get(`/suggestions/random?exclude=${ids.slice(0, 5).join(',')}`)).body.item;
      expect(['F', 'G']).toContain(r.title);
    }
    // only the one on screen is skipped when everything else was seen
    const seenAll = (await ana.get(`/suggestions/random?exclude=${ids.join(',')}`)).body.item;
    expect(seenAll.id).not.toBe(ids[0]);

    // G loved by six, F hated by six: G comes up far more often, F still sometimes
    for (const v of voters) {
      await v.put(`/suggestions/${ids[6]}/vote`, { vote: 1 });
      await v.put(`/suggestions/${ids[5]}/vote`, { vote: -1 });
    }
    const count = { F: 0, G: 0 };
    for (let i = 0; i < 120; i++) {
      const t = (await ana.get(`/suggestions/random?exclude=${ids.slice(0, 5).join(',')}`)).body.item.title as 'F' | 'G';
      count[t]++;
    }
    expect(count.G).toBeGreaterThan(count.F * 3);
    expect(count.F).toBeGreaterThan(0);
  });
});
