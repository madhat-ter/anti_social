/**
 * Real screens for the one-minute video (docs/video/anti-1-minute.md), captured from a throwaway
 * stack with made-up members, never the live site. Phone viewport (390 × 844) at 3× pixels, so a
 * crop can be pushed to 2× in a 1080 × 1920 frame and stay sharp.
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/capture-video-assets.ts [outDir]     # default E:/work/anti-video/assets/shots
 * Writes PNGs plus shots.json (sizes, and where the buttons the cursor clicks sit inside each image).
 */
import { chromium, type Locator, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = process.argv[2] ?? 'E:/work/anti-video/assets/shots';
mkdirSync(join(OUT, 'seats'), { recursive: true });
const DPR = 3;
const meta: Record<string, unknown> = {};

const t = await createTestDb({ seatCap: 30 });
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
const about = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
async function member(handle: string, displayName: string, gender: string): Promise<Jar> {
  const jar: Jar = new Map();
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  await call(jar, 'POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call(jar, 'PUT', '/me/setup', { about, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  await call(jar, 'POST', '/me/checklist/dismiss', {}).catch(() => {});
  return jar;
}
const inDays = (days: number, hour: number) => { const d = new Date(Date.now() + days * 86_400_000); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true };

/** an element's box inside another element's screenshot, in image pixels */
async function boxIn(inner: Locator, outer: Locator) {
  const a = (await inner.boundingBox())!; const b = (await outer.boundingBox())!;
  return { x: Math.round((a.x - b.x) * DPR), y: Math.round((a.y - b.y) * DPR), w: Math.round(a.width * DPR), h: Math.round(a.height * DPR) };
}
async function shot(loc: Locator, name: string) {
  await loc.scrollIntoViewIfNeeded();
  await loc.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
  const b = (await loc.boundingBox())!;
  meta[name] = { w: Math.round(b.width * DPR), h: Math.round(b.height * DPR) };
  console.log('saved', name);
}
async function open(jar: Jar | null, opts = PHONE): Promise<Page> {
  const ctx = await browser.newContext(opts);
  if (jar) await ctx.addCookies([...jar].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  // the house rules window shows once per device; these members have seen it
  await ctx.addInitScript(() => { try { for (const h of ['sneho', 'mira', 'ben', 'ana']) localStorage.setItem(`anti:welcomed:${h}`, '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}

try {
  // ── the landing: the alert, the hundred seats, the wordmark ──
  {
    const page = await open(null);
    await page.goto(`${WEB}/`);
    const alert = page.locator('.zoom .win').first();
    await alert.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2600); // the zoom and the seats finish
    await shot(alert, 'alert');
    meta.alertYes = await boxIn(page.getByRole('link', { name: 'Yes, I have an invite' }), alert);
    const seats = page.locator('.seat-grid .seat');
    const n = await seats.count();
    for (let i = 0; i < n; i++) await seats.nth(i).screenshot({ path: join(OUT, 'seats', `seat-${String(i + 1).padStart(3, '0')}.png`), animations: 'disabled' });
    meta.seats = n;
    console.log('saved', n, 'seats');
    await page.context().close();
    const big = await open(null, { ...PHONE, deviceScaleFactor: 10 });
    await big.goto(`${WEB}/`);
    await big.locator('header .brand').waitFor();
    await big.waitForTimeout(800);
    await big.locator('header .brand').screenshot({ path: join(OUT, 'brand.png'), omitBackground: true });
    console.log('saved brand');
    await big.context().close();
  }

  // ── members and what they made ──
  const sneho = await member('sneho', 'Sneho', 'woman');
  const mira = await member('mira', 'Mira Gurung', 'woman');
  const ben = await member('ben', 'Ben Thapa', 'man');
  const ana = await member('ana', 'Ana', 'undisclosed');
  await call(ben, 'POST', '/posts', { body: 'The tea stall by the bridge reopened. Same chipped cups, same radio. Somebody finally fixed the bench outside, so now there is nowhere to complain.' });
  await call(ana, 'POST', '/posts', { body: 'Darkroom is free on Thursday if anyone wants to print.' });
  const wave = Array.from({ length: 96 }, (_, i) => Math.round(25 + 60 * Math.abs(Math.sin(i / 6) * Math.cos(i / 13))));
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(400).fill(7)]) as BlobPart], 'take.webm', { type: 'audio/webm' }));
  form.append('durationMs', '252000');
  form.append('peaks', JSON.stringify(wave));
  const audio = await call(mira, 'POST', '/monologues/audio', form);
  await call(mira, 'POST', '/posts', { body: '', monologue: { audioId: audio.id, title: 'Why I stopped keeping a to-do list', kind: 'thought', mine: true } });
  await call(mira, 'POST', '/posts', { body: 'Picnic on Saturday. Bring something you made.' });
  const ev = await call(mira, 'POST', '/events', { title: 'Picnic by the lake', startsAt: inDays(3, 11), endsAt: inDays(3, 14), location: 'The lake, north side', capacity: 12, interests: ['food'] });
  await call(ben, 'POST', '/collabs', { kind: 'activity', title: 'Sunday run club', meets: 'Sundays 7am, by the lake', interests: ['music'], teamMax: null, joinMode: 'open' });
  await call(ana, 'POST', '/collabs', { kind: 'project', title: 'A zine about the market', interests: ['photography'], roles: ['Writer'], teamMax: 5, joinMode: 'approve' });
  await call(ben, 'POST', `/events/${ev.id}/rsvp`, {}).catch((e) => console.log('rsvp ben skipped:', String(e).slice(0, 80)));

  // ── the feed: the line, three cards that look different, the end ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/`);
    await page.getByText('Darkroom is free').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'feed-screen.png') });
    await shot(page.locator('.tabbar').first(), 'tabbar');
    // the fixed tab bar would cover the bottom of a card in its own screenshot
    await page.addStyleTag({ content: '.tabbar { display: none !important; }' });
    await shot(page.locator('.feed-since').first(), 'feed-since');
    const posts = page.locator('.posts article.post');
    const n = await posts.count();
    for (let i = 0; i < n; i++) await shot(posts.nth(i), `post-${i}`);
    meta.posts = n;
    await shot(page.locator('.feed-end').first(), 'feed-end');

    await page.context().close();
  }

  // ── Collab: Start, the three choices, an event and its button ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/collab`);
    await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
    await page.getByText('Picnic by the lake').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'collab-screen.png') });
    const head = page.locator('.shell-main .row.between').first();
    await shot(head, 'collab-head');
    meta.collabStart = await boxIn(page.getByRole('link', { name: '+ Start' }), head);
    await page.goto(`${WEB}/collab/new`);
    await shot(page.locator('.start-choices').first(), 'start-choices');
    await page.goto(`${WEB}/collab/event/${ev.id}`);
    const going = page.getByRole('button', { name: /I.m going/ }).first();
    await going.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'event-screen.png') });
    const g = (await going.boundingBox())!;
    meta.eventGoing = { x: Math.round(g.x * DPR), y: Math.round(g.y * DPR), w: Math.round(g.width * DPR), h: Math.round(g.height * DPR) };
    await going.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, 'event-screen-going.png') });
    console.log('saved event screens');
    await page.context().close();
  }

  // ── one more face, for the seat that changes hands ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/members`);
    await page.waitForTimeout(1500);
    const faces = page.locator('.shell-main svg.avatar, .shell-main .avatar svg, .shell-main .avatar');
    const count = await faces.count();
    if (count) await faces.first().screenshot({ path: join(OUT, 'face-new.png'), animations: 'disabled' });
    console.log('saved face-new', count);
    await page.context().close();
  }

  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(meta, null, 2));
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
