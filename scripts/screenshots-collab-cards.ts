/**
 * The Collab list's cards: an event without a cover shows its date (month, big day), an activity
 * or project without a cover shows its first letter. Same stack as the other screenshot scripts:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-collab-cards.ts   # or without SHOTS for "after"
 * Output: .screenshots/collab-cards-before/ and .screenshots/collab-cards-after/
 */
import { chromium } from 'playwright-core';
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'collab-cards-before' : 'collab-cards-after');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

const jar = new Map<string, string>();
async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: WEB };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  for (const sc of r.headers.getSetCookie()) {
    const [k, ...v] = sc.split(';')[0]!.split('=');
    if (v.join('=')) jar.set(k!.trim(), v.join('='));
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const inDays = (days: number, hour: number) => { const d = new Date(Date.now() + days * 86_400_000); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
try {
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle: 'sneho', displayName: 'Sneho', pin: '739206' });
  await call('PUT', '/me/setup', { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'woman', birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  await call('POST', '/events', { title: 'Listening to Naina Morey', startsAt: inDays(2, 15), endsAt: inDays(2, 16), location: 'The roof', capacity: 4, interests: ['food', 'music'] });
  await call('POST', '/events', { title: 'Darkroom evening', startsAt: inDays(12, 18), location: 'Studio B', interests: ['photography'] });
  await call('POST', '/collabs', { kind: 'activity', title: 'Sunday run club', meets: 'Sundays 7am, by the lake', interests: ['music'], teamMax: null, joinMode: 'open' });
  await call('POST', '/collabs', { kind: 'project', title: 'A zine about the market', interests: ['photography'], roles: ['Writer'], teamMax: 5, joinMode: 'approve' });

  for (const [name, opts] of [
    ['list-desktop', { viewport: { width: 1280, height: 900 } }],
    ['list-phone', { viewport: { width: 390, height: 844 }, isMobile: true }],
  ] as const) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([...jar].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${WEB}/collab`);
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
    await page.getByText('A zine about the market').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    console.log('saved', name);
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
