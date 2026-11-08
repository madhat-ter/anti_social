import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { cleanup, setup, TEST_ABOUT } from './client';
import { JOBS, runJob } from '../src/lib/jobs';

afterEach(cleanup);

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

async function world() {
  const w = await setup({ seatCap: 10 });
  const rowsOf = async (q: ReturnType<typeof sql>) => ((await w.t.db.execute(q)) as any).rows as any[];
  /** a member who joined but has not set up yet */
  const fresh = async (handle: string) => {
    const c = w.client();
    expect((await c.register(await w.mint(), handle, handle, { setup: false })).status).toBe(200);
    return c;
  };
  return { ...w, rowsOf, fresh };
}

const good = { about: words(80), gender: 'woman', birthday: '2001-03-17', phone: '+977 980-111 2222', email: 'Nova@Example.com' };

describe('setup', () => {
  test('until setup is done the site is locked, except your account', async () => {
    const w = await world();
    const c = await w.fresh('nova');
    expect((await c.get('/me')).body).toMatchObject({ setupNeeded: true, gender: null, birthday: null, birthdayPublic: true });
    for (const path of ['/feed', '/members', '/search?q=a', '/seats', '/events?scope=upcoming']) {
      const r = await c.get(path);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('setup_required');
    }
    expect((await c.post('/posts', { body: 'hi' })).body.error).toBe('setup_required');
    expect((await c.get('/me/passkeys')).status).toBe(200);
    expect((await c.get('/notifications')).status).toBe(200);
    expect((await c.get('/me/setup')).body).toEqual({ about: '', gender: null, birthday: null, done: false, phone: '', email: '' });
  });

  test('About you, gender and birthday: the rules', async () => {
    const w = await world();
    const c = await w.fresh('nova');
    const err = async (b: object) => (await c.put('/me/setup', { ...good, ...b })).body.error;
    expect(await err({ about: words(49) })).toBe('about_invalid');
    expect(await err({ about: words(301) })).toBe('about_invalid');
    expect(await err({ about: words(60).replace(/ /g, '').padEnd(10, 'x') })).toBe('about_invalid'); // one long "word"
    expect(await err({ about: `${words(60)} ${'x'.repeat(2400)}` })).toBe('about_invalid'); // too many characters
    expect(await err({ birthday: '17/03/2001' })).toBe('birthday_invalid');
    expect(await err({ birthday: '2001-02-30' })).toBe('birthday_invalid');
    expect(await err({ birthday: '2999-01-01' })).toBe('birthday_invalid');
    expect(await err({ birthday: '1880-01-01' })).toBe('birthday_invalid');
    expect((await c.put('/me/setup', { ...good, gender: 'robot' })).status).toBeGreaterThanOrEqual(400);
    expect((await c.get('/me')).body.setupNeeded).toBe(true);
  });

  test('done: About lands in the portfolio, the site opens, and it is not a contribution', async () => {
    const w = await world();
    const c = await w.fresh('nova');
    const me = (await c.put('/me/setup', { ...good, about: `  ${words(80)}\n\n\n\nmore  ` })).body;
    expect(me).toMatchObject({ setupNeeded: false, gender: 'woman', birthday: '2001-03-17' });
    expect((await c.get('/feed')).status).toBe(200);
    const pf = (await c.get('/members/nova/portfolio')).body;
    expect(pf.about).toBe(`${words(80)}\n\nmore`);
    expect(pf.empty).toBe(false);
    expect((await w.rowsOf(sql`select count(*)::int as n from contributions`))[0].n).toBe(0);
    // setting up again later (e.g. a second device) keeps the first completion time
    const first = (await w.rowsOf(sql`select setup_done_at from users where handle = 'nova'`))[0].setup_done_at;
    await c.put('/me/setup', good);
    expect((await w.rowsOf(sql`select setup_done_at from users where handle = 'nova'`))[0].setup_done_at).toEqual(first);
  });

  test('an About written earlier is offered again', async () => {
    const w = await world();
    const c = await w.fresh('nova');
    await w.t.db.execute(sql`insert into portfolios (user_id, about) select id, 'I already wrote this.' from users where handle = 'nova'`);
    expect((await c.get('/me/setup')).body.about).toBe('I already wrote this.');
  });

  test('under 13: asked first, then the account is closed and nothing is kept', async () => {
    const w = await world();
    const c = await w.fresh('kiddo');
    const now = new Date();
    const elevenYearsAgo = `${now.getUTCFullYear() - 11}-01-01`;
    const ask = await c.put('/me/setup', { ...good, birthday: elevenYearsAgo });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toBe('underage');
    expect((await w.rowsOf(sql`select birthday, state from users where handle = 'kiddo'`))[0]).toEqual({ birthday: null, state: 'active' });

    const seatsBefore = (await w.rowsOf(sql`select seats_used() as n`))[0].n;
    expect((await c.put('/me/setup', { ...good, birthday: elevenYearsAgo, confirmUnderage: true })).body).toEqual({ closed: true });
    expect((await c.get('/me')).status).toBe(401);
    expect((await w.rowsOf(sql`select seats_used() as n`))[0].n).toBe(seatsBefore - 1);
    const [u] = await w.rowsOf(sql`select state, handle, birthday, gender from users where display_name = 'deleted user'`);
    expect(u).toMatchObject({ state: 'deleted', birthday: null, gender: null });
    expect(u.handle).toStartWith('deleted_');
    expect((await w.rowsOf(sql`select reason from user_state_events where to_state = 'deleted'`))[0].reason).toBe('underage');
    expect((await c.login()).status).toBe(401);
  });

  test('About stays 50–300 words in the portfolio editor; gender changes, the birthday does not', async () => {
    const w = await world();
    const c = await w.fresh('nova');
    await c.put('/me/setup', good);
    expect((await c.patch('/me/portfolio', { about: 'too short' })).body.error).toBe('portfolio_invalid');
    expect((await c.patch('/me/portfolio', { about: '' })).body.error).toBe('portfolio_invalid');
    expect((await c.patch('/me/portfolio', { about: words(120) })).status).toBe(200);
    expect((await c.patch('/me/portfolio', { headline: 'Designer' })).body.about).toBe(words(120));
    const me = (await c.patch('/me', { gender: 'nonbinary', birthday: '1990-01-01', birthdayPublic: false })).body;
    expect(me).toMatchObject({ gender: 'nonbinary', birthday: '2001-03-17', birthdayPublic: false });
  });

  test('deleting your account removes your portfolio and projects with their images', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'nova');
    const png = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 30, g: 30, b: 200 } } }).png().toBuffer());
    const up = (await c.upload('/uploads', png)).body;
    await c.post('/me/projects', { title: 'Lamp', draft: false, images: [{ id: up.id }] });
    expect(w.storage.files.size).toBe(1);
    expect((await c.del('/me')).status).toBe(200);
    expect(w.storage.files.size).toBe(0);
    expect((await w.rowsOf(sql`select count(*)::int as n from projects`))[0].n).toBe(0);
    expect((await w.rowsOf(sql`select count(*)::int as n from portfolios`))[0].n).toBe(0);
  });

  test('the gender goes wherever a face is drawn: posts, people, notifications, picks, events', async () => {
    const w = await world();
    const ana = w.client();
    await ana.register(await w.mint(), 'ana');
    await ana.patch('/me', { gender: 'woman' });
    const ben = w.client();
    await ben.register(await w.mint(), 'ben');
    await ben.patch('/me', { gender: 'man' });

    const post = (await ana.post('/posts', { body: 'Hello' })).body;
    expect(post.author).toMatchObject({ handle: 'ana', gender: 'woman' });
    expect((await ben.get('/feed')).body.items[0].author.gender).toBe('woman');
    await ben.post(`/posts/${post.id}/like`);
    expect((await ana.get('/notifications')).body.items.find((x: any) => x.kind === 'like').actor.gender).toBe('man');
    expect((await ben.get('/members/ana')).body.gender).toBe('woman');
    expect((await ben.get('/members')).body.items.find((m: any) => m.handle === 'ana').gender).toBe('woman');
    expect((await ben.get('/search?q=ana')).body.members[0].gender).toBe('woman');

    await ana.post('/suggestions', { kind: 'book', title: 'Dune' });
    expect((await ben.get('/members/ana/suggestions')).body.items[0].author.gender).toBe('woman');

    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ev = (await ana.post('/events', { title: 'Hike', startsAt, location: 'North gate' })).body;
    await ben.post(`/events/${ev.id}/rsvp`);
    const detail = (await ana.get(`/events/${ev.id}`)).body;
    expect(detail.host.gender).toBe('woman');
    expect(detail.going.find((p: any) => p.handle === 'ben').gender).toBe('man');
  });

  test('the checklist ticks itself from what you have done; closing it is remembered', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'nova');
    const none = { headline: false, skills: false, project: false, post: false, pick: false, interests: false };
    expect((await c.get('/me/checklist')).body).toEqual({ items: none, dismissed: false });
    await c.patch('/me/portfolio', { headline: 'Designer', skills: ['Ink'] });
    await c.post('/me/projects', { title: 'Draft', draft: true });
    await c.post('/posts', { body: 'Hello' });
    await c.post('/suggestions', { kind: 'book', title: 'Dune' });
    // a draft is not a published project yet
    expect((await c.get('/me/checklist')).body.items).toEqual({ headline: true, skills: true, project: false, post: true, pick: true, interests: false });
    await c.post('/me/projects', { title: 'Lamp', draft: false });
    expect((await c.get('/me/checklist')).body.items.project).toBe(true);
    expect((await c.post('/me/checklist/dismiss')).body).toEqual({ dismissed: true });
    expect((await c.get('/me/checklist')).body.dismissed).toBe(true);
    // before setup it is locked like everything else
    const late = await w.fresh('late');
    expect((await late.get('/me/checklist')).body.error).toBe('setup_required');
  });

  test('a daily reminder until the checklist is done; it brings a hidden window back', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'nova');
    const tick = async () => ((await runJob(w.t.db, JOBS.find((j) => j.name === 'checklist')!, { storage: w.storage, payments: w.payments })) as any).result;
    const reminders = async () => (await c.get('/notifications')).body.items.filter((n: any) => n.kind === 'checklist_reminder');

    expect((await tick()).sent).toBe(0); // not on the first day: the window is there
    expect(await reminders()).toHaveLength(0);
    await c.post('/me/checklist/dismiss');
    await w.t.db.execute(sql`update users set setup_done_at = now() - interval '2 days'`);
    await c.post('/posts', { body: 'Hello' });
    expect((await tick()).sent).toBe(1);
    let r = await reminders();
    expect(r).toHaveLength(1);
    expect(r[0].checklist).toEqual({ done: 1, total: 6 });
    expect((await c.get('/me/checklist')).body.dismissed).toBe(false); // back with the reminder
    expect((await tick()).sent).toBe(0); // once a day
    // a day later the new one replaces the unread old one
    await w.t.db.execute(sql`update notifications set created_at = now() - interval '25 hours' where kind = 'checklist_reminder'`);
    expect((await tick()).sent).toBe(1);
    r = await reminders();
    expect(r).toHaveLength(1);
    // finishing removes it, and no more come
    await c.patch('/me/portfolio', { headline: 'Designer', skills: ['Ink'] });
    await c.post('/me/projects', { title: 'Lamp', draft: false });
    await c.post('/suggestions', { kind: 'book', title: 'Dune' });
    await c.put('/me/interests', { interests: ['books'] });
    expect(await tick()).toEqual({ sent: 0, cleared: 1 });
    expect(await reminders()).toHaveLength(0);
  });

  test('test members are set up by the helper', async () => {
    const w = await world();
    const c = w.client();
    await c.register(await w.mint(), 'helper');
    expect((await c.get('/me')).body).toMatchObject({ setupNeeded: false, gender: 'undisclosed' });
    expect((await c.get('/members/helper/portfolio')).body.about).toBe(TEST_ABOUT);
  });
});
