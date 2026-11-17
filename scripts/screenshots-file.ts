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
  await lap.page.locator('#file-sheet .file-card').waitFor();
  must(await lap.page.locator('.file-tab').count() === 12, 'not 12 tabs');
  must(await lap.page.locator('.file-tab.on').innerText() === 'ME', 'the "Me" page is not open by default');
  must(await lap.page.locator('.file-tab:disabled').count() === 8, `empty tabs should be closed to others: ${await lap.page.locator('.file-tab:disabled').count()}`);
  must(await lap.page.getByRole('button', { name: '+ Make a card', exact: true }).count() === 0, 'someone else can make their own card here');
  await shot(lap.page, 'drawer-desktop');

  await lap.page.getByRole('tab', { name: 'Coffee' }).click();
  must((await lap.page.locator('#file-sheet .file-card-h').innerText()).toLowerCase().includes('where i work'), 'the Coffee page did not open');
  await shot(lap.page, 'another-page');
  await lap.page.getByRole('tab', { name: 'ME', exact: true }).click();

  // the card, full screen
  await lap.page.locator('#file-sheet .file-card').click();
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
  await phone.page.locator('#file-sheet .file-card').waitFor();
  await shot(phone.page, 'drawer-phone', true);
  await phone.page.locator('#file-sheet .file-card').click();
  await phone.page.locator('.file-full[open] .file-car').waitFor();
  await shot(phone.page, 'card-full-phone');
  await phone.page.locator('.file-car-item').first().click();
  await phone.page.locator('.file-pola').waitFor();
  await shot(phone.page, 'polaroid-phone');
  await phone.ctx.close();

  // ── Maya, the owner: tools, an empty page, making a card
  const own = await open(maya, DESKTOP);
  await own.page.goto(`${WEB}/file`);
  await own.page.locator('#file-sheet .file-card').waitFor();
  must(await own.page.locator('.file-tab:disabled').count() === 0, 'the owner cannot open every page');
  await shot(own.page, 'owner-me-page', true);

  // the flip, frame by frame (animations run even with reduced motion, just quicker)
  const FLIP = join(OUT, 'flip');
  mkdirSync(FLIP, { recursive: true });
  const frames = async (name: string, tabName: string) => {
    const drawer = own.page.locator('.file');
    await own.page.getByRole('tab', { name: tabName, exact: true }).click();
    must(await own.page.locator('.file-leaf-out').count() === 1, `no leaving page drawn for the ${name} flip`);
    // freeze the flip at exact moments (Web Animations API), so the frames show the motion
    for (const [k, at] of [0, 60, 120, 180, 240, 300, 360].entries()) {
      await own.page.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, at);
      await drawer.screenshot({ path: join(FLIP, `${name}-${k}.png`), animations: 'allow' });
    }
    await own.page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
    await own.page.waitForTimeout(600);
    must(await own.page.locator('.file-leaf-out').count() === 0, `the leaving page stayed after the ${name} flip`);
    await drawer.screenshot({ path: join(FLIP, `${name}-end.png`) });
    console.log('saved flip', name);
  };
  await frames('to-the-back', 'Zines');          // "Me" → a page behind it: "Me" tips forward and falls away
  await frames('to-the-front', 'Page 8 (empty)'); // Zines → a front page: it swings up toward you
  await frames('back-again', 'ME');
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

  // ── step 2: Theo makes a card for Maya, from her File
  const giver = await open(theo, DESKTOP);
  await giver.page.goto(`${WEB}/file/maya`);
  await giver.page.getByRole('button', { name: '+ Make a card for Maya' }).click();
  await giver.page.getByLabel(/^Headline/).fill('Maya taught me to fold a zine');
  await giver.page.getByLabel(/^Description/).fill('One Saturday at the market she showed me the eight-page fold with a single cut. I have made forty since. This is the first one, and her hands doing it.');
  await giver.page.locator('input[type=file]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(await picture(71)) },
    { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(await picture(72)) },
  ]);
  await giver.page.waitForFunction(() => document.querySelectorAll('.pj-att.done').length === 2);
  await giver.page.getByLabel('Caption for photo 1 (optional)').fill('The first fold');
  await shot(giver.page, 'make-a-card-for-someone', true);
  await giver.page.getByRole('button', { name: 'Send to @maya' }).click();
  await giver.page.locator('.file').waitFor();
  must((await call(maya, 'GET', '/me/file/tray')).items.length === 1, 'the card did not reach her tray');
  must((await call(theo, 'GET', '/members/maya/file')).pages.slice(7).every((p: any) => !p.card), 'the card shows before she said yes');
  await giver.ctx.close();
  // a second one, from Inês, made through the API
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const inesCard = await call(ines, 'POST', '/me/file/cards', { headline: 'The stall at the corner', description: 'Maya drew my stall every week for a year.', photos: [{ id: await upload(ines, 81), caption: '' }], forHandle: 'maya' });
  await call(ines, 'POST', `/me/file/cards/${inesCard.id}/send`);

  // Maya finds both in her tray
  const got = await open(maya, DESKTOP);
  await got.page.goto(`${WEB}/notifications`);
  await got.page.getByText('made a card for your File').first().waitFor();
  await shot(got.page, 'notification-card-for-you');
  await got.page.goto(`${WEB}/file`);
  await got.page.getByText('2 cards were made for you.').waitFor();
  await shot(got.page, 'tray');
  const mine = got.page.locator('.file-spare li', { hasText: 'Maya taught me to fold a zine' });
  await mine.getByRole('button', { name: 'Look' }).click();
  await got.page.locator('.file-full[open] .file-car').waitFor();
  await shot(got.page, 'tray-look');
  await got.page.keyboard.press('Escape');
  await mine.getByRole('button', { name: 'Put in my File' }).click();
  await got.page.getByRole('tab', { name: 'theo', exact: true }).waitFor();
  must(await got.page.locator('.file-tab.on').innerText() === 'THEO', 'the gift page did not open with the maker’s name on its tab');
  await shot(got.page, 'gift-card-in-file', true);
  // turn the other one down: it just goes
  await got.page.locator('.file-spare li', { hasText: 'The stall at the corner' }).getByRole('button', { name: 'Turn down' }).click();
  await shot(got.page, 'turn-down-dialog');
  await got.page.getByRole('button', { name: 'Turn it down' }).click();
  await got.page.waitForFunction(() => !document.body.innerText.includes('The stall at the corner'));
  must((await call(ines, 'GET', '/notifications')).items.every((x: any) => !x.kind.startsWith('file_')), 'the maker was told about a turned-down card');
  await got.ctx.close();

  // Theo hears the good news, and sees it in "cards you made for others"
  const told = await open(theo, PHONE);
  await told.page.goto(`${WEB}/notifications`);
  await told.page.getByText('put your card "Maya taught me to fold a zine" in their File').waitFor();
  await shot(told.page, 'notification-card-placed');
  await told.page.goto(`${WEB}/file`);
  await told.page.getByText('In @maya’s File').waitFor();
  await shot(told.page, 'cards-you-made-for-others', true);
  await told.page.goto(`${WEB}/file/maya`);
  await told.page.getByRole('tab', { name: 'theo', exact: true }).click();
  await told.page.getByText('Made by @theo').first().waitFor();
  await shot(told.page, 'gift-page-phone', true);
  await told.ctx.close();

  // ── step 3: the button beside the bell, the menu entry, the profile link, the share link
  const nav = await open(maya, PHONE);
  await nav.page.goto(WEB);
  await nav.page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  const topFile = nav.page.locator('.top .top-file');
  await topFile.waitFor();
  must(await nav.page.locator('.top .top-bell').count() === 2, 'the header should hold the File button and the bell');
  await shot(nav.page, 'header-file-button-phone');
  await topFile.click();
  await nav.page.locator('.file').waitFor();
  must(new URL(nav.page.url()).pathname === '/file', 'the header button does not open your File');
  await shot(nav.page, 'header-file-button-on');
  await nav.page.goto(`${WEB}/u/theo`);
  await nav.page.getByRole('link', { name: 'Open Theo’s File' }).waitFor();
  await nav.page.getByRole('link', { name: 'Open Theo’s File' }).scrollIntoViewIfNeeded();
  await shot(nav.page, 'profile-open-file');
  await nav.ctx.close();

  const desk = await open(maya, DESKTOP);
  await desk.page.goto(WEB);
  await desk.page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  await desk.page.locator('nav.nav').getByRole('link', { name: 'File', exact: true }).waitFor();
  must(await desk.page.locator('.top .top-file:visible').count() === 0, 'the header button shows on a wide screen');
  await shot(desk.page, 'menu-file-desktop');

  // the share link: off by default, nothing outside
  const outside = await browser.newContext(DESKTOP);
  const pub = await outside.newPage();
  pub.on('pageerror', (e) => errors.push(e.message));
  await pub.goto(`${WEB}/f/maya`);
  await pub.getByText('This File is not shared').waitFor();
  await shot(pub, 'public-not-shared');
  // Maya switches it on from her File: one tap on Share
  await desk.page.goto(`${WEB}/file`);
  await desk.page.getByRole('button', { name: 'Share', exact: true }).click();
  await desk.page.getByLabel('Your File’s link').waitFor();
  must((await desk.page.getByLabel('Your File’s link').inputValue()).endsWith('/f/maya'), 'the link is not /f/maya');
  await shot(desk.page, 'file-share-strip');
  await desk.ctx.close();
  // now anyone with the link sees it: her own cards, and Theo's only because he did not allow it → empty
  await pub.goto(`${WEB}/f/maya`);
  await pub.locator('#file-sheet .file-card').waitFor();
  must(await pub.locator('nav.nav, .tabbar, .top-bell').count() === 0, 'the public page shows the site’s menu');
  must(await pub.getByRole('button', { name: '+ Make a card for Maya' }).count() === 1, 'the public page does not offer to make a card for her');
  must(await pub.getByRole('tab', { name: 'theo', exact: true }).count() === 0, 'a gift card shows publicly without its maker’s yes');
  await shot(pub, 'public-file-desktop', true);
  // Theo allows his card outside: now it is there
  const theirs = (await call(theo, 'GET', '/me/file/made')).items[0];
  await call(theo, 'PATCH', `/me/file/cards/${theirs.id}`, { publicOk: true });
  await call(maya, 'PUT', '/me/file/pages/7', { cardId: theirs.id }); // an edit needs her yes again
  await pub.reload();
  await pub.getByRole('tab', { name: 'theo', exact: true }).click();
  await pub.getByText('Made by @theo').first().waitFor();
  await shot(pub, 'public-gift-card');
  await pub.locator('#file-sheet .file-card').click();
  await pub.locator('.file-full[open] .file-car-item').first().click();
  await pub.locator('.file-pola').waitFor();
  must(await pub.locator('.file-pola img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), 'a public photo did not load');
  await shot(pub, 'public-polaroid');
  // what a pasted link shows, and what search engines are told
  const html = await (await fetch(`${WEB}/f/maya`)).text();
  must(/<meta name="robots" content="noindex/.test(html), 'the public page does not say noindex');
  must(/property="og:image" content="http:\/\/localhost:3100\/api\/public\/file\/maya\/media\//.test(html), 'no preview image for a pasted link');
  must(html.includes('Maya’s File · anti'), 'no preview title');
  await outside.close();
  const outPhone = await browser.newContext(PHONE);
  const pp = await outPhone.newPage();
  await pp.goto(`${WEB}/f/maya`);
  await pp.locator('#file-sheet .file-card').waitFor();
  await shot(pp, 'public-file-phone', true);
  await outPhone.close();

  // ── step 4: reporting a card, and the admin's side
  const rep = await open(theo, DESKTOP);
  await rep.page.goto(`${WEB}/file/maya`);
  await rep.page.getByRole('tab', { name: 'Coffee' }).click();
  await rep.page.locator('#file-sheet .file-card').click();
  await rep.page.locator('.file-full[open]').getByRole('button', { name: 'Report' }).click();
  await rep.page.getByPlaceholder('Why (optional)').fill('Not hers to post');
  await shot(rep.page, 'report-card');
  await rep.page.getByRole('button', { name: 'Report', exact: true }).click();
  await rep.page.getByText('Reported. An admin will look at it.').waitFor();
  await rep.ctx.close();

  const boss = await member('boss', 'Boss Admin', 'man');
  await t.client.query(`update users set role = 'ops', activated_at = now() - interval '60 days', checklist_dismissed_at = now() where handle = 'boss'`);
  const adm = await open(boss, DESKTOP);
  await adm.page.goto(`${WEB}/admin#reports`);
  const row = adm.page.locator('.adm-reports li', { hasText: 'File card' });
  await row.waitFor();
  must((await row.innerText()).includes('Not hers to post'), 'the reason is not in the admin queue');
  await row.scrollIntoViewIfNeeded();
  await shot(adm.page, 'admin-reported-card');
  // the admin opens the File and removes the card there
  await adm.page.goto(`${WEB}/file/maya`);
  await adm.page.getByRole('tab', { name: 'Coffee' }).click();
  await adm.page.locator('#file-sheet .file-card').click();
  await adm.page.locator('.file-full[open]').getByRole('button', { name: 'Remove (admin)' }).click();
  await shot(adm.page, 'admin-remove-card');
  await adm.page.getByRole('button', { name: 'Remove', exact: true }).click();
  await adm.page.getByText('Removed.').waitFor();
  must(!(await call(theo, 'GET', '/members/maya/file')).pages[2].card, 'the removed card is still on its page');
  must((await call(maya, 'GET', '/notifications')).items.some((x: any) => x.kind === 'file_card_removed'), 'the maker was not told');
  await adm.ctx.close();

  // ── dark mode follows the member's choice
  await call(theo, 'PATCH', '/me', { theme: 'dark' });
  const dark = await open(theo, PHONE);
  await dark.page.goto(`${WEB}/file/maya`);
  await dark.page.locator('#file-sheet .file-card').waitFor();
  await shot(dark.page, 'drawer-dark', true);
  await dark.ctx.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
