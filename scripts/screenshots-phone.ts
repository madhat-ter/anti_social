/**
 * The phone shell (PhoneBar.tsx). In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-phone.ts
 * Output: .screenshots/phone/NN-name.png
 * A member on a 390px phone: the feed opens on posts (one-line composer, folded checklist, the pick
 * window after the third post), the bell in the header, the "you" sheet, the rooms; then a visitor
 * on a phone, a tablet, and the desktop for regression.
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'phone');
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
  await page.getByLabel('Woman').check();
  await page.getByLabel('Your birthday', { exact: true }).fill(SETUP.birthday);
  await page.getByLabel('Cell phone', { exact: true }).fill(SETUP.phone);
  await page.getByLabel('Email', { exact: true }).fill(SETUP.email);
  // the three house rules close the setup page; no welcome window afterwards
  await page.getByRole('heading', { name: 'Three things keep your seat' }).waitFor();
  await shot(page, 'setup-with-rules', true);
  await page.getByRole('button', { name: 'Done, take me in' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
  if (await page.getByRole('button', { name: 'Got it' }).count()) throw new Error('the welcome window shows on top of the rules');
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
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  // ── the room: maya joins through the UI (so she has a real session); the others through the API
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const desk = await newUser(deskCtx);
  await desk.goto(WEB);
  await desk.getByText(/No invite\?/).waitFor();
  await desk.waitForTimeout(2500); // the boot sequence: type, alert, then the hundred faces
  await shot(desk, 'landing-desktop', true);
  await join_(desk, 'maya', 'Maya Lind');
  await q(`update users set role = 'ops' where handle = 'maya'`);
  const theo = await apiMember('theo', 'Theo Park', 'man');
  const juno = await apiMember('juno', 'Juno Reyes');
  const ines = await apiMember('ines', 'Inês Moreau', 'woman');
  const mine = await desk.evaluate(async () => {
    const r = await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'First week here. The quiet is loud.' }) });
    return (await r.json()).id as string;
  });
  await theo.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate, back by noon.' });
  await juno.call('POST', '/posts', { body: 'Found a tiny bookshop behind the station that only opens on Thursdays. Going back with a bigger bag.' });
  await ines.call('POST', '/posts', { body: 'Reminder that the best social network is a dinner table. Hosting one on Friday, see Events.' });
  await theo.call('POST', '/posts', { body: 'Is that the one next to the bookshop? Going Saturday.', parentId: mine });
  await juno.call('POST', `/posts/${mine}/like`);
  await ines.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'A house with infinite halls. Read it in one sitting.' });
  await theo.call('POST', '/events', { title: 'Saturday hike, north gate', description: 'An easy loop, three hours, coffee after.', startsAt: inDays(4), location: 'North gate, 7:00' });
  await ines.call('POST', '/events', { title: 'Long table dinner', description: 'Twelve chairs, one table, bring a dish.', startsAt: inDays(6), location: 'Elm Street café', capacity: 12 });
  await juno.call('POST', '/collabs', { title: 'Zine about the old market', description: 'We print a small zine about the stalls and the people who run them.', interests: ['writing', 'photography'], roles: ['Writer', 'Photographer'], teamMax: 4, joinMode: 'approve' });
  await theo.call('PUT', '/me/interests', { interests: ['hiking', 'photography'] });
  await ines.call('PUT', '/me/interests', { interests: ['photography', 'cooking'] });

  // ── 1. the phone: maya's session on a 390px screen
  const state = await deskCtx.storageState();
  const phoneCtx = await browser.newContext({ ...PHONE, storageState: state });
  const ph = await phoneCtx.newPage();
  watch(ph);
  await ph.goto(WEB);
  await ph.getByText('Reminder that the best social network').waitFor();
  const bar = ph.getByRole('navigation', { name: 'Main' });
  for (const name of ['Feed', 'Events', 'Collabs', 'Members']) await bar.getByRole('link', { name }).waitFor();
  await bar.getByRole('button', { name: /You/ }).waitFor();
  if (await ph.locator('nav.nav').isVisible()) throw new Error('the desktop menu shows on a phone');
  const bell = ph.getByRole('link', { name: /^Notifications/ });
  await bell.waitFor();
  await ph.getByRole('link', { name: /^Notifications, \d+ unread/ }).waitFor();
  console.log('bell:', await bell.getAttribute('aria-label'));
  const composer = ph.locator('#compose .composer');
  if (await composer.locator('.composer-bar').isVisible()) throw new Error('the composer is not collapsed');
  const box = await composer.boundingBox();
  if (!box || box.height > 120) throw new Error(`collapsed composer is ${box?.height}px tall`);
  // the pick window comes after the third post, not before the first
  const firstPostY = (await ph.locator('article.post').first().boundingBox())!.y;
  const pickY = (await ph.locator('.feed-pick').boundingBox())!.y;
  if (pickY < firstPostY) throw new Error('the pick window is above the first post');
  if (await ph.locator('.checklist .checklist-items').isVisible()) throw new Error('the checklist is not folded');
  await shot(ph, 'phone-feed');
  await shot(ph, 'phone-feed-full', true);

  // ── 1b. somebody posts while the feed is open: a pill, not a jump
  await juno.call('POST', '/posts', { body: 'Just finished the zine layout. Printing Thursday.' });
  await ph.evaluate(() => window.dispatchEvent(new Event('focus')));
  const pill = ph.getByRole('button', { name: /1 new post/ });
  await pill.waitFor();
  if (await ph.getByText('Just finished the zine layout').count()) throw new Error('the new post jumped into the feed');
  await shot(ph, 'phone-new-posts-pill');
  await pill.tap();
  await ph.getByText('Just finished the zine layout').waitFor();
  await pill.waitFor({ state: 'hidden' });

  // ── 2. tap to write: the composer opens
  await ph.getByPlaceholder('What is on your mind?').tap();
  await composer.locator('.composer-bar').waitFor({ state: 'visible' });
  await ph.getByPlaceholder('What is on your mind?').fill('Typing on the phone.');
  await shot(ph, 'phone-composer-open');
  await ph.getByPlaceholder('What is on your mind?').fill('');
  await ph.locator('h1.sr-only').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // ── 3. the checklist unfolds
  await ph.locator('.checklist').getByRole('button', { name: 'Show' }).tap();
  await ph.locator('.checklist .checklist-items').waitFor({ state: 'visible' });
  await ph.locator('.checklist').screenshot({ path: file('phone-checklist-open') });
  console.log('saved phone-checklist-open');
  await ph.locator('.checklist').getByRole('button', { name: 'Less' }).tap();

  // ── 4. the "you" sheet
  await bar.getByRole('button', { name: /You/ }).tap();
  const sheet = ph.getByRole('dialog', { name: 'You' });
  await sheet.waitFor();
  for (const name of ['Notifications', 'Search', 'Settings', 'Admin']) await sheet.getByRole('link', { name: new RegExp(`^${name}`) }).waitFor();
  await shot(ph, 'phone-you-sheet');
  await ph.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  // ── 5. the bell: notifications, and the badge goes
  await bell.tap();
  await ph.waitForURL(`${WEB}/notifications`);
  await ph.getByText('replied to your post').waitFor();
  await shot(ph, 'phone-notifications');

  // ── 6. the rooms
  await bar.getByRole('link', { name: 'Events' }).tap();
  await ph.getByText('Long table dinner').first().waitFor();
  await shot(ph, 'phone-events');
  await bar.getByRole('link', { name: 'Members' }).tap();
  await ph.getByText(/of 20 seats taken/).waitFor();
  await shot(ph, 'phone-members');
  // the interest chips narrow the room
  await ph.getByRole('button', { name: /^Hiking/ }).tap();
  await ph.getByText('Theo Park').waitFor();
  if (await ph.locator('.seatmap li').count() !== 1) throw new Error('the Hiking chip did not narrow the list to one');
  await shot(ph, 'phone-members-filtered');
  await ph.getByRole('button', { name: 'Everyone' }).tap();
  await ph.getByLabel('Find a member').fill('ines');
  await ph.getByText('Inês Moreau').waitFor();
  if (await ph.locator('.seatmap li').count() !== 1) throw new Error('the search did not narrow the list to one');
  await ph.getByLabel('Find a member').fill('');
  await bar.getByRole('link', { name: 'Collabs' }).tap();
  await ph.getByText('Zine about the old market').first().waitFor();
  await shot(ph, 'phone-collabs');
  // a drawer page (search): the you tab is lit
  await ph.goto(`${WEB}/search`);
  await ph.getByRole('heading', { name: 'Search' }).waitFor();
  if (!(await bar.locator('.tb-you.on').count())) throw new Error('the you tab is not lit on Search');
  // the folder tabs on Events must be untouched by the tab bar's styles
  await bar.getByRole('link', { name: 'Events' }).tap();
  const folderTab = ph.locator('.tabs .tab.on').first();
  await folderTab.waitFor();
  const fb = await folderTab.boundingBox();
  if (!fb || fb.height > 60) throw new Error(`folder tab is ${fb?.height}px tall: tab bar styles leaked`);
  await shot(ph, 'phone-search');
  await phoneCtx.close();

  // ── 7. a visitor on a phone: one line where the composer was, the time left in the fifth tab
  const made = await desk.evaluate(async () => {
    const r = await fetch('/api/ops/visitor-passes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Phone test' }) });
    return (await r.json()) as { code: string };
  });
  const visCtx = await browser.newContext(PHONE);
  const vis = await visCtx.newPage();
  watch(vis);
  await vis.goto(`${WEB}/visit/${made.code}`);
  await vis.getByRole('button', { name: 'Visit for an hour' }).tap();
  await vis.waitForURL(`${WEB}/`);
  await vis.getByText('Reminder that the best social network').waitFor();
  if (await vis.locator('#compose').isVisible()) throw new Error('a visitor on a phone sees the dead composer');
  await vis.getByRole('note').filter({ hasText: 'Visitors can only watch' }).waitFor();
  const vbar = vis.getByRole('navigation', { name: 'Main' });
  await vbar.getByRole('button', { name: /Visitor, \d+ minutes left/ }).waitFor();
  if (await vis.locator('.top-bell').count()) throw new Error('a visitor has a bell');
  await shot(vis, 'phone-visitor-feed');
  await vbar.getByRole('button', { name: /Visitor/ }).tap();
  await vis.getByRole('dialog', { name: 'Visitor' }).getByRole('button', { name: 'Leave' }).waitFor();
  await shot(vis, 'phone-visitor-sheet');
  await visCtx.close();

  // ── 8. a tablet (768): the phone shell too; the desktop (1280): unchanged
  const tabCtx = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: state });
  const tab = await tabCtx.newPage();
  watch(tab);
  await tab.goto(WEB);
  await tab.getByText('Reminder that the best social network').waitFor();
  await tab.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /You/ }).waitFor();
  await shot(tab, 'tablet-feed');
  await tabCtx.close();
  await desk.goto(WEB);
  await desk.getByText('Reminder that the best social network').waitFor();
  const dnav = desk.getByRole('navigation', { name: 'Main' });
  await dnav.getByRole('link', { name: 'Settings' }).waitFor();
  if (await desk.locator('.tabbar').isVisible()) throw new Error('the tab bar shows on the desktop');
  if (!(await desk.locator('#compose .composer-bar').isVisible())) throw new Error('the desktop composer is collapsed');
  if (await desk.locator('.top-bell').isVisible()) throw new Error('the bell shows on the desktop');
  await shot(desk, 'desktop-feed');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} catch (e) {
  if (pageErrors.length) console.error('page errors so far:\n' + pageErrors.join('\n'));
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) {
    await pg.screenshot({ path: join(OUT, `_failed-${pg.url().replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`) }).catch(() => {});
  }
  throw e;
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
