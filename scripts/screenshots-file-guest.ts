/**
 * RFC §10.24, cards from outside anti: anyone with a member's share link can make them a card
 * (a typed name, up to five photos). It waits in the member's private tray; placed, it shows in
 * the File and on the share page, marked "not a member". Also: the File switch left Settings.
 *
 *   $env:SHOTS='before'; bun scripts/screenshots-file-guest.ts   → .screenshots/file-guest-before/
 *   bun scripts/screenshots-file-guest.ts                        → .screenshots/file-guest/
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). "before" only takes
 * the scenes the old build has (the share page, Settings); without it the script sends a card
 * through the form and follows it to the tray, the File and back out to the share page.
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
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'file-guest-before' : 'file-guest');
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
/** a drawn stand-in for a photo: a sky, a sun and hills, different for each seed */
async function picture(seed: number): Promise<Buffer> {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 82%)"/>
    <circle cx="${900 * (0.25 + (seed % 5) * 0.12)}" cy="270" r="117" fill="hsl(${(hue + 40) % 360} 85% 60%)"/>
    <path d="M0 648 Q 225 ${900 * (0.45 + (seed % 3) * 0.06)} 450 612 T 900 540 V 900 H 0 Z" fill="hsl(${(hue + 150) % 360} 35% 38%)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function upload(jar: Jar, seed: number): Promise<string> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(await picture(seed)) as BlobPart], 'photo.png', { type: 'image/png' }));
  return (await call(jar, 'POST', '/uploads', form)).id;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
async function open(viewer: Jar | null, opts: Parameters<typeof browser.newContext>[0]) {
  const ctx = await browser.newContext(opts);
  if (viewer) await ctx.addCookies([...viewer].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
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
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);
  await call(maya, 'POST', '/me/file/cards', {
    headline: 'Maya Lind, print room',
    description: 'I draw for small presses and print zines on an old risograph.\n\nAsk me about paper.',
    photos: [{ id: await upload(maya, 1), caption: 'The print room, 7am' }, { id: await upload(maya, 2), caption: '' }], page: 0,
  });
  await call(maya, 'PUT', '/me/file/pages/1', { label: 'Zines' });
  await call(maya, 'POST', '/me/file/cards', { headline: 'Six issues so far', description: 'Everything I printed this year.', photos: [{ id: await upload(maya, 21), caption: '' }], page: 1 });
  await call(maya, 'PATCH', '/me', { filePublic: true });

  // ── someone outside opens the link on a computer, and on a phone
  const out = await open(null, DESKTOP);
  await out.page.goto(`${WEB}/f/maya`);
  await out.page.locator('#file-sheet .file-card').waitFor();
  await shot(out.page, 'share-page-desktop');
  const outPhone = await open(null, PHONE);
  await outPhone.page.goto(`${WEB}/f/maya`);
  await outPhone.page.locator('#file-sheet .file-card').waitFor();
  await shot(outPhone.page, 'share-page-phone');

  // ── Maya's Settings (the File switch used to live here)
  const own = await open(maya, DESKTOP);
  await own.page.goto(`${WEB}/settings`);
  await own.page.getByRole('heading', { name: 'Settings' }).first().waitFor();
  await shot(own.page, 'settings', true);

  if (!BEFORE) {
    must(await own.page.getByText('Share my File with a link').count() === 0, 'Settings still has the File switch');

    // one screen: name, headline, photos, description, Send
    await out.page.getByRole('button', { name: '+ Make a card for Maya' }).click();
    await out.page.getByRole('heading', { name: 'A card for Maya' }).waitFor();
    must(await out.page.getByRole('button', { name: 'Send to Maya' }).isDisabled(), 'an empty card can be sent');
    await shot(out.page, 'form-empty', true);
    await out.page.getByLabel('Your name').fill('Riya Sen');
    await out.page.getByLabel('Headline').fill('The desk next to Maya’s');
    await out.page.getByLabel('Description').fill('We shared a studio for two years. She fixed my riso more times than I can count, and never once let me pay for the coffee.');
    await out.page.locator('input[type=file]').setInputFiles([
      { name: 'desk.png', mimeType: 'image/png', buffer: await picture(7) },
      { name: 'riso.png', mimeType: 'image/png', buffer: await picture(12) },
    ]);
    await out.page.getByLabel('Caption for photo 1').fill('Our corner of the studio');
    must(await out.page.locator('.pj-att').count() === 2, 'the two photos are not listed');
    await shot(out.page, 'form-filled', true);
    await out.page.getByRole('button', { name: 'Send to Maya' }).click();
    await out.page.getByText('Sent. Maya will see it.').waitFor();
    // sent, and still nowhere to be seen outside
    must(await out.page.getByRole('tab', { name: 'Riya Sen' }).count() === 0, 'the card shows before her yes');
    await shot(out.page, 'sent');

    // the same form on a phone
    await outPhone.page.getByRole('button', { name: '+ Make a card for Maya' }).click();
    await outPhone.page.getByRole('heading', { name: 'A card for Maya' }).waitFor();
    await outPhone.page.getByLabel('Your name').fill('Sam');
    await shot(outPhone.page, 'form-phone', true);
    await outPhone.ctx.close();

    // ── Maya: the bell, the tray, her yes
    await own.page.goto(`${WEB}/notifications`);
    await own.page.getByText('Riya Sen (not a member) made a card for your File').waitFor();
    await shot(own.page, 'notification');
    await own.page.goto(`${WEB}/file`);
    await own.page.getByText('by Riya Sen (not a member)').waitFor();
    await shot(own.page, 'tray');
    const ownPhone = await open(maya, PHONE);
    await ownPhone.page.goto(`${WEB}/file`);
    await ownPhone.page.getByText('by Riya Sen (not a member)').waitFor();
    await shot(ownPhone.page, 'tray-phone');
    await ownPhone.ctx.close();
    await own.page.getByRole('button', { name: 'Put in my File' }).click();
    await own.page.getByText('Made by Riya Sen (not a member)').first().waitFor();
    must((await own.page.locator('.file-tab.on').innerText()).trim().toUpperCase() === 'RIYA SEN', 'the tab does not carry the typed name');
    await shot(own.page, 'in-her-file', true);

    // ── outside again: now it is on the share page, marked
    await out.page.reload();
    await out.page.getByRole('tab', { name: 'Riya Sen' }).click();
    await out.page.getByText('Made by Riya Sen (not a member)').first().waitFor();
    await shot(out.page, 'on-the-share-page', true);
    await out.page.locator('#file-sheet .file-card').click();
    await out.page.locator('.file-full[open] .file-car').waitFor();
    must(await out.page.locator('.file-full[open] .file-car-item img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), 'the outside card’s photo did not load');
    await shot(out.page, 'card-full');

    // three an hour from one connection: the fourth is told to wait
    for (const who of ['Two', 'Three']) {
      const form = new FormData();
      form.append('name', who); form.append('headline', `Card ${who}`);
      form.append('photos', new File([new Uint8Array(await picture(30)) as BlobPart], 'p.png', { type: 'image/png' }));
      must((await fetch(`${WEB}/api/public/file/maya/cards`, { method: 'POST', body: form })).ok, `card ${who} was refused`);
    }
    await out.page.keyboard.press('Escape');
    await out.page.getByRole('button', { name: '+ Make a card for Maya' }).click();
    await out.page.getByLabel('Your name').fill('Riya Sen');
    await out.page.getByLabel('Headline').fill('One more');
    await out.page.locator('input[type=file]').setInputFiles([{ name: 'x.png', mimeType: 'image/png', buffer: await picture(9) }]);
    await out.page.getByRole('button', { name: 'Send to Maya' }).click();
    await out.page.getByText('Three cards an hour').waitFor();
    await shot(out.page, 'too-many', true);
  }
  await out.ctx.close();
  await own.ctx.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
