/** Does the landing entrance animation run on the live app? `bun scripts/check-entrance.ts [url]` */
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const page = await (await browser.newContext({ reducedMotion })).newPage();
    await page.goto(url);
    await page.locator('.hero.boot').waitFor({ timeout: 60_000 });
    const n = await page.evaluate(() => document.getAnimations().length);
    console.log(`${reducedMotion}: ${n} animations`);
  }
} finally {
  await browser.close();
}
