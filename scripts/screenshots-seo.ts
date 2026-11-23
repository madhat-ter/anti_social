/**
 * RFC §10.29: the landing page as search engines and visitors get it, plus the share picture.
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-seo.ts
 * Output: .screenshots/seo-after/ (the "before" landing is .screenshots/seo-before/01-landing.png)
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { createApp } from '../apps/api/src/app';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'seo-after');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

const errors: string[] = [];
async function shot(page: Page, name: string, fullPage: boolean) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500); // the seats and lines fade in
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log('saved', name);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, opts, full] of [
    ['01-landing', { viewport: { width: 1280, height: 900 } }, false],
    ['02-landing-full', { viewport: { width: 1280, height: 900 } }, true],
    ['03-landing-phone-full', { viewport: { width: 390, height: 844 }, isMobile: true }, true],
    ['04-no-scripts', { viewport: { width: 1280, height: 900 }, javaScriptEnabled: false }, true],
  ] as const) {
    const page = await (await browser.newContext(opts)).newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(WEB);
    await shot(page, name, full);
  }
  const og = await fetch(`${WEB}/opengraph-image`);
  writeFileSync(join(OUT, '05-share-picture.png'), Buffer.from(await og.arrayBuffer()));
  console.log('saved 05-share-picture');
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
