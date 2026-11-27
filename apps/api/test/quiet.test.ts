import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { rows } from '@anti/db';
import { JOBS, runJob } from '../src/lib/jobs';
import { describePush } from '../src/lib/push';
import { cleanup, setup, type Client } from './client';

afterEach(cleanup);

/** RFC §10.33: when someone goes quiet, the people they talk with hear about it. */

const ACTIVITY = {
  kind: 'activity' as const, title: 'Sunday run club', meets: 'Sundays 7am, by the lake',
  description: 'Easy pace, five kilometres.', interests: ['music'], teamMax: null,
};

async function world() {
  const w = await setup({ seatCap: 40 });
  const member = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle)).status).toBe(200);
    return c;
  };
  const q = <T>(s: ReturnType<typeof sql>) => rows<T & Record<string, unknown>>(w.t.db, s);
  /** last here `days` ago, after coming on `regular` days in the 30 before that, seated for 90 days */
  const away = async (handle: string, days: number, regular = 10) => {
    await q(sql`update users set activated_at = now() - interval '90 days', last_seen_at = now() - make_interval(days => ${days}),
                                 last_seen_on = (now() - make_interval(days => ${days}))::date
                 where handle = ${handle}`);
    await q(sql`delete from user_seen_days where user_id = (select id from users where handle = ${handle})`);
    await q(sql`insert into user_seen_days (user_id, day)
                select id, (now() - make_interval(days => ${days}))::date - g from users, generate_series(0, ${regular - 1}) g
                 where handle = ${handle}`);
  };
  const run = () => runJob(w.t.db, JOBS.find((j) => j.name === 'quiet')!, { storage: w.storage, payments: w.payments });
  const notes = async (c: Client, kind: string) => (await c.get('/notifications')).body.items.filter((n: any) => n.kind === kind);
  return { ...w, member, q, away, run, notes };
}

const post = async (c: Client, body: string, parentId?: string) => {
  const r = await c.post('/posts', parentId ? { body, parentId } : { body });
  expect(r.status).toBe(200);
  return r.body;
};

describe('someone goes quiet (RFC §10.33)', () => {
  test('a week away: the three they talk with most hear about it, once; likes and the quiet one hear nothing', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const ana = await w.member('ana');   // same Collab (3) + a reply (1) = 4
    const ben = await w.member('ben');   // two replies and a mention = 3
    const cleo = await w.member('cleo'); // two replies = 2
    const dan = await w.member('dan');   // one reply = 1: fourth, not told
    const eve = await w.member('eve');   // only likes: not a tie
    const hers = await post(maya, 'Printing all weekend');
    const run = (await maya.post('/collabs', ACTIVITY)).body;
    expect((await ana.post(`/collabs/${run.id}/join`, {})).status).toBe(200);
    await post(ana, 'See you Sunday', hers.id);
    await post(ben, 'Nice', hers.id);
    const bens = await post(ben, 'Ask @maya about paper');
    await post(maya, 'Thick and cheap', bens.id);
    await post(cleo, 'Show us', hers.id);
    const cleos = await post(cleo, 'My first zine');
    await post(maya, 'Love it', cleos.id);
    await post(dan, 'Cool', hers.id);
    expect((await eve.post(`/posts/${hers.id}/like`)).status).toBe(200);

    await w.away('maya', 6);
    expect((await w.run()).result).toMatchObject({ noticed: 0 });
    await w.away('maya', 8);
    expect((await w.run()).result).toMatchObject({ noticed: 1, told: 3, toAdmins: 0 });
    for (const c of [ana, ben, cleo]) {
      const [n] = await w.notes(c, 'gone_quiet');
      expect(n).toMatchObject({ actor: { handle: 'maya' }, quietDays: 8 });
    }
    expect(await w.notes(dan, 'gone_quiet')).toEqual([]);
    expect(await w.notes(eve, 'gone_quiet')).toEqual([]);
    expect(await w.notes(maya, 'gone_quiet')).toEqual([]);
    // the same spell is noticed once
    expect((await w.run()).result).toMatchObject({ noticed: 0, told: 0 });
    // what a lock screen says, and where it leads
    expect(describePush({ kind: 'gone_quiet', payload: { actorId: 'x', days: 8 }, actor: 'maya', post_snippet: null, root_id: null, event_title: null }))
      .toMatchObject({ title: '@maya hasn\'t been around for a week', body: 'A hello might be nice.', url: '/?say=maya#compose' });
    expect(describePush({ kind: 'gone_quiet', payload: { days: 22 }, actor: 'maya', post_snippet: null, root_id: null, event_title: null })!.title)
      .toBe('@maya hasn\'t been around for 3 weeks');
  });

  test('only regulars: someone who drops in now and then sets nothing off', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const ana = await w.member('ana');
    await post(ana, 'Hi', (await post(maya, 'Hello')).id);
    await w.away('maya', 8, 5); // 5 days of the 30: not a regular
    expect((await w.run()).result).toMatchObject({ told: 0 });
    expect(await w.notes(ana, 'gone_quiet')).toEqual([]);
  });

  test('someone who talks with nobody: the admins hear instead', async () => {
    const w = await world();
    await w.member('maya');
    const boss = await w.member('boss');
    const ana = await w.member('ana');
    await w.q(sql`update users set role = 'ops' where handle = 'boss'`);
    await w.away('maya', 9);
    expect((await w.run()).result).toMatchObject({ told: 1, toAdmins: 1 });
    expect((await w.notes(boss, 'gone_quiet'))[0]).toMatchObject({ actor: { handle: 'maya' } });
    expect(await w.notes(ana, 'gone_quiet')).toEqual([]);
  });

  test('coming back takes the unread hellos away; going quiet again within a month tells nobody twice', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const ana = await w.member('ana');
    await post(ana, 'Hi', (await post(maya, 'Hello')).id);
    await w.away('maya', 8);
    await w.run();
    expect(await w.notes(ana, 'gone_quiet')).toHaveLength(1);
    expect((await maya.get('/me')).status).toBe(200); // she is back
    expect((await w.run()).result).toMatchObject({ back: 1 });
    expect(await w.notes(ana, 'gone_quiet')).toEqual([]);
    await w.away('maya', 10); // a new spell, but Ana heard about her less than a month ago
    expect((await w.run()).result).toMatchObject({ noticed: 1, told: 0 });
    expect(await w.notes(ana, 'gone_quiet')).toEqual([]);
  });

  test('day 23: the member hears their seat is kept until the 30-day rule would take it; once; not admins', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const boss = await w.member('boss');
    await w.q(sql`update users set role = 'ops' where handle = 'boss'`);
    await w.away('maya', 22);
    await w.away('boss', 25);
    expect((await w.run()).result).toMatchObject({ seatNotes: 0 });
    await w.away('maya', 23);
    expect((await w.run()).result).toMatchObject({ seatNotes: 1 });
    expect((await w.run()).result).toMatchObject({ seatNotes: 0 });
    const [last] = await w.q<{ until: string }>(sql`
      select to_char((last_seen_at + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD') as until from users where handle = 'maya'`);
    const [n] = await w.notes(maya, 'seat_kept');
    expect(n.keptUntil.slice(0, 10)).toBe(last!.until);
    expect(await w.notes(boss, 'seat_kept')).toEqual([]);
    const push = describePush({ kind: 'seat_kept', payload: { until: n.keptUntil }, actor: null, post_snippet: null, root_id: null, event_title: null });
    expect(push).toMatchObject({ title: 'Your seat is kept for you', url: '/' });
    expect(push!.body).toMatch(/^Until \d{1,2} [A-Z][a-z]+\. Come back any time\.$/);
    // back: the note goes
    await w.run();
    expect(await w.notes(maya, 'seat_kept')).toEqual([]);
  });
});
