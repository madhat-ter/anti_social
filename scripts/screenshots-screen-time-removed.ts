/**
 * Screen time removed (owner, 2026-11-11): the Admin page's Community section, where its switch
 * used to sit, and the feed's header, where its timer used to sit. Same stack as the others:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-screen-time-removed.ts   # or without SHOTS for "after"
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'screen-time-removed-before' : 'screen-time-removed-after');
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
try {
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle: 'boss', displayName: 'Boss', pin: '739206' });
  await call('PUT', '/me/setup', { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'woman', birthday: '1990-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  await t.client.query(`update users set role = 'ops' where handle = 'boss'`);
  await call('POST', '/posts', { body: 'A quiet morning at the tea stall.' });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...jar].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/admin#community`);
  const sec = page.locator('#community');
  await sec.getByText('Seats in the room').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await sec.screenshot({ path: join(OUT, 'admin-community.png') });
  console.log('saved admin-community');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await phone.addCookies([...jar].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const p2 = await phone.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(`${WEB}/`);
  await p2.getByText('A quiet morning').first().waitFor({ timeout: 30_000 });
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: join(OUT, 'feed-phone.png') });
  console.log('saved feed-phone');
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
