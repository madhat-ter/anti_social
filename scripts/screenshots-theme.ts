/**
 * RFC §10.14: dark mode, chosen in Settings; light for everyone else. In-process API on :3101,
 * web build on :3100 (see the other screenshot scripts).
 *
 *   bun scripts/screenshots-theme.ts          → .screenshots/theme/NN-name.png
 *
 * Checks: a phone set to dark still gets light until the member chooses Dark; choosing it applies
 * at once and survives a reload with no white first frame (the cookie); the feed, a thread and
 * Settings in dark; a portfolio set to "paper" stays white inside a dark page; signed out is light.
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

const WEB = 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'theme');
mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' });

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
  const c = client();
  const raw = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [raw]);
  await c.call('POST', '/auth/join', { code: formatInviteCode(raw), handle, displayName, pin: '739206' });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string> | null, viewport = { width: 1366, height: 860 }, scheme: 'light' | 'dark' = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  if (jar) await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };
const themeOf = (p: Page) => p.evaluate(() => document.documentElement.dataset.theme ?? 'light');
const paperOf = (p: Page) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '40 days'`);
  const hike = await maya.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate, back by noon.' });
  await theo.call('POST', '/posts', { body: 'In! Can we do the ridge path this time?', parentId: hike.id });
  await theo.call('POST', '/posts', { body: 'The lido is open late this week. Cold water, warm chips, nobody on their phone.' });
  await maya.call('PATCH', '/me/portfolio', { headline: 'Illustrator and zine maker', location: 'Kathmandu', skills: ['Illustration', 'Risograph'], bg: 'paper' });

  // ── 1. Theo's phone is set to dark; Anti is still light until he chooses
  const ph = await open(theo.jar, { width: 390, height: 844 }, 'dark');
  await ph.goto(WEB);
  await welcome(ph);
  await ph.locator('.posts article.post').first().waitFor();
  must(await themeOf(ph) === 'light', 'a dark device turned Anti dark');
  await shot(ph, 'phone-dark-device-still-light');

  // ── 2. Settings → Appearance → Dark: at once
  await ph.goto(`${WEB}/settings#look`);
  await ph.getByText('Theme', { exact: true }).waitFor();
  await ph.getByLabel('Dark').check();
  await ph.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await ph.locator('#look').scrollIntoViewIfNeeded();
  await shot(ph, 'settings-dark');
  must((await theo.call('GET', '/me')).theme === 'dark', 'the choice was not saved on the account');

  // ── 3. a reload paints dark from the first frame (the server reads the cookie)
  const html = await (await ph.context().request.get(WEB)).text();
  must(/<html[^>]*data-theme="dark"/.test(html), 'the server did not paint the page dark');
  await ph.goto(WEB);
  await ph.locator('.posts article.post').first().waitFor();
  await shot(ph, 'phone-feed-dark');
  await ph.goto(`${WEB}/p/${hike.id}`);
  await ph.getByText('ridge path').waitFor();
  await shot(ph, 'phone-thread-dark');
  await ph.close();

  // ── 4. a new laptop: the account carries dark there too
  const lap = await open(theo.jar);
  await lap.goto(WEB);
  await welcome(lap);
  await lap.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await lap.locator('.posts article.post').first().waitFor();
  await shot(lap, 'laptop-feed-dark');
  // a portfolio set to paper stays white inside the dark page
  await lap.goto(`${WEB}/u/maya`);
  await lap.getByRole('heading', { name: 'Maya Lind' }).waitFor();
  const pf = await lap.locator('.bg-paper > .win-body').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  must(pf === 'rgb(255, 255, 255)', `the paper portfolio is not white: ${pf}`);
  await shot(lap, 'portfolio-paper-in-dark');
  await lap.close();

  // ── 5. signed out (with the cookie still in the browser): light
  const out = await open(null, { width: 1366, height: 860 }, 'dark');
  await out.context().addCookies([{ name: 'anti_theme', value: 'dark', domain: 'localhost', path: '/' }]);
  await out.goto(WEB);
  await out.getByRole('link', { name: 'Yes, I have an invite' }).waitFor();
  must(await themeOf(out) === 'light' && (await paperOf(out)) === 'rgb(255, 255, 255)', 'the signed-out landing page is dark');
  await shot(out, 'signed-out-light');
  await out.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
