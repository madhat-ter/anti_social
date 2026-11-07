/** Renders candidate bitmap UI fonts with the strings that must be legible. Output: .screenshots/fonts.png */
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const FONTS = ['Pixelify Sans', 'DotGothic16', 'VT323', 'Handjet', 'Tiny5', 'Jersey 10', 'Silkscreen', 'Micro 5'];
const SAMPLE = 'Pay stay fee ($5.00) · 0/500 · 1:37 AM · 4d 23h · Notifications 3 · 0123456789 · new_post.txt';

const css = FONTS.map((f) => `family=${f.replace(/ /g, '+')}`).join('&');
const rows = FONTS.map((f) => `<tr><th>${f}</th><td style="font-family:'${f}'">${SAMPLE}</td></tr>`).join('');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  await page.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${css}&display=block">
    <style>body{margin:20px;font:14px sans-serif} th{text-align:left;padding:10px 16px 10px 0;width:130px}
    td{font-size:20px;padding:10px 0;border-bottom:1px solid #ddd}</style><table>${rows}</table>`);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(import.meta.dir, '..', '.screenshots', 'fonts.png'), fullPage: true });
} finally {
  await browser.close();
}
