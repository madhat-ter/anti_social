/**
 * The desktop pass of 2026-11-09, walked through at laptop sizes. In-process API on :3101, web
 * build on :3100 (see the other screenshot scripts).
 *
 *   bun scripts/screenshots-desktop.ts          → .screenshots/desktop/NN-name.png
 *
 * Checks: the checklist is one line and posts are on the first screen; the menu column fits a
 * 1366×768 laptop without scrolling and its drawers sit in their own group; the pick window is in
 * the right column (and in the feed below 1180px); no window repeats its page; a half-empty
 * portfolio box is one column; greyed-out buttons say why on hover; the keyboard shortcuts work.
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';
import { FakeAuthenticator } from '../apps/api/test/fake-authenticator';

const WEB = 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'desktop');
mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

function client() {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) { const [k, ...v] = sc.split(';')[0]!.split('='); if (v.join('=')) jar.set(k!.trim(), v.join('=')); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  return { call, jar };
}
async function member(handle: string, displayName: string, gender: string) {
  const authn = new FakeAuthenticator();
  const c = client();
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  const o = await c.call('POST', '/auth/register/options', { code: formatInviteCode(code), handle, displayName });
  await c.call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string>, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  await member('juno', 'Juno Park', 'man'); // the Members page shows its search box from four members
  await t.client.query(`update users set role = 'ops' where handle = 'maya'`);
  await maya.call('PATCH', '/me/portfolio', { headline: 'Illustrator and zine maker', location: 'Kathmandu', skills: ['Illustration', 'Risograph', 'Layout'] });
  const lines = [
    'Printed the first twenty copies of the market zine tonight. The red came out darker than the proof, and I think I like it more.',
    'Anyone up for a hike on Saturday? Leaving at 7 from the north gate, back by noon.',
    'Found a tiny bookshop behind the station that only opens on Thursdays. Going back with a bigger bag.',
    'The lido is open late this week. Cold water, warm chips, nobody on their phone.',
    'Looking for someone who can bind thirty booklets by hand before the fair. Will pay in zines and dinner.',
  ];
  for (const [i, body] of lines.entries()) await [maya, theo, ines][i % 3]!.call('POST', '/posts', { body });
  await maya.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'A house with infinite halls. Read it in one sitting.' });
  await theo.call('POST', '/events', { title: 'Saturday hike, north gate', description: 'An easy loop, three hours, coffee after.', startsAt: inDays(4), location: 'North gate, 7:00' });

  // ── 1. a new member's feed on a 1366×768 laptop (657px of page): checklist one line, posts in view
  const lap = await open(theo.jar, { width: 1366, height: 657 });
  await lap.goto(WEB);
  await welcome(lap);
  const ck = lap.locator('.checklist');
  await ck.waitFor();
  const ckBox = (await ck.boundingBox())!;
  must(ckBox.height < 100, `the folded checklist is ${ckBox.height}px tall`);
  must(await ck.getByText('Next:').isVisible(), 'the checklist does not say what is next');
  const firstPost = lap.locator('.posts article.post').first();
  await firstPost.waitFor();
  const fp = (await firstPost.boundingBox())!;
  must(fp.y < 657 - 60, `the first post starts at ${fp.y}px, below the first screen`);
  // the menu column fits without scrolling
  const left = await lap.locator('.shell-left').evaluate((el) => ({ s: el.scrollHeight, c: el.clientHeight }));
  must(left.s <= left.c + 1, `the menu column scrolls (${left.s} > ${left.c})`);
  // the pick window is in the right column now, not under the menu
  must(await lap.locator('.rail .pick-win').count() === 1, 'no pick window in the right column');
  must(await lap.locator('.shell-left .pick-win').count() === 0, 'the pick window is still under the menu');
  must(await lap.locator('.interlude').count() === 0, 'a pick window in the feed as well, on a wide screen');
  await shot(lap, 'feed-laptop-new-member');
  await ck.getByRole('button', { name: 'Show all' }).click();
  await ck.getByText('Pick your interests').waitFor();
  await shot(lap, 'checklist-open');
  await ck.getByRole('button', { name: 'Less' }).click();

  // ── 2. keyboard: ? lists, Esc closes, J/K step, N writes, / searches
  await lap.locator('body').click({ position: { x: 5, y: 300 } });
  await lap.keyboard.press('?');
  const kd = lap.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await kd.waitFor();
  await shot(lap, 'shortcuts');
  await lap.keyboard.press('Escape');
  await kd.waitFor({ state: 'hidden' });
  const focused = () => lap.evaluate(() => [...document.querySelectorAll('.posts article.post')].indexOf(document.activeElement as Element));
  await lap.keyboard.press('j');
  const f1 = await focused();
  must(f1 >= 0, 'J did not focus a post');
  await lap.keyboard.press('j');
  must(await focused() === f1 + 1, 'the second J did not move to the next post');
  await lap.keyboard.press('k');
  must(await focused() === f1, 'K did not go back');
  await shot(lap, 'post-in-focus');
  await lap.keyboard.press('Enter');
  await lap.waitForFunction(() => location.pathname.startsWith('/p/'));
  await lap.getByRole('heading', { name: 'Thread' }).waitFor({ state: 'attached' });
  await lap.keyboard.press('n');
  await lap.waitForFunction(() => location.pathname === '/'); // (waitForURL misses some client-side pushes)
  await lap.waitForFunction(() => document.activeElement?.matches('#compose textarea'));
  await lap.keyboard.press('Escape');
  must(await lap.evaluate(() => !document.activeElement?.matches('textarea')), 'Esc did not leave the composer');
  await lap.keyboard.press('/');
  await lap.waitForFunction(() => location.pathname === '/search');
  await lap.waitForFunction(() => document.activeElement?.matches('input[type=search]'));
  await lap.goto(`${WEB}/members`);
  await lap.getByLabel('Find a member').waitFor();
  await lap.locator('body').click({ position: { x: 5, y: 300 } });
  await lap.keyboard.press('/');
  must(await lap.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Find a member', '/ on Members did not go to its own search box');
  // no window repeats its page: seats on Members, next events on Events
  must(await lap.locator('.rail .seat-chart').count() === 0, 'the seats window is on the Members page');
  await lap.goto(`${WEB}/events`);
  await lap.getByRole('heading', { name: 'Events' }).waitFor();
  must(await lap.locator('.rail').getByText('next_events').count() === 0, 'the next events window is on the Events page');
  await lap.close();

  // ── 3. the admin's menu: drawers in their own group, still no scroll on the laptop
  const adm = await open(maya.jar, { width: 1366, height: 657 });
  await adm.goto(WEB);
  await welcome(adm);
  await adm.locator('.nav a.nav-drawer-first').waitFor();
  const a2 = await adm.locator('.shell-left').evaluate((el) => ({ s: el.scrollHeight, c: el.clientHeight }));
  must(a2.s <= a2.c + 1, `the admin's menu column scrolls (${a2.s} > ${a2.c})`);
  const drawers = await adm.locator('.nav a.nav-drawer').allInnerTexts();
  must(drawers.join(',').replace(/[\s\d]/g, '') === 'Notifications,Settings,Admin', `drawers: ${drawers.join(',')}`);
  await shot(adm, 'feed-admin-menu');

  // ── 4. narrower desktop (no right column): the pick window goes back into the feed
  await adm.setViewportSize({ width: 1024, height: 768 });
  await adm.locator('.interlude .pick-win').waitFor();
  await shot(adm, 'feed-1024-pick-in-feed');
  await adm.setViewportSize({ width: 1366, height: 657 });

  // a visitor pass for the next part
  const pass = await maya.call('POST', '/ops/visitor-passes', { label: 'Desktop test' });
  await adm.close();

  // ── 5. a visitor: time left once (side window), greyed buttons say why on hover
  const v = client();
  await v.call('POST', '/visit', { code: pass.code });
  const vis = await open(v.jar, { width: 1366, height: 768 });
  await vis.goto(WEB);
  await vis.locator('.rail').getByText('visitor', { exact: true }).waitFor();
  must(!(await vis.locator('.nav .nav-visitor').isVisible()), 'the visitor pill shows in the menu and in the side window');
  await vis.goto(`${WEB}/events`);
  const host = vis.locator('.shell-main [data-why]', { hasText: 'Host an event' });
  await host.hover();
  const slip = await host.evaluate((el) => getComputedStyle(el, '::after').content);
  must(slip.includes('Visitors can only watch'), `no reason on hover: ${slip}`);
  must((await host.evaluate((el) => getComputedStyle(el).backgroundImage)).includes('repeating'), 'a greyed-out button lights up on hover');
  await shot(vis, 'visitor-why-on-hover');

  // ── 6. a portfolio with About and Skills but no experience: one column, no empty box
  await vis.goto(`${WEB}/u/maya`);
  await vis.getByRole('heading', { name: 'Maya Lind' }).waitFor();
  must(await vis.locator('.pf-cv.one').count() === 1, 'the half-empty portfolio box is still two columns');
  must(await vis.locator('.pf-cv .pf-col').count() === 1, 'an empty portfolio column is still drawn');
  await shot(vis, 'portfolio-one-column', true);
  await vis.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
