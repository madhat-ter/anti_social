/**
 * Quick review of the drawn pet faces without the web build: renders the /dev/pets sheets (and a
 * few large faces) to static HTML and screenshots them, light and dark.
 *
 *   bun scripts/pets-sheet.ts [path/to/PetAvatar.tsx] [outName]   -> .screenshots/pets/<outName>-*.png
 *   ZOOM=1 also saves 30 faces per species at 112px.
 */
import { chromium } from 'playwright-core';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const { createElement: h } = await import('../apps/web/node_modules/react/index.js');
const { renderToStaticMarkup } = await import('../apps/web/node_modules/react-dom/server.js');

const src = resolve(process.argv[2] ?? join(import.meta.dir, '../apps/web/src/components/PetAvatar.tsx'));
const name = process.argv[3] ?? 'after';
const { PetAvatar } = await import(src);
const OUT = join(import.meta.dir, '..', '.screenshots', 'pets');
mkdirSync(OUT, { recursive: true });

const VARIANT = (i: number) => (i * 7919) % 1_000_000;
const face = (species: string, v: number, size: number) =>
  renderToStaticMarkup(h(PetAvatar, { pet: { species, avatar: { variant: v, url: null } }, size }));

const css = (dark: boolean) => `
  :root { --paper: ${dark ? '#0d0d0d' : '#ffffff'}; --ink: ${dark ? '#f4f4f4' : '#000'}; }
  body { margin: 16px; background: var(--paper); color: var(--ink); font: 14px system-ui; }
  .sheet { display: flex; flex-wrap: wrap; gap: 6px; width: 1240px; }
  .pet-face { display: block; background: var(--paper); color: var(--ink); }
  .card { display: inline-flex; border: 2px solid var(--ink); }
  .row { display: flex; gap: 12px; align-items: center; margin: 10px 0; }`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const snap = async (file: string, body: string, dark = false) => {
  await page.setContent(`<!doctype html><style>${css(dark)}</style><body>${body}</body>`);
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  console.log('saved', file);
};

for (const species of ['dog', 'cat', 'bird']) {
  const grid = Array.from({ length: 120 }, (_, i) => face(species, VARIANT(i), 56)).join('');
  await snap(`${name}-${species}s.png`, `<h2>${species}s, 56px</h2><div class="sheet">${grid}</div>`);
  if (process.env.ZOOM) {
    const big = Array.from({ length: 30 }, (_, i) => face(species, VARIANT(i), 112)).join('');
    await snap(`${name}-${species}s-zoom.png`, `<div class="sheet">${big}</div>`);
  }
}
// small sizes as used in cards (34px / 44px, with the card border), and the big page size
const mix = ['dog', 'cat', 'bird'].flatMap((s) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [s, VARIANT(i * 13 + 5)] as const));
const small = (sz: number) => `<div class="row">${mix.map(([s, v]) => `<span class="card">${face(s, v, sz)}</span>`).join('')}</div>`;
const big = `<div class="row">${mix.filter((_, i) => i % 4 === 0).map(([s, v]) => face(s, v, 112)).join('')}</div>`;
await snap(`${name}-sizes.png`, `<h2>34px</h2>${small(34)}<h2>44px</h2>${small(44)}<h2>112px</h2>${big}`);
await snap(`${name}-sizes-dark.png`, `<h2>34px</h2>${small(34)}<h2>112px</h2>${big}`, true);
await browser.close();
writeFileSync(join(OUT, `${name}-when.txt`), new Date().toISOString());
