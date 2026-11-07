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
/** LIVE=1: capture the already-running app (e.g. WEB_URL=http://localhost:3000); no test API. */
const LIVE = process.env.LIVE === '1';
const OUT = join(import.meta.dir, '..', '.screenshots', LIVE ? 'entrance-live' : 'entrance');
mkdirSync(OUT, { recursive: true });
const FRAMES = [0, 100, 250, 400, 550, 800, 1100, 1400, 2000];

const server = LIVE ? null : createApp({
  db: (await createTestDb()).db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
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

  // one contact sheet: every frame side by side with its timestamp
  const { readFileSync } = await import('node:fs');
  const cells = FRAMES.map((ms) => {
    const b64 = readFileSync(join(OUT, `t-${String(ms).padStart(4, '0')}.png`)).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${(ms / 1000).toFixed(2)}s</figcaption></figure>`;
  }).join('');
  const sheet = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage();
  await sheet.setContent(`<style>
    body{margin:0;background:#fff;font:700 20px monospace;padding:24px}
    h1{font:900 34px Impact,sans-serif;margin:0 0 16px;text-transform:uppercase}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
    figure{margin:0;border:2px solid #000;box-shadow:5px 5px 0 #000}
    img{display:block;width:100%;height:520px;object-fit:cover;object-position:top}
    figcaption{border-top:2px solid #000;padding:6px 10px}
  </style><h1>anti — entrance, frame by frame</h1><div class="grid">${cells}</div>`);
  await sheet.screenshot({ path: join(OUT, 'filmstrip.png'), fullPage: true });
  console.log('saved', join(OUT, 'filmstrip.png'));
} finally {
  await browser.close();
  server?.stop();
}
