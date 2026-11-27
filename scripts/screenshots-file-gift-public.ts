/**
 * RFC §10.24: every gift card a member placed shows on their share link (asked for 2026-11-27).
 * Theo makes Maya a card without ticking anything, Maya places it and shares her File, and
 * someone with no account opens /f/maya.
 *
 *   SHOTS=before bun scripts/screenshots-file-gift-public.ts → .screenshots/file-gift-public-before/
 *   bun scripts/screenshots-file-gift-public.ts              → .screenshots/file-gift-public-after/
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots").
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
const OUT = join(import.meta.dir, '..', '.screenshots', `file-gift-public-${process.env.SHOTS === 'before' ? 'before' : 'after'}`);
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
async function picture(seed: number): Promise<Uint8Array> {
  const hue = (seed * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 82%)"/>
    <circle cx="${250 + (seed % 5) * 100}" cy="270" r="120" fill="hsl(${(hue + 40) % 360} 85% 60%)"/>
    <path d="M0 650 Q 225 ${420 + (seed % 3) * 50} 450 610 T 900 540 V 900 H 0 Z" fill="hsl(${(hue + 150) % 360} 35% 38%)"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}
async function upload(jar: Jar, seed: number): Promise<string> {
  const form = new FormData();
  form.append('file', new File([await picture(seed) as BlobPart], 'photo.png', { type: 'image/png' }));
  return (await call(jar, 'POST', '/uploads', form)).id;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const DESKTOP = { viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' as const };
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log('saved', name);
};

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);
  await call(maya, 'POST', '/me/file/cards', {
    headline: 'Maya Lind, print room', description: 'I print zines on an old risograph.',
    photos: [{ id: await upload(maya, 1), caption: '' }], page: 0,
  });

  // Theo opens the form to make Maya a card (the part under the photos is what changed)
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addCookies([...theo].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const giver = await ctx.newPage();
  giver.on('pageerror', (e) => errors.push(e.message));
  await giver.goto(`${WEB}/file/maya`);
  await giver.getByRole('button', { name: '+ Make a card for Maya' }).click();
  await giver.getByLabel(/^Headline/).fill('Maya taught me to fold a zine');
  await giver.getByLabel(/^Description/).fill('One Saturday at the market she showed me the eight-page fold with a single cut.');
  await giver.locator('input[type=file]').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(await picture(71)) }]);
  await giver.waitForFunction(() => document.querySelectorAll('.pj-att.done').length === 1);
  await shot(giver, '1-make-a-card-for-someone', true);
  await ctx.close();

  // the same card made and sent without ticking anything; Maya places it and shares her File
  const c = await call(theo, 'POST', '/me/file/cards', {
    headline: 'Maya taught me to fold a zine', description: 'One Saturday at the market she showed me the eight-page fold with a single cut.',
    photos: [{ id: await upload(theo, 71), caption: 'The first fold' }], forHandle: 'maya',
  });
  await call(theo, 'POST', `/me/file/cards/${c.id}/send`);
  await call(maya, 'PUT', '/me/file/pages/7', { cardId: c.id });
  await call(maya, 'PATCH', '/me', { filePublic: true });

  const outside = await browser.newContext(DESKTOP);
  const pub = await outside.newPage();
  pub.on('pageerror', (e) => errors.push(e.message));
  await pub.goto(`${WEB}/f/maya`);
  await pub.locator('#file-sheet .file-card').waitFor();
  const tab = pub.getByRole('tab', { name: 'theo', exact: true });
  console.log('theo’s card on the share link:', await tab.count() === 1 ? 'yes' : 'no');
  if (await tab.count() === 1) await tab.click();
  else await pub.getByRole('tab', { name: /^Page 8/ }).click().catch(() => {});
  await shot(pub, '2-share-link-gift-page', true);
  await outside.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
