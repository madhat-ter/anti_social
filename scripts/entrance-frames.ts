/**
 * Filmstrip of the landing entrance. Pauses every CSS animation and scrubs them to exact
 * times, so each frame is precise. Needs the screenshot web server:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/entrance-frames.ts
 * Output: .screenshots/entrance/t-NNNN.png
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { createApp } from '../apps/api/src/app';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'entrance');
mkdirSync(OUT, { recursive: true });
const FRAMES = [100, 350, 500, 900, 1300, 2000];

const t = await createTestDb();
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 1500 }, colorScheme: 'light' })).newPage();
  await page.goto(WEB);
  await page.locator('.hero.boot').waitFor();
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const count = await page.evaluate(() => document.getAnimations().length);
  console.log('animations on page:', count);
  for (const ms of FRAMES) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), ms);
    await page.waitForTimeout(80);
    const file = join(OUT, `t-${String(ms).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
  }

  // reduced motion: no animations, everything drawn immediately
  const calm = await (await browser.newContext({ viewport: { width: 1100, height: 1500 }, reducedMotion: 'reduce' })).newPage();
  await calm.goto(WEB);
  await calm.locator('.hero.boot').waitFor();
  console.log('reduced-motion animations:', await calm.evaluate(() => document.getAnimations().length));
  await calm.screenshot({ path: join(OUT, 'reduced-motion.png') });
} finally {
  await browser.close();
  server.stop();
}
