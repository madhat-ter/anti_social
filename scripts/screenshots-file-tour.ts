/**
 * RFC §10.24, the opening run (2026-11-27): opening someone else's File flips through every
 * filled page once and comes back to "Me".
 *
 *   SHOTS=before bun scripts/screenshots-file-tour.ts → .screenshots/file-tour-before/
 *   bun scripts/screenshots-file-tour.ts              → .screenshots/file-tour-after/ (and checks)
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). Checks (after):
 * the run visits each filled page in drawer order and ends on "Me" (also where the device asks for
 * less motion); it never plays on your own File; a tap on a tab stops it there.
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
const OUT = join(import.meta.dir, '..', '.screenshots', `file-tour-${BEFORE ? 'before' : 'after'}`);
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
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const DESKTOP = { viewport: { width: 1280, height: 1000 } };

/** open a File and note every page that opens (by its tab) for a few seconds, with a frame now and then */
async function watch(p: Page, url: string, name: string | null, ms = 5500): Promise<string[]> {
  await p.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __tabs: string[] }).__tabs = seen;
    const note = () => {
      const on = document.querySelector('.file-tab.on')?.textContent?.trim() ?? '';
      if (on && seen[seen.length - 1] !== on) seen.push(on);
    };
    new MutationObserver(note).observe(document, { subtree: true, attributes: true, childList: true, attributeFilter: ['class'] });
  });
  await p.goto(url);
  await p.locator('#file-sheet').waitFor();
  const start = Date.now();
  let k = 0;
  while (Date.now() - start < ms) {
    if (name) await p.locator('.file').screenshot({ path: join(OUT, `${name}-${String(k++).padStart(2, '0')}.png`), animations: 'allow' });
    await p.waitForTimeout(name ? 150 : 250);
  }
  return p.evaluate(() => (window as unknown as { __tabs: string[] }).__tabs);
}

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);
  const own = async (headline: string, page: number, seed: number) =>
    call(maya, 'POST', '/me/file/cards', { headline, description: 'A page of hers.', photos: [{ id: await upload(maya, seed), caption: '' }], page });
  await own('Maya Lind, print room', 0, 1);
  for (const [pos, label] of [[1, 'Zines'], [2, 'Coffee'], [4, 'Vintage']] as const) {
    await call(maya, 'PUT', `/me/file/pages/${pos}`, { label });
    await own(label, pos, pos + 10);
  }
  const g = await call(theo, 'POST', '/me/file/cards', { headline: 'Maya taught me to fold a zine', description: 'One Saturday at the market.', photos: [{ id: await upload(theo, 71), caption: '' }], forHandle: 'maya' });
  await call(theo, 'POST', `/me/file/cards/${g.id}/send`);
  await call(maya, 'PUT', '/me/file/pages/7', { cardId: g.id });
  await call(maya, 'PATCH', '/me', { filePublic: true });

  // Theo opens Maya's File inside anti
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addCookies([...theo].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const inside = await watch(p, `${WEB}/file/maya`, 'member');
  console.log('inside anti, pages opened:', inside.join(' → '));
  await ctx.close();

  // someone outside, by the share link
  const out = await browser.newContext(DESKTOP);
  const q = await out.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  const outside = await watch(q, `${WEB}/f/maya`, 'share-link');
  console.log('share link, pages opened:', outside.join(' → '));
  await out.close();

  if (!BEFORE) {
    // drawer order: own pages 1–6, then the gift pages; "Me" only at the start and the end
    const want = ['ME', 'Zines', 'Coffee', 'Vintage', 'theo', 'ME'];
    must(JSON.stringify(inside) === JSON.stringify(want), `inside: ${inside.join(',')}`);
    must(JSON.stringify(outside) === JSON.stringify(want), `outside: ${outside.join(',')}`);

    // not on your own File
    const mine = await browser.newContext(DESKTOP);
    await mine.addCookies([...maya].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
    const own1 = await watch(await mine.newPage(), `${WEB}/file`, null, 2500);
    must(JSON.stringify(own1) === '["ME"]', `played on her own File: ${own1.join(',')}`);
    await mine.close();

    // it plays even where the device asks for less motion (owner, Q6)
    const calm = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce' });
    const still = await watch(await calm.newPage(), `${WEB}/f/maya`, null, 5500);
    must(JSON.stringify(still) === JSON.stringify(want), `with less motion: ${still.join(',')}`);
    await calm.close();

    // a tap on a tab mid-run stops it there
    const tap = await browser.newContext(DESKTOP);
    const r = await tap.newPage();
    await r.goto(`${WEB}/f/maya`);
    await r.locator('#file-sheet').waitFor();
    await r.waitForTimeout(700);
    await r.getByRole('tab', { name: 'Vintage', exact: true }).click();
    await r.waitForTimeout(3000);
    must((await r.locator('.file-tab.on').innerText()).trim() === 'VINTAGE', 'the run went on after a tap');
    await r.locator('.file').screenshot({ path: join(OUT, 'tapped-vintage.png') });
    await tap.close();
  }

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
