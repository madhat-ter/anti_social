/**
 * Collabs (RFC §10.5) screenshots: interests, collabs, meetups and updates. In-process API on :3101, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-collabs.ts
 * Output: .screenshots/collabs/NN-name.png
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'collabs');
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
const view = { viewport: { width: 1280, height: 900 } };
try {
  const nova = await apiMember('nova', 'Nova Lind', 'woman');
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman');
  await ivy.call('PUT', '/me/interests', { interests: ['film', 'music', 'photography'] });

  // ── M1. interests: picked in Settings, shown on the profile, and a checklist item
  const page = await browse(await browser.newContext(view), nova.jar);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('link', { name: 'Pick your interests' }).waitFor();
  await page.goto(`${WEB}/settings#interests`);
  const sec = page.locator('section[aria-labelledby=interests]');
  for (const label of ['Film', 'Hiking', 'Volunteering', 'Photography']) await sec.getByRole('button', { name: label, exact: true }).click();
  await sec.getByText('(4 now)').waitFor();
  await sec.screenshot({ path: file('settings-interests') });
  console.log('saved settings-interests');
  const saved = (await nova.call('GET', '/me')).interests;
  if (saved.join() !== 'film,hiking,photography,volunteering') throw new Error(`interests not saved: ${saved}`);
  await page.goto(`${WEB}/u/ivy`);
  await page.locator('.interest-tags').getByText('Photography').waitFor();
  await shot(page, 'profile-interests');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}