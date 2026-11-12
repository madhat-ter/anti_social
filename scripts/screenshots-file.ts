/**
 * RFC §10.24, the File (step 1: own cards and the drawer). Maya fills her own pages; Theo looks.
 *
 *   bun scripts/screenshots-file.ts   → .screenshots/file/NN-name.png
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). Checks: 12 tabs,
 * "Me" open by default, empty tabs closed to others, the card opens full screen, the carousel
 * moves, a photo opens as a polaroid with its caption, and the owner can make a card from the page.
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from '../apps/api/node_modules/sharp';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'file');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

type Jar = Map<string, string>;
async function call(jar: Jar, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: WEB };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await server.handle(new Request('http://localhost' + path, {
    method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  }));
  for (const sc of r.headers.getSetCookie()) {
    const [k, ...v] = sc.split(';')[0]!.split('=');
    if (v.join('=')) jar.set(k!.trim(), v.join('='));
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly.';
async function member(handle: string, displayName: string, gender: string): Promise<Jar> {
  const jar: Jar = new Map();
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  await call(jar, 'POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call(jar, 'PUT', '/me/setup', { about: ABOUT, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  return jar;
}

/** a drawn stand-in for a photo: a sky, a sun and hills, different for each seed and shape */
async function picture(seed: number, w = 900, h = 900): Promise<Uint8Array> {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 82%)"/>
    <circle cx="${w * (0.25 + (seed % 5) * 0.12)}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.13}" fill="hsl(${(hue + 40) % 360} 85% 60%)"/>
    <path d="M0 ${h * 0.72} Q ${w * 0.25} ${h * (0.45 + (seed % 3) * 0.06)} ${w * 0.5} ${h * 0.68} T ${w} ${h * 0.6} V ${h} H 0 Z" fill="hsl(${(hue + 150) % 360} 35% 38%)"/>
    <path d="M0 ${h * 0.85} Q ${w * 0.4} ${h * 0.7} ${w} ${h * 0.88} V ${h} H 0 Z" fill="hsl(${(hue + 170) % 360} 40% 24%)"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
async function upload(jar: Jar, seed: number, w?: number, h?: number): Promise<string> {
  const form = new FormData();
  form.append('file', new File([await picture(seed, w, h) as BlobPart], 'photo.png', { type: 'image/png' }));
  return (await call(jar, 'POST', '/uploads', form)).id;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
async function open(viewer: Jar, opts: Parameters<typeof browser.newContext>[0]) {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([...viewer].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const DESKTOP = { viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' as const };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);

  // Maya's File: "Me" with seven photos, three more pages named and filled, one named and empty
  const captions = ['The print room, 7am', 'First proof off the riso', '', 'Market stall, Saturday', 'Ink under the nails', '', 'The whole run, drying'];
  const mePhotos = [];
  for (const [i, caption] of captions.entries()) mePhotos.push({ id: await upload(maya, i + 1, i === 3 ? 1400 : 900, i === 3 ? 800 : i === 4 ? 1300 : 900), caption });
  await call(maya, 'POST', '/me/file/cards', {
    headline: 'Maya Lind, print room',
    description: 'I draw for small presses and print zines on an old risograph.\n\nMost weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. Ask me about paper.',
    photos: mePhotos, page: 0,
  });
  const pages: [number, string, string, string][] = [
    [1, 'Zines', 'Six issues so far', 'Everything I printed this year, in order. Issue four is the one with the fold-out map.'],
    [2, 'Coffee', 'Where I work when the studio is cold', 'Three cafes with big tables and nobody who minds a sketchbook.'],
    [4, 'Vintage', 'Things I found and kept', 'A drawer of type, a brass ruler, and a stapler older than me.'],
  ];
  for (const [pos, label, headline, description] of pages) {
    await call(maya, 'PUT', `/me/file/pages/${pos}`, { label });
    await call(maya, 'POST', '/me/file/cards', { headline, description, photos: [{ id: await upload(maya, pos + 20), caption: '' }, { id: await upload(maya, pos + 30), caption: 'another one' }], page: pos });
  }
  await call(maya, 'PUT', '/me/file/pages/5', { label: 'Music' });
  // one card of hers that is not on a page
  await call(maya, 'POST', '/me/file/cards', { headline: 'Sketches I never finished', description: '', photos: [{ id: await upload(maya, 50), caption: '' }] });

  // ── Theo looks at Maya's File on a laptop
  const lap = await open(theo, DESKTOP);
  await lap.page.goto(`${WEB}/file/maya`);
  await lap.page.locator('.file-card').waitFor();
  must(await lap.page.locator('.file-tab').count() === 12, 'not 12 tabs');
  must(await lap.page.locator('.file-tab.on').innerText() === 'ME', 'the "Me" page is not open by default');
  must(await lap.page.locator('.file-tab:disabled').count() === 8, `empty tabs should be closed to others: ${await lap.page.locator('.file-tab:disabled').count()}`);
  must(await lap.page.getByRole('button', { name: /Make a card/ }).count() === 0, 'someone else can make a card here');
  await shot(lap.page, 'drawer-desktop');

  await lap.page.getByRole('tab', { name: 'Coffee' }).click();
  must((await lap.page.locator('.file-card-h').innerText()).toLowerCase().includes('where i work'), 'the Coffee page did not open');
  await shot(lap.page, 'another-page');
  await lap.page.getByRole('tab', { name: 'ME', exact: true }).click();

  // the card, full screen
  await lap.page.locator('.file-card').click();
  await lap.page.locator('.file-full[open] .file-car').waitFor();
  must((await lap.page.locator('.file-count').innerText()).trim() === '1 / 7', 'the counter does not start at 1 / 7');
  await shot(lap.page, 'card-full-desktop');
  await lap.page.getByRole('button', { name: 'Next photo' }).click();
  await lap.page.getByRole('button', { name: 'Next photo' }).click();
  await lap.page.getByRole('button', { name: 'Next photo' }).click();
  await lap.page.waitForFunction(() => document.querySelector('.file-count')?.textContent?.trim() === '4 / 7');
  await shot(lap.page, 'carousel-fourth-photo');
  // a photo opens whole, as a polaroid with its caption
  await lap.page.locator('.file-car-item').nth(3).click();
  await lap.page.locator('.file-pola').waitFor();
  must((await lap.page.locator('.file-pola figcaption').innerText()).includes('Market stall'), 'the polaroid has no caption');
  await shot(lap.page, 'polaroid');
  await lap.page.keyboard.press('Escape');
  must(await lap.page.locator('.file-pola').count() === 0, 'Esc did not close the polaroid');
  must(await lap.page.locator('.file-full[open]').count() === 1, 'Esc closed the card too');
  await lap.page.keyboard.press('Escape');
  must(await lap.page.locator('.file-full[open]').count() === 0, 'Esc did not close the card');
  await lap.ctx.close();

  // ── Theo on a phone
  const phone = await open(theo, PHONE);
  await phone.page.goto(`${WEB}/file/maya`);
  await phone.page.locator('.file-card').waitFor();
  await shot(phone.page, 'drawer-phone', true);
  await phone.page.locator('.file-card').click();
  await phone.page.locator('.file-full[open] .file-car').waitFor();
  await shot(phone.page, 'card-full-phone');
  await phone.page.locator('.file-car-item').first().click();
  await phone.page.locator('.file-pola').waitFor();
  await shot(phone.page, 'polaroid-phone');
  await phone.ctx.close();

  // ── Maya, the owner: tools, an empty page, making a card
  const own = await open(maya, DESKTOP);
  await own.page.goto(`${WEB}/file`);
  await own.page.locator('.file-card').waitFor();
  must(await own.page.locator('.file-tab:disabled').count() === 0, 'the owner cannot open every page');
  await shot(own.page, 'owner-me-page', true);
  await own.page.getByRole('tab', { name: 'Music (empty)' }).click();
  await own.page.getByText('Put “Sketches I never finished” here').waitFor();
  await shot(own.page, 'owner-empty-page', true);
  await own.page.getByRole('tab', { name: 'Page 8 (empty)' }).click();
  await own.page.getByText('This page is for a card someone else made for you.').waitFor();
  await shot(own.page, 'owner-gift-page');
  // make a card straight onto page 4 (index 3)
  await own.page.getByRole('tab', { name: 'Page 4 (empty)' }).click();
  await own.page.getByRole('button', { name: '+ Make a card for this page' }).click();
  await own.page.getByLabel(/^Headline/).fill('Walks I keep taking');
  await own.page.getByLabel(/^Description/).fill('The river trail, mostly. Slow, with coffee at the end.');
  await own.page.locator('input[type=file]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(await picture(61)) },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(await picture(62)) },
  ]);
  await own.page.getByLabel('Caption for photo 1 (optional)').fill('The bridge at eight');
  await own.page.waitForFunction(() => document.querySelectorAll('.pj-att.done').length === 2);
  await shot(own.page, 'make-a-card', true);
  await own.page.getByRole('button', { name: 'Add to this page' }).click();
  await own.page.locator('.file').waitFor();
  const file = await call(maya, 'GET', '/members/maya/file');
  must(file.pages[3].card?.headline === 'Walks I keep taking', 'the new card is not on page 4');
  // name the page, then move it one place forward
  await own.page.getByRole('tab', { name: 'Page 4' }).click();
  await own.page.getByLabel(/^Tab name/).fill('Walks');
  await own.page.getByRole('button', { name: 'Save name' }).click();
  await own.page.getByRole('tab', { name: 'Walks' }).waitFor();
  await shot(own.page, 'owner-named-page', true);
  await own.ctx.close();

  // ── dark mode follows the member's choice
  await call(theo, 'PATCH', '/me', { theme: 'dark' });
  const dark = await open(theo, PHONE);
  await dark.page.goto(`${WEB}/file/maya`);
  await dark.page.locator('.file-card').waitFor();
  await shot(dark.page, 'drawer-dark', true);
  await dark.ctx.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
