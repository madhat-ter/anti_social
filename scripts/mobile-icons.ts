/**
 * The phone app's icons (RFC §10.32), drawn from the website's own icon (apps/web/app/icon.svg):
 * a condensed black A on white with the red dot. Rendered with Playwright's Chromium so no image
 * tool is needed. Run once after changing the drawing:
 *
 *   bun scripts/mobile-icons.ts
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const out = join(import.meta.dir, '..', 'apps/mobile/assets/images');
const A = 'M15 52 L26 12 H38 L49 52 H39.5 L37.4 43 H26.6 L24.5 52 Z M28.4 35.5 H35.6 L32 19.5 Z';
const glyph = (ink: string, dot: string) => `<path d="${A}" fill="${ink}"/><circle cx="51" cy="47" r="6" fill="${dot}"/>`;

/** the drawing sits in the middle `share` of the square (Android keeps only the centre of adaptive icons) */
function svg(size: number, body: string, bg: string | null, share = 1) {
  const s = (64 / share).toFixed(3);
  const off = ((64 / share - 64) / 2).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-${off} -${off} ${s} ${s}">
    ${bg ? `<rect x="-${off}" y="-${off}" width="${s}" height="${s}" fill="${bg}"/>` : ''}${body}</svg>`;
}

const files: [string, string][] = [
  // iOS rounds the corners itself: full-bleed white
  ['icon.png', svg(1024, glyph('#000', '#e8412c'), '#ffffff', 0.78)],
  ['android-icon-foreground.png', svg(1024, glyph('#000', '#e8412c'), null, 0.5)],
  ['android-icon-background.png', svg(1024, '', '#ffffff')],
  ['android-icon-monochrome.png', svg(1024, glyph('#000', '#000'), null, 0.5)],
  ['splash-icon.png', svg(512, glyph('#000', '#e8412c'), null, 0.9)],
  ['favicon.png', svg(48, `<rect x="2" y="2" width="60" height="60" rx="10" fill="#fff" stroke="#000" stroke-width="4"/>${glyph('#000', '#e8412c')}`, null)],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const [name, markup] of files) {
  const size = Number(markup.match(/width="(\d+)"/)![1]);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.locator('svg').screenshot({ path: join(out, name), omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
