/**
 * The event page's top, redrawn as an ink ticket. Before/after pairs of the same scenes:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-event-poster.ts
 *   bun scripts/screenshots-event-poster.ts
 * Output: .screenshots/event-poster-before/ and .screenshots/event-poster-after/
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

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'event-poster-before' : 'event-poster-after');
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
const inDays = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
};

async function apiMember(handle: string, displayName: string, gender: string) {
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
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>, extra: { name: string; value: string }[] = []) {
  await ctx.addCookies([...jar, ...extra.map((c) => [c.name, c.value] as const)].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(60_000);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  return page;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const wide = { viewport: { width: 1280, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true };
try {
  const nova = await apiMember('nova', 'Nova Lind', 'woman');
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman');
  const rafi = await apiMember('rafi', 'Rafi Haddad', 'man');
  await ivy.call('PUT', '/me/interests', { interests: ['food', 'music'] });

  const listening = await nova.call('POST', '/events', {
    title: 'Listening to Naina Morey', description: 'Her new record, start to finish, on the good speakers. Dal and rice after.',
    startsAt: inDays(2, 19), endsAt: inDays(2, 22), location: 'The roof at Kiran’s', capacity: 12, interests: ['food', 'music'],
    priceNote: 'Bring a dish if you can',
  });
  const darkroom = await nova.call('POST', '/events', {
    title: 'Darkroom evening', description: 'Develop a roll of black-and-white film together. Chemicals and tanks provided.',
    startsAt: inDays(5, 18), location: 'Studio B, the old print works', capacity: 8, interests: ['photography'],
  });
  await ivy.call('POST', `/events/${listening.id}/rsvp`);
  await rafi.call('POST', `/events/${listening.id}/rsvp`);
  await nova.call('DELETE', `/events/${darkroom.id}`);

  const url = (id: string) => `${WEB}/collab/event/${id}`;
  const top = async (page: Page, name: string) => {
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await shot(page, name);
  };

  // 01: a guest who is going, desktop (the scene the owner sent)
  const ivyPage = await browse(await browser.newContext(wide), ivy.jar);
  await ivyPage.goto(url(listening.id));
  await top(ivyPage, 'going-desktop');

  // 02: the host, the whole page
  const novaPage = await browse(await browser.newContext(wide), nova.jar);
  await novaPage.goto(url(listening.id));
  await novaPage.getByRole('heading', { level: 1 }).first().waitFor();
  await shot(novaPage, 'host-full', true);

  // 03: phone
  const ivyPhone = await browse(await browser.newContext(phone), ivy.jar);
  await ivyPhone.goto(url(listening.id));
  await top(ivyPhone, 'going-phone');

  // 04: cancelled
  await novaPage.goto(url(darkroom.id));
  await top(novaPage, 'cancelled');

  // 05: dark, by choice (RFC §10.14)
  await ivy.call('PATCH', '/me', { theme: 'dark' });
  const darkPage = await browse(await browser.newContext(wide), ivy.jar, [{ name: 'anti_theme', value: 'dark' }]);
  await darkPage.goto(url(listening.id));
  await top(darkPage, 'going-dark');

  // 06: the ticket up close (after only: the notches, the stamp, the barcode)
  if (!BEFORE) {
    const close = await browse(await browser.newContext({ ...wide, deviceScaleFactor: 2 }), nova.jar);
    await close.goto(url(listening.id));
    await close.locator('.ticket').waitFor();
    await close.waitForTimeout(400);
    await close.locator('.ticket').screenshot({ path: file('ticket-close') });
    console.log('saved ticket-close');
  }

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
