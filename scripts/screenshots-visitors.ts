/**
 * Visitor passes (RFC §10.8). In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-visitors.ts
 * Output: .screenshots/visitors/NN-name.png
 * The admin makes a pass; a visitor opens the link, looks around (every control struck out, every
 * write refused by the API), tries the back doors, is ended by the admin, sees the ended page.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
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

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const SETUP = { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'undisclosed', birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'member@example.com' };
const OUT = join(import.meta.dir, '..', '.screenshots', 'visitors');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
const file = (name: string) => join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}
const pageErrors: string[] = [];
function watch(page: Page) {
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (msg) => { if (/Content.Security.Policy/i.test(msg.text())) pageErrors.push(`CSP: ${msg.text()}`); });
  page.setDefaultTimeout(90_000);
}
async function newUser(ctx: BrowserContext) {
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return page;
}

async function join_(page: Page, handle: string, name: string) {
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(formatInviteCode(code));
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Set up your profile' }).waitFor();
  await page.locator('#su-about-text').fill(SETUP.about);
  await page.getByLabel('Prefer not to say').check();
  await page.getByLabel('Your birthday', { exact: true }).fill(SETUP.birthday);
  await page.getByLabel('Cell phone', { exact: true }).fill(SETUP.phone);
  await page.getByLabel('Email', { exact: true }).fill(SETUP.email);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {}); // the rules now live at the end of setup; the welcome window only shows for members from before
}

/** A member who only talks to the API: joins with a fake passkey, keeps its session cookie. */
async function apiMember(handle: string, displayName: string, gender = 'undisclosed') {
  const authn = new FakeAuthenticator();
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) {
      const [k, ...v] = sc.split(';')[0]!.split('=');
      if (v.join('=')) jar.set(k!.trim(), v.join('='));
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${handle}: ${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  const o = await call('POST', '/auth/register/options', { code: formatInviteCode(code), handle, displayName });
  await call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await call('PUT', '/me/setup', { ...SETUP, gender });
  return { call, jar };
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1280, height: 860 } };

  // ── the room: an admin who joins through the UI, members with posts, a pick, an event, a collab, a consult offer
  const seefCtx = await browser.newContext(view);
  const seef = await newUser(seefCtx);
  await join_(seef, 'seef', 'Seef');
  await q(`update users set role = 'ops' where handle = 'seef'`);
  const maya = await apiMember('maya', 'Maya Lind', 'woman');
  const theo = await apiMember('theo', 'Theo Park', 'man');
  const juno = await apiMember('juno', 'Juno Reyes');
  await maya.call('POST', '/posts', { body: 'Printed the first twenty copies of the market zine tonight. The red came out darker than the proof, and I think I like it more.' });
  await theo.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate, back by noon.' });
  await juno.call('POST', '/posts', { body: 'Found a tiny bookshop behind the station that only opens on Thursdays. Going back with a bigger bag.' });
  await maya.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'A house with infinite halls. Read it in one sitting.' });
  await theo.call('POST', '/events', { title: 'Saturday hike, north gate', description: 'An easy loop, three hours, coffee after.', startsAt: inDays(4), location: 'North gate, 7:00' });
  await maya.call('POST', '/collabs', { title: 'Zine about the old market', description: 'We print a small zine about the stalls and the people who run them.', interests: ['writing', 'photography'], roles: ['Writer', 'Photographer'], teamMax: 4, joinMode: 'approve' });
  await maya.call('PATCH', '/me/portfolio', { headline: 'Illustrator and zine maker', location: 'Kathmandu', skills: ['Illustration', 'Risograph', 'Layout'] });
  await maya.call('PUT', '/me/consult-offer', { active: true, description: 'Portfolio reviews and first-job advice.', minutes: 60, pricing: 'free', contact: 'Telegram @maya' });

  // ── 1. the admin makes a pass
  await seef.goto(`${WEB}/admin`);
  const sec = seef.locator('section[aria-labelledby=adm-visit]');
  await sec.getByRole('heading', { name: 'Visitor passes' }).waitFor();
  await sec.getByLabel(/Who is it for/).fill('Priya from the agency');
  await sec.getByRole('button', { name: 'Make a 1-hour pass' }).click();
  await sec.getByRole('button', { name: 'Copy link' }).waitFor();
  await sec.screenshot({ path: file('admin-pass-made') });
  console.log('saved admin-pass-made');
  const code = (await sec.locator('.code').first().innerText()).trim();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error(`odd code: ${code}`);
  const link = (await sec.locator('.adm-visit-link').innerText()).trim();
  if (link !== `${WEB}/visit/${code}`) throw new Error(`odd link: ${link}`);

  // ── 2. the landing page has the code form; the link lands on the pass page
  const visCtx = await browser.newContext(view);
  const vis = await visCtx.newPage();
  watch(vis);
  await vis.goto(WEB);
  await vis.getByText('Have a visitor code?').waitFor();
  await shot(vis, 'landing-with-code-form', true);
  await vis.goto(link);
  await vis.getByRole('heading', { name: 'Visitor pass' }).waitFor();
  await shot(vis, 'visit-page');

  // ── 3. in: the feed as a visitor, pill with the time left, composer struck out
  await vis.getByRole('button', { name: 'Visit for an hour' }).click();
  await vis.waitForURL(`${WEB}/`);
  await vis.getByText(/Visitor/).first().waitFor();
  await vis.getByText('Printed the first twenty copies').waitFor();
  const nav = vis.getByRole('navigation', { name: 'Main' });
  if (await nav.getByRole('link', { name: 'Settings' }).count()) throw new Error('a visitor sees Settings');
  if (await nav.getByRole('link', { name: 'Notifications' }).count()) throw new Error('a visitor sees Notifications');
  if (!(await nav.getByText(/min left/).count())) throw new Error('no time left in the pill');
  const ta = vis.locator('#compose textarea');
  if (!(await ta.isDisabled())) throw new Error('the composer is not disabled for a visitor');
  if ((await ta.getAttribute('placeholder')) !== 'Visitors can only watch.') throw new Error('composer placeholder');
  const like = vis.locator('article.post').first().getByRole('button', { name: /Like/ });
  if (!(await like.isDisabled())) throw new Error('like is not disabled');
  if (await vis.locator('article.post').first().getByRole('button', { name: 'Post actions' }).count()) throw new Error('visitor sees post actions');
  await shot(vis, 'visitor-feed', true);

  // ── 4. the back doors: every write refused by the API, members-only pages bounce to the feed
  const r = await vis.request.post(`${WEB}/api/posts`, { data: { body: 'sneaky' }, headers: { origin: WEB } });
  if (r.status() !== 403 || (await r.json()).error !== 'visitor_readonly') throw new Error(`POST /posts as visitor -> ${r.status()}`);
  const r2 = await vis.request.get(`${WEB}/api/notifications`);
  if (r2.status() !== 403) throw new Error(`GET /notifications as visitor -> ${r2.status()}`);
  const r3 = await vis.request.get(`${WEB}/api/ops/visitor-passes`);
  if (r3.status() !== 404) throw new Error(`GET /ops as visitor -> ${r3.status()}`);
  console.log('API: writes 403, inbox 403, admin 404 ok');
  await vis.goto(`${WEB}/settings`);
  await vis.waitForURL(`${WEB}/`);
  await vis.goto(`${WEB}/notifications`);
  await vis.waitForURL(`${WEB}/`);
  await vis.goto(`${WEB}/events/new`);
  await vis.waitForURL(`${WEB}/`);
  console.log('settings, notifications, events/new bounce to the feed ok');

  // ── 5. looking around: events, a collab, a member's portfolio with a consult offer
  await vis.goto(`${WEB}/events`);
  const host = vis.locator('.btn[aria-disabled=true]', { hasText: 'Host an event' });
  await host.waitFor();
  await vis.getByText('Saturday hike').first().waitFor();
  await shot(vis, 'visitor-events');
  await vis.getByRole('link', { name: /Saturday hike/ }).first().click();
  await vis.getByRole('heading', { name: 'Saturday hike, north gate' }).waitFor();
  const going = vis.getByRole('button', { name: "I'm going" });
  if (!(await going.isDisabled())) throw new Error("I'm going not disabled");
  await shot(vis, 'visitor-event');
  await vis.goto(`${WEB}/collabs`);
  await vis.locator('.btn[aria-disabled=true]', { hasText: 'Start a collab' }).waitFor();
  await vis.getByText('Zine about the old market').first().waitFor();
  await shot(vis, 'visitor-collabs');
  await vis.goto(`${WEB}/u/maya`);
  await vis.getByText('Illustrator and zine maker').waitFor();
  await vis.locator('.btn[aria-disabled=true]', { hasText: 'Book a consultation' }).waitFor();
  await shot(vis, 'visitor-portfolio', true);
  await vis.goto(`${WEB}/members`);
  await vis.getByText(/of 20 seats taken/).waitFor();
  if (await vis.getByText('@visitor').count()) throw new Error('the visitor is listed as a member');
  await shot(vis, 'visitor-members');

  // ── 6. the same code again, from another browser: used
  const again = await browser.newContext(view);
  const ag = await again.newPage();
  watch(ag);
  await ag.goto(link);
  await ag.getByRole('button', { name: 'Visit for an hour' }).click();
  await ag.getByText('This pass has already been used.').waitFor();
  await shot(ag, 'pass-already-used');
  await again.close();

  // ── 7. a member opening the link: no pass needed
  await seef.goto(link);
  await seef.getByText('You are already a member. No pass needed.').waitFor();
  await shot(seef, 'member-opens-link');

  // ── 8. the admin's list shows the visit; ending it
  await seef.goto(`${WEB}/admin`);
  await sec.getByText('visiting now').waitFor();
  await sec.screenshot({ path: file('admin-pass-active') });
  console.log('saved admin-pass-active');
  await sec.getByRole('button', { name: 'End the visit' }).click();
  await seef.locator('dialog[open]').waitFor();
  await shot(seef, 'admin-end-visit-confirm');
  await seef.locator('dialog[open]').getByRole('button', { name: 'End it' }).click();
  await sec.getByText(/revoked/).first().waitFor();
  await sec.screenshot({ path: file('admin-pass-revoked') });
  console.log('saved admin-pass-revoked');

  // ── 9. the visitor's next click: the hour is up
  await vis.goto(`${WEB}/events`);
  await vis.waitForURL(`${WEB}/visit/ended`);
  await vis.getByRole('heading', { name: 'Your hour is up' }).waitFor();
  await shot(vis, 'hour-up');
  await vis.goto(WEB);
  await vis.getByText('Have a visitor code?').waitFor(); // a stranger again
  console.log('ended visitor is a stranger again ok');

  // ── 10. phone: a fresh pass, the feed on a small screen
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  watch(ph);
  await sec.getByLabel(/Who is it for/).fill('Phone test');
  await sec.getByRole('button', { name: 'Make a 1-hour pass' }).click();
  await sec.getByRole('button', { name: 'Copy link' }).waitFor();
  const code2 = (await sec.locator('.code').first().innerText()).trim();
  await ph.goto(`${WEB}/visit/${code2}`);
  await ph.getByRole('button', { name: 'Visit for an hour' }).click();
  await ph.waitForURL(`${WEB}/`);
  await ph.getByText('Printed the first twenty copies').waitFor();
  await shot(ph, 'phone-visitor-feed');
  await phone.close();

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
