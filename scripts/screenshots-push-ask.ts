/**
 * RFC Â§10.31: the feed's ask to turn notifications on. "Before" is .screenshots/latest/13-feed-phone.png.
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-push-ask.ts
 * Output: .screenshots/push-ask/
 */
import { chromium, type BrowserContextOptions, type Page } from 'playwright-core';
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'push-ask');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

const ABOUT = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const errors: string[] = [];

async function member(handle: string, displayName: string) {
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
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call('PUT', '/me/setup', { about: ABOUT, gender: 'woman', birthday: '1998-04-02', phone: '+977 980 000 0000', email: 'member@example.com' });
  return { call, jar };
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const nova = await member('nova', 'Nova Lind');
  await nova.call('POST', '/posts', { body: 'First light over the river this morning. Anyone else up this early?' });

  /** `seenBefore`: this device first saw anti on an earlier day (the card's "second visit") */
  async function scene(name: string, opts: BrowserContextOptions, seenBefore: boolean) {
    const ctx = await browser.newContext(opts);
    await ctx.addCookies([...nova.jar].map(([n, v]) => ({ name: n, value: v, domain: 'localhost', path: '/' })));
    await ctx.addInitScript((seen) => {
      localStorage.setItem('anti:welcomed:nova', '1');
      if (seen) localStorage.setItem('anti_push_ask', JSON.stringify({ first: '2026-01-01', notNow: 0, next: 0 }));
    }, seenBefore);
    const page: Page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(WEB);
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log('saved', name, '| card shown:', await page.locator('.push-ask').count());
    return { ctx, page };
  }

  await scene('01-desktop', { viewport: { width: 1280, height: 900 } }, true);
  const phone = await scene('02-phone', { viewport: { width: 390, height: 844 }, isMobile: true }, true);
  await scene('03-iphone-safari', { viewport: { width: 390, height: 844 }, isMobile: true, userAgent: IPHONE_UA }, true);
  await scene('04-first-day-no-card', { viewport: { width: 390, height: 844 }, isMobile: true }, false);

  // "Not now" hides it and snoozes for 2 weeks
  await phone.page.getByRole('button', { name: 'Not now' }).click();
  await phone.page.waitForTimeout(300);
  const memory = await phone.page.evaluate(() => localStorage.getItem('anti_push_ask'));
  console.log('after Not now: card shown', await phone.page.locator('.push-ask').count(), '| memory', memory);

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
