import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { scalar } from '@anti/db';
import { PF_ABOUT_MAX, PF_EXPERIENCE_MAX, PF_HEADLINE_MAX, PF_LINKS_MAX, PF_TAGS_MAX } from '@anti/shared';
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

const EMPTY = {
  headline: '', location: '', openToWork: false, about: '',
  skills: [], tools: [], experience: [], education: [], links: [], empty: true, updatedAt: null,
};

describe('portfolio', () => {
  test('a new member has an empty portfolio; anyone seated can read it', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    expect((await maya.get('/members/maya/portfolio')).body).toEqual({ handle: 'maya', mine: true, ...EMPTY });
    expect((await theo.get('/members/MAYA/portfolio')).body).toMatchObject({ handle: 'maya', mine: false, empty: true });
    expect((await theo.get('/members/nobody/portfolio')).status).toBe(404);
  });

  test('fill it in: trimmed, tags deduped, entries sorted newest first, links kept https', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const r = await maya.patch('/me/portfolio', {
      headline: '  Industrial  designer ', location: 'Kathmandu', openToWork: true,
      about: 'Line one.\r\n\r\n\r\n\r\nLine two.  ',
      skills: ['Sketching', ' sketching', 'Rendering', '', 'CAD'],
      tools: ['Fusion 360'],
      experience: [
        { title: 'Intern', place: 'Jaquar', from: 2025, to: 2025, line: 'Lighting.' },
        { title: 'Freelance', place: '', from: '2023', to: null, line: '' },
        { title: '', place: '', from: '', to: '', line: '' },
      ],
      education: [{ title: 'B.Des', place: 'MITID', from: 2023, to: 2027 }],
      links: [{ label: 'Behance', url: 'https://www.behance.net/maya' }, { label: '', url: 'https://maya.example/' }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      handle: 'maya', mine: true, empty: false,
      headline: 'Industrial designer', location: 'Kathmandu', openToWork: true,
      about: 'Line one.\n\nLine two.',
      skills: ['Sketching', 'Rendering', 'CAD'], tools: ['Fusion 360'],
      experience: [
        { title: 'Freelance', place: '', from: 2023, to: null, line: '' },
        { title: 'Intern', place: 'Jaquar', from: 2025, to: 2025, line: 'Lighting.' },
      ],
      education: [{ title: 'B.Des', place: 'MITID', from: 2023, to: 2027, line: '' }],
      links: [{ label: 'Behance', url: 'https://www.behance.net/maya' }, { label: 'maya.example', url: 'https://maya.example/' }],
    });
    expect(typeof r.body.updatedAt).toBe('string');

    // others see the same thing, and it is not theirs
    const theo = await w.member('theo');
    const seen = (await theo.get('/members/maya/portfolio')).body;
    expect(seen).toMatchObject({ headline: 'Industrial designer', mine: false, skills: ['Sketching', 'Rendering', 'CAD'] });
  });

  test('a patch changes only the fields it names', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await maya.patch('/me/portfolio', { headline: 'Illustrator', skills: ['Ink'] });
    const r = await maya.patch('/me/portfolio', { location: 'Wrocław' });
    expect(r.body).toMatchObject({ headline: 'Illustrator', skills: ['Ink'], location: 'Wrocław' });
    // clearing everything makes it empty again
    const cleared = await maya.patch('/me/portfolio', { headline: '', skills: [], location: '' });
    expect(cleared.body.empty).toBe(true);
  });

  test('validation', async () => {
    const w = await world();
    const maya = await w.member('maya');
    const bad = async (body: unknown) => {
      const r = await maya.patch('/me/portfolio', body);
      expect(r.status).toBe(400);
      return r.body.error as string;
    };
    expect(await bad({ headline: 'x'.repeat(PF_HEADLINE_MAX + 1) })).toBe('portfolio_invalid');
    expect(await bad({ about: 'x'.repeat(PF_ABOUT_MAX + 1) })).toBe('portfolio_invalid');
    expect(await bad({ skills: Array.from({ length: PF_TAGS_MAX + 1 }, (_, i) => `s${i}`) })).toBe('portfolio_invalid');
    expect(await bad({ experience: Array.from({ length: PF_EXPERIENCE_MAX + 1 }, () => ({ title: 'x', from: 2020 })) })).toBe('portfolio_invalid');
    expect(await bad({ experience: [{ title: 'x', from: 1800 }] })).toBe('portfolio_invalid');
    expect(await bad({ experience: [{ title: 'x', from: 2024, to: 2020 }] })).toBe('portfolio_invalid');
    expect(await bad({ experience: [{ place: 'No title', from: 2024 }] })).toBe('portfolio_invalid');
    expect(await bad({ links: Array.from({ length: PF_LINKS_MAX + 1 }, (_, i) => ({ label: 'l', url: `https://x${i}.example/` })) })).toBe('portfolio_invalid');
    expect(await bad({ links: [{ label: 'Site', url: 'http://insecure.example/' }] })).toBe('portfolio_invalid');
    expect(await bad({ links: [{ label: 'Mail', url: 'mailto:someone@example.com' }] })).toBe('portfolio_invalid');
    expect(await bad({ links: [{ label: 'Creds', url: 'https://user:pw@example.com/' }] })).toBe('portfolio_invalid');
    expect(await bad({ links: [{ label: 'Nope', url: 'not a url' }] })).toBe('portfolio_invalid');
    expect(await bad({ openToWork: 'yes' })).toBe('bad_request');
    // the portfolio is untouched after all of that
    expect((await maya.get('/members/maya/portfolio')).body.empty).toBe(true);
  });

  test('seated members only; archived portfolios stay readable; banned ones vanish', async () => {
    const w = await world(2);
    const maya = await w.member('maya');
    const theo = await w.member('theo');
    await theo.patch('/me/portfolio', { headline: 'Printmaker' });
    const waiting = w.client();
    await waiting.register(await w.mint(), 'pat');
    expect((await waiting.get('/members/theo/portfolio')).body.error).toBe('no_seat');
    expect((await waiting.patch('/me/portfolio', { headline: 'x' })).body.error).toBe('no_seat');
    expect((await w.client().get('/members/theo/portfolio')).status).toBe(401);

    await w.t.db.execute(sql`update users set state = 'archived' where handle = 'theo'`);
    expect((await maya.get('/members/theo/portfolio')).body.headline).toBe('Printmaker');
    expect((await theo.patch('/me/portfolio', { headline: 'x' })).body.error).toBe('no_seat');

    await w.t.db.execute(sql`update users set state = 'banned' where handle = 'theo'`);
    expect((await maya.get('/members/theo/portfolio')).status).toBe(404);
  });

  test('editing the portfolio is not a contribution for the lurker rule', async () => {
    const w = await world();
    const maya = await w.member('maya');
    await maya.patch('/me/portfolio', { headline: 'Designer', about: 'Hello.' });
    expect(Number(await scalar<number>(w.t.db, sql`select count(*)::int from contributions`))).toBe(0);
  });
});
