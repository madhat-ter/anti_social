/**
 * Picks "tried it" screenshots and timing checks. In-process API on :3101, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-picks.ts          (takes ~3 minutes: it waits out the 60 s rotation twice)
 * Output: .screenshots/picks/NN-name.png
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'picks');
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
  await page.waitForTimeout(300);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}
const pageErrors: string[] = [];
const ABOUT = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');

async function apiMember(handle: string, displayName: string, gender: string) {
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
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1995-02-11' });
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (msg) => { if (/Content.Security.Policy/i.test(msg.text())) pageErrors.push(`CSP: ${msg.text()}`); });
  page.setDefaultTimeout(60_000);
  return page;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const nova = await apiMember('nova', 'Nova Lind', 'woman');
  await q(`update users set role = 'ops' where handle = 'nova'`);
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman');
  const ben = await apiMember('ben', 'Ben Ortiz', 'man');
  const sam = await apiMember('sam', 'Sam Reed', 'nonbinary');
  const film = await ivy.call('POST', '/suggestions', { kind: 'movie', title: 'Perfect Days', note: 'A toilet cleaner in Tokyo, and somehow the calmest film of the year.' });
  await ben.call('POST', '/suggestions', { kind: 'food', title: 'Khao soi at Mae', note: 'Ask for the extra crispy noodles.' });
  await sam.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'Read it without looking anything up.' });
  await ben.call('PUT', `/suggestions/${film.id}/vote`, { vote: 1, remark: 'Watched it twice. The tree shadows!' });
  await sam.call('PUT', `/suggestions/${film.id}/vote`, { vote: -1, remark: 'Beautiful, but too slow for me.' });
  // only the film exists in the rotation at first, so the window shows it
  await q(`update suggestions set deleted_at = now() where title <> 'Perfect Days'`);

  const page = await browse(await browser.newContext({ viewport: { width: 1280, height: 900 } }), nova.jar);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click();
  const win = page.locator('aside.pick-win');
  await win.locator('.pick-title', { hasText: 'Perfect Days' }).waitFor();
  await win.getByText('Watched it twice').or(win.getByText('too slow for me')).waitFor();
  await win.screenshot({ path: file('window') });
  console.log('saved window');

  // ── vote, then write a remark (the window holds still while you write)
  await win.getByRole('button', { name: '👍 Good' }).click();
  await win.getByLabel('A remark (optional)').fill('The ending in the car. Bring tissues.');
  await win.screenshot({ path: file('writing-remark') });
  console.log('saved writing-remark');
  await win.getByRole('button', { name: 'Save' }).click();
  await win.getByText('Bring tissues').waitFor();
  const tally = await win.locator('.pick-tally').innerText();
  if (!tally.includes('👍 2') || !tally.includes('👎 1')) throw new Error(`tally after voting: ${tally}`);
  await win.screenshot({ path: file('voted') });
  console.log('saved voted');

  // ── everyone's remarks, with the admin's remove
  await win.getByRole('button', { name: /All remarks/ }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByText('Beautiful, but too slow').waitFor();
  await shot(page, 'all-remarks');
  await dlg.locator('.dlg-actions button').click();

  // ── the minute: it changes on its own when left alone, and holds still under the pointer
  await q(`update suggestions set deleted_at = null`);
  await page.mouse.move(700, 850);
  const before = await win.locator('.pick-title').innerText();
  await page.waitForTimeout(63_000);
  const after = await win.locator('.pick-title').innerText();
  if (after === before) throw new Error(`the pick did not change after a minute (${before})`);
  console.log(`rotated on its own: ${before} -> ${after}`);
  await win.hover();
  const held = await win.locator('.pick-title').innerText();
  await page.waitForTimeout(65_000);
  if ((await win.locator('.pick-title').innerText()) !== held) throw new Error('the pick changed while the pointer was over it');
  console.log('held still under the pointer ok');
  await page.mouse.move(700, 850);
  await win.getByRole('button', { name: 'Another' }).click();
  await page.waitForTimeout(800);
  if ((await win.locator('.pick-title').innerText()) === held) throw new Error('Another did not change the pick');
  console.log('Another ok');

  // ── the suggester's notification, and the profile's picks tab
  const ivyPage = await browse(await browser.newContext({ viewport: { width: 1280, height: 900 } }), ivy.jar);
  await ivyPage.goto(`${WEB}/notifications`);
  await ivyPage.getByText('left a remark on your pick "Perfect Days"').first().waitFor();
  await shot(ivyPage, 'notification');
  await page.goto(`${WEB}/u/ivy`);
  await page.getByRole('tab', { name: 'Picks' }).click();
  await page.locator('.pick-title', { hasText: 'Perfect Days' }).first().waitFor();
  await shot(page, 'profile-picks', true);

  // ── phone
  const ph = await browse(await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), sam.jar);
  await ph.goto(WEB);
  await ph.locator('aside.pick-win .pick-title').waitFor();
  await ph.locator('aside.pick-win').scrollIntoViewIfNeeded();
  await ph.locator('aside.pick-win').screenshot({ path: file('phone-window') });
  console.log('saved phone-window');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
