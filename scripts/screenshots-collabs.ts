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

  // ── M2. collabs: start one, ask to join, accept, invite someone who fits
  const max = await apiMember('max', 'Max Okafor', 'man');
  await max.call('PUT', '/me/interests', { interests: ['film', 'writing'] });
  await ivy.call('POST', '/collabs', {
    title: 'Saturday river cleanup', description: 'Two hours, bags and gloves provided. Coffee after.',
    interests: ['volunteering', 'environment'], roles: [], teamMax: 12, joinMode: 'open',
    priceNote: 'Free. Donations go to the river trust', paymentUrl: 'https://example.org/river-trust',
  });

  await page.goto(`${WEB}/collabs/new`);
  await page.getByLabel('Title').fill('A short film about the night market');
  await page.getByLabel(/What is it/).fill('Ten minutes, shot on phones over four Friday nights.\n\nWe need people who can hold a camera steady, record sound, and cut it together.');
  const form = page.locator('form.collab-form');
  for (const label of ['Film', 'Photography']) await form.getByRole('button', { name: label, exact: true }).click();
  for (const r of ['Camera', 'Sound', 'Editor']) { await page.getByLabel('A role').fill(r); await page.getByRole('button', { name: 'Add', exact: true }).click(); }
  await page.getByLabel(/Requirements/).fill('A phone with a good camera. Free on Friday evenings.');
  await page.getByLabel(/Team size/).fill('5');
  await shot(page, 'collab-new', true);
  await page.getByRole('button', { name: 'Start it' }).click();
  await page.waitForURL(/\/collabs\/[0-9a-f-]{36}$/);
  const collabUrl = page.url();
  await page.getByRole('heading', { name: 'Invite people' }).waitFor();
  await page.locator('.list .who', { hasText: 'Ivy Chen' }).waitFor();
  await shot(page, 'collab-host', true);

  const ivyPage = await browse(await browser.newContext(view), ivy.jar);
  await ivyPage.goto(`${WEB}/collabs`);
  await ivyPage.getByText('A short film about the night market').waitFor();
  await shot(ivyPage, 'collabs-for-you');
  await ivyPage.getByRole('tab', { name: 'All' }).click();
  await ivyPage.getByText('Saturday river cleanup').waitFor();
  await shot(ivyPage, 'collabs-all');
  await ivyPage.goto(collabUrl);
  await ivyPage.getByRole('button', { name: 'Ask to join' }).click();
  await ivyPage.getByLabel(/A note for the host/).fill('I shoot a lot at night, and I have a gimbal.');
  await ivyPage.getByRole('button', { name: 'Send request' }).click();
  await ivyPage.getByText('You asked to join.').waitFor();
  await shot(ivyPage, 'collab-asked');

  await page.reload();
  await page.getByText('I shoot a lot at night').waitFor();
  await page.locator('.list .who', { hasText: 'Max Okafor' }).waitFor();
  await page.locator('section.card', { hasText: 'Asking to join' }).screenshot({ path: file('collab-requests') });
  console.log('saved collab-requests');
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByText('@ivy is on the team.').waitFor();
  await page.locator('.list li', { hasText: 'Max Okafor' }).getByRole('button', { name: 'Invite' }).click();
  await page.getByText('Invited @max.').waitFor();
  await page.locator('.crowd', { hasText: 'Ivy Chen' }).getByRole('button', { name: 'Make co-host' }).click();
  await page.locator('.crowd li', { hasText: 'Ivy Chen' }).getByText('co-host').waitFor();
  await shot(page, 'collab-team', true);

  const maxPage = await browse(await browser.newContext(view), max.jar);
  await maxPage.goto(`${WEB}/notifications`);
  await maxPage.getByText(/invited you to join "A short film/).waitFor();
  await shot(maxPage, 'notif-invite');
  await maxPage.getByText(/invited you to join "A short film/).click();
  await maxPage.getByRole('button', { name: 'Join the team' }).click();
  await maxPage.getByText('You are on the team.').waitFor();
  await shot(maxPage, 'collab-joined', true);

  await ivyPage.goto(`${WEB}/notifications`);
  await ivyPage.getByText(/You are on the team for/).waitFor();
  await shot(ivyPage, 'notif-accepted');
  await ivyPage.goto(`${WEB}/u/ivy`);
  await ivyPage.getByRole('tab', { name: 'Collabs' }).click();
  await ivyPage.locator('ul.collabs').getByText('Saturday river cleanup').waitFor();
  await ivyPage.locator('ul.collabs').scrollIntoViewIfNeeded();
  await shot(ivyPage, 'profile-collabs');

  const mobile = await browse(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), nova.jar);
  await mobile.goto(`${WEB}/collabs?x=1`);
  await mobile.getByRole('tab', { name: 'All' }).click();
  await mobile.getByText('Saturday river cleanup').waitFor();
  await shot(mobile, 'mobile-collabs');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}