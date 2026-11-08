/**
 * Birthday (RFC §10.3) screenshots. In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-birthdays.ts
 * Output: .screenshots/birthdays/NN-name.png
 * Ivy and Ben have their birthday today (this machine's date); Sam too, but hides it.
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'birthdays');
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
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}

const pageErrors: string[] = [];
const ABOUT = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const now = new Date();
const pad = (x: number) => String(x).padStart(2, '0');
const bornToday = (age: number) => `${now.getFullYear() - age}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** A member who only talks to the API; returns its call() and cookie jar. */
async function apiMember(handle: string, displayName: string, gender: string, birthday: string) {
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
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday });
  return { call, jar };
}

/** A browser session for an API member: their cookie jar copied into a context. */
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(60_000);
  return page;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1280, height: 860 } };
  const nova = await apiMember('nova', 'Nova Lind', 'woman', '2001-03-17');
  await q(`update users set role = 'ops' where handle = 'nova'`);
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman', bornToday(24));
  const ben = await apiMember('ben', 'Ben Ortiz', 'man', bornToday(31));
  const sam = await apiMember('sam', 'Sam Reed', 'nonbinary', bornToday(27));
  await sam.call('PATCH', '/me', { birthdayPublic: false });
  await ivy.call('POST', '/posts', { body: 'Another lap around the sun. Cake at the north gate at 6, everyone welcome.' });
  await ben.call('POST', '/posts', { body: 'Same day as Ivy, apparently. I am bringing bread.' });
  await sam.call('POST', '/posts', { body: 'Happy birthday you two!' });

  // ── 1. the feed: tags by Ivy and Ben (not Sam, who hides it) and the side window
  const page = await browse(await browser.newContext(view), nova.jar);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.locator('.posts').getByText('Cake at the north gate').waitFor();
  const tags = await page.locator('.posts .tag.bday').count();
  if (tags !== 2) throw new Error(`expected 2 birthday tags in the feed, got ${tags}`);
  await page.getByText('Today is the birthday of').waitFor();
  console.log('feed tags and side window ok (Sam hidden)');
  await shot(page, 'feed', false);

  // ── 2. the member list and a profile
  await page.goto(`${WEB}/members`);
  await page.getByText('Ivy Chen').first().waitFor();
  await shot(page, 'members', false);
  await page.goto(`${WEB}/u/ivy`);
  await page.getByText('birthday today').first().waitFor();
  await shot(page, 'profile', false);

  // ── 3. Settings: your birthday, and the switch
  await page.goto(`${WEB}/settings`);
  const sec = page.locator('section[aria-labelledby=bday]');
  await sec.getByText('17 March 2001').or(sec.getByText('March 17, 2001')).waitFor();
  await sec.screenshot({ path: file('settings') });
  console.log('saved settings');

  // ── 4. admins see ages and can correct a birthday (the date dialog)
  await page.goto(`${WEB}/admin`);
  const row = page.locator('.adm-members > li', { has: page.getByText('@ben', { exact: true }) });
  await row.getByText('age 31').waitFor();
  await row.getByRole('button', { name: 'Change birthday' }).click();
  await page.locator('dialog[open]').waitFor();
  await shot(page, 'admin-change-birthday', false);
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();

  // ── 5. phone: one line above the feed instead of the side window
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await browse(phone, nova.jar);
  await ph.goto(WEB);
  await ph.getByText('Birthday today:').waitFor();
  await shot(ph, 'phone-feed', false);

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
