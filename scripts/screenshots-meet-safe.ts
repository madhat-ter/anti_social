/**
 * RFC §10.28: a member aged 13–17 sees one safety line on in-person pages (an event or meetup, an
 * activity). Adults see the pages as before. Before/after pairs of the same scenes:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-meet-safe.ts
 *   bun scripts/screenshots-meet-safe.ts
 * Output: .screenshots/meet-safe-before/ and .screenshots/meet-safe-after/
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'meet-safe-before' : 'meet-safe-after');
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
/** a birthday that makes someone `age` today */
const bornYearsAgo = (age: number) => `${new Date().getFullYear() - age - 1}-01-15`;

async function apiMember(handle: string, displayName: string, gender: string, birthday: string) {
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
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday, phone: '+977 980 000 0000', email: 'member@example.com' });
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
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
  const nova = await apiMember('nova', 'Nova Lind', 'woman', '1995-02-11');
  const tara = await apiMember('tara', 'Tara Gurung', 'woman', bornYearsAgo(16));

  const picnic = await nova.call('POST', '/events', {
    title: 'Picnic by the lake', description: 'Bring something to share. We sit by the boats and stay until it gets dark.',
    startsAt: inDays(3, 11), endsAt: inDays(3, 14), location: 'The lake, north side', capacity: 12, interests: ['food'],
  });
  const run = await nova.call('POST', '/collabs', {
    kind: 'activity', title: 'Sunday run club', meets: 'Sundays 7am, by the lake', interests: ['music'], teamMax: null, joinMode: 'open',
  });

  const top = async (page: Page, name: string) => {
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await shot(page, name);
  };

  // 01–02: a 16-year-old on an event, desktop and phone
  const taraPage = await browse(await browser.newContext(wide), tara.jar);
  await taraPage.goto(`${WEB}/collab/event/${picnic.id}`);
  await top(taraPage, 'teen-event-desktop');
  const taraPhone = await browse(await browser.newContext(phone), tara.jar);
  await taraPhone.goto(`${WEB}/collab/event/${picnic.id}`);
  await top(taraPhone, 'teen-event-phone');

  // 03: the same 16-year-old on an activity
  await taraPhone.goto(`${WEB}/collab/${run.id}`);
  await top(taraPhone, 'teen-activity-phone');

  // 04: an adult on the same event sees no line
  const novaPage = await browse(await browser.newContext(phone), nova.jar);
  await novaPage.goto(`${WEB}/collab/event/${picnic.id}`);
  await top(novaPage, 'adult-event-phone');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
