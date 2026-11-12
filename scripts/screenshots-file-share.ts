/**
 * RFC §10.24, sharing the File from the File itself: a Share button beside "+ Make a card" switches
 * the link on and hands it over in one tap; while it is on, the link sits under the heading.
 *
 *   $env:SHOTS='before'; bun scripts/screenshots-file-share.ts   → .screenshots/file-share-before/
 *   bun scripts/screenshots-file-share.ts                        → .screenshots/file-share/
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). "before" only takes
 * the same scenes of the old build; without it the script also taps Share and checks what happens.
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'file-share-before' : 'file-share');
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
async function upload(jar: Jar, seed: number): Promise<string> {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 82%)"/>
    <circle cx="${900 * (0.25 + (seed % 5) * 0.12)}" cy="270" r="117" fill="hsl(${(hue + 40) % 360} 85% 60%)"/>
    <path d="M0 648 Q 225 ${900 * (0.45 + (seed % 3) * 0.06)} 450 612 T 900 540 V 900 H 0 Z" fill="hsl(${(hue + 150) % 360} 35% 38%)"/>
  </svg>`;
  const form = new FormData();
  form.append('file', new File([new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()) as BlobPart], 'photo.png', { type: 'image/png' }));
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
const DESKTOP = { viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' as const, permissions: ['clipboard-read', 'clipboard-write'] };
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

  // ── on a computer: her File, link off
  const desk = await open(maya, DESKTOP);
  await desk.page.goto(`${WEB}/file`);
  await desk.page.locator('#file-sheet .file-card').waitFor();
  await shot(desk.page, 'file-link-off-desktop');

  // ── on a phone: the same
  const phone = await open(maya, PHONE);
  // a phone has a share sheet; headless Chrome has none to show, so note what it was handed
  await phone.page.addInitScript(() => {
    (navigator as any).share = async (d: unknown) => { (window as any).__shared = d; };
  });
  await phone.page.goto(`${WEB}/file`);
  await phone.page.locator('#file-sheet .file-card').waitFor();
  await shot(phone.page, 'file-link-off-phone');

  if (!BEFORE) {
    const outside = await open(null, DESKTOP);
    await outside.page.goto(`${WEB}/f/maya`);
    await outside.page.getByText('This File is not shared').waitFor();

    // one tap: the link is on, copied, and shown under the heading
    await desk.page.getByRole('button', { name: 'Share', exact: true }).click();
    await desk.page.getByLabel('Your File’s link').waitFor();
    must((await desk.page.getByLabel('Your File’s link').inputValue()) === `${WEB}/f/maya`, 'the link is not /f/maya');
    await desk.page.getByRole('button', { name: 'Copied' }).waitFor();
    must((await desk.page.evaluate(() => navigator.clipboard.readText())) === `${WEB}/f/maya`, 'the link was not copied');
    must((await call(maya, 'GET', '/me')).filePublic === true, 'the tap did not switch the link on');
    must(await desk.page.getByRole('button', { name: 'Share', exact: true }).count() === 0, 'the Share button stays after sharing');
    await shot(desk.page, 'file-shared-desktop');
    await outside.page.reload();
    await outside.page.locator('#file-sheet .file-card').waitFor();
    await shot(outside.page, 'what-the-link-shows');

    // it is still there on the next visit, and one tap stops it
    await desk.page.reload();
    await desk.page.getByLabel('Your File’s link').waitFor();
    await desk.page.getByRole('button', { name: 'Stop sharing' }).click();
    await desk.page.getByRole('button', { name: 'Share', exact: true }).waitFor();
    must((await call(maya, 'GET', '/me')).filePublic === false, 'Stop sharing did not switch the link off');
    await outside.page.reload();
    await outside.page.getByText('This File is not shared').waitFor();
    await outside.ctx.close();

    // on the phone the same tap opens the share sheet with the link
    await phone.page.reload();
    await phone.page.locator('#file-sheet .file-card').waitFor();
    await phone.page.getByRole('button', { name: 'Share', exact: true }).click();
    await phone.page.getByLabel('Your File’s link').waitFor();
    await phone.page.waitForFunction(() => (window as any).__shared?.url?.endsWith('/f/maya'));
    must(await phone.page.locator('.file-share').getByRole('button', { name: 'Share', exact: true }).count() === 1, 'the phone strip has no Share button');
    await shot(phone.page, 'file-shared-phone');

    // dark mode: the strip follows the member's choice
    await call(maya, 'PATCH', '/me', { theme: 'dark' });
    await phone.page.reload();
    await phone.page.getByLabel('Your File’s link').waitFor();
    await shot(phone.page, 'file-shared-dark');
  }
  await desk.ctx.close();
  await phone.ctx.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
