/**
 * Trust (RFC §10.7): the OG mark, the verified badge, contact details in setup, Settings and Admin. In-process API on :3101, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-trust.ts
 * Output: .screenshots/trust/NN-name.png
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'trust');
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
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
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
const view = { viewport: { width: 1280, height: 900 } };
try {
  const og = await apiMember('OGguy', 'OG Guy', 'man');
  await q("update users set role = 'ops' where handle = 'OGguy'");
  const ana = await apiMember('ana', 'Ana Rai', 'woman');
  const ben = await apiMember('ben', 'Ben Thapa', 'man');
  await og.call('POST', '/ops/users/ana/verify', { on: true });
  await og.call('POST', '/posts', { body: 'Welcome in, everyone. Say hello below.' });
  await ana.call('POST', '/posts', { body: 'Hello! Glad to be here.' });
  await ben.call('POST', '/posts', { body: 'Hi all, Ben here.' });

  const page = await browse(await browser.newContext(view), og.jar);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click().catch(() => {});
  await page.getByText('Glad to be here.').waitFor();
  await page.locator('.posts').screenshot({ path: file('feed-marks') }); console.log('saved feed-marks');
  await page.goto(`${WEB}/u/OGguy`);
  await page.locator('.og-mark').first().waitFor();
  await shot(page, 'profile-og');
  await page.goto(`${WEB}/members`);
  await page.getByText('Ben Thapa').waitFor();
  // the marks ride along on the seat map and in the nav/rail "you" entries too
  await page.locator('.seatmap .og-mark').first().waitFor();
  await page.locator('.seatmap .verified-badge').first().waitFor();
  await page.locator('.nav-me .og-mark').first().waitFor();
  await shot(page, 'members-marks');

  // a member who set up before contact details existed: sent back to setup once
  await q("update users set contact_phone_enc = null, contact_email_enc = null where handle = 'ben'");
  const benPage = await browse(await browser.newContext(view), ben.jar);
  await benPage.goto(WEB);
  await benPage.getByRole('heading', { name: 'Set up your profile' }).waitFor();
  await benPage.getByText('One new thing: contact details').waitFor();
  await benPage.getByLabel('Cell phone', { exact: true }).fill('+977 981-234 5678');
  await benPage.getByLabel('Email', { exact: true }).fill('ben@example.com');
  await benPage.locator('#su-contact').scrollIntoViewIfNeeded();
  await shot(benPage, 'setup-contact');
  await benPage.getByRole('button', { name: 'Done' }).click();
  await benPage.getByPlaceholder('What is on your mind?').waitFor();

  const anaPage = await browse(await browser.newContext(view), ana.jar);
  await anaPage.goto(`${WEB}/settings#contact`);
  await anaPage.getByText('Verified by an admin.').waitFor();
  await anaPage.locator('section[aria-labelledby=contact]').screenshot({ path: file('settings-contact') }); console.log('saved settings-contact');

  await page.goto(`${WEB}/admin#members`);
  const mem = page.locator('section[aria-labelledby=adm-mem]');
  await mem.locator('li', { hasText: 'Ben Thapa' }).getByRole('button', { name: 'Show contact' }).click();
  await mem.getByText('ben@example.com').waitFor();
  await mem.screenshot({ path: file('admin-members') }); console.log('saved admin-members');
  await mem.getByLabel(/Not verified yet/).check();
  await mem.locator('li', { hasText: 'Ben Thapa' }).getByRole('button', { name: 'Verify' }).click();
  await page.getByText('@ben is verified.').waitFor();
  await mem.screenshot({ path: file('admin-verified') }); console.log('saved admin-verified');
  await benPage.goto(`${WEB}/notifications`);
  await benPage.getByText('You are verified.').waitFor();
  await shot(benPage, 'notif-verified');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}