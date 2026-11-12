/**
 * RFC §10.23, the mixed feed. The scene the owner described: Maya and Inês each post something
 * worth reading, then Rafi posts ten monologues in a row. Theo opens the feed.
 *
 *   SHOTS=before bun scripts/screenshots-feed-mix.ts   → .screenshots/feed-mix-before/
 *   bun scripts/screenshots-feed-mix.ts                → .screenshots/feed-mix-after/
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). The "after" run also
 * checks: the newest post is first, Rafi never twice in a row, a reload keeps the order, the
 * label links to the rules, and Settings → Feed order switches back to newest first.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'feed-mix-before' : 'feed-mix-after');
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
const ago = (id: string, minutes: number) =>
  t.client.query(`update posts set created_at = now() - make_interval(mins => $2) where id = $1`, [id, minutes]);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];

/** a real six-second recording made by Chrome, to seed the tapes */
async function seedAudio(): Promise<Uint8Array> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${WEB}/feed-rules`);
  const b64 = await page.evaluate(async () => {
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    for (const [f, g] of [[220, 0.25], [277, 0.15], [330, 0.12]] as const) {
      const o = ac.createOscillator(); const gain = ac.createGain();
      o.frequency.value = f; gain.gain.value = g;
      o.connect(gain).connect(dest); o.start();
    }
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(); await new Promise((r) => setTimeout(r, 3000)); rec.stop(); await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await ctx.close();
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
const wave = (seed: number) => Array.from({ length: 96 }, (_, i) =>
  Math.round(25 + 60 * Math.abs(Math.sin(i / (5 + seed)) * Math.cos(i / (11 + seed * 2)))));
async function tape(jar: Jar, audio: Uint8Array, title: string, kind: string, durationMs: number, seed: number) {
  const form = new FormData();
  form.append('file', new File([audio as BlobPart], 'take.webm', { type: 'audio/webm' }));
  form.append('durationMs', String(durationMs));
  form.append('peaks', JSON.stringify(wave(seed)));
  const a = await call(jar, 'POST', '/monologues/audio', form);
  return call(jar, 'POST', '/posts', { body: '', monologue: { audioId: a.id, title, kind, mine: true } });
}

async function open(viewer: Jar, opts: Parameters<typeof browser.newContext>[0]): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([...viewer].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const DESKTOP = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' as const };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log('saved', name);
};
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };
/** who wrote each card in the feed, top to bottom (folded ones are not drawn) */
const authors = (p: Page) => p.locator('.posts article.post').evaluateAll((els) =>
  els.map((e) => (e.querySelector('a[href^="/u/"]')?.getAttribute('href') ?? '').replace('/u/', '')));

try {
  const theo = await member('theo', 'Theo Brandt', 'man');
  const maya = await member('maya', 'Maya Lind', 'woman');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const rafi = await member('rafi', 'Rafi Haddad', 'man');
  const juno = await member('juno', 'Juno Park', 'nonbinary');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);

  // before Theo's last visit (yesterday)
  const old = await call(juno, 'POST', '/posts', { body: 'Bread club is on again Thursday. Bring a jar for the starter.' });
  await ago(old.id, 30 * 60);
  // first posts are never folded, so everyone has one from last month
  for (const [jar, body] of [[maya, 'Hello from the print room.'], [ines, 'Hi all, Inês here.'], [rafi, 'Rafi, new in town.']] as const) {
    const p = await call(jar, 'POST', '/posts', { body }); await ago(p.id, 40 * 24 * 60);
  }
  await t.client.query(`update users set feed_seen_through = now() - interval '20 hours' where handle = 'theo'`);

  // since then: two good posts, then Rafi's ten monologues in a row
  const walk = await call(maya, 'POST', '/posts', { body: 'Walking the river trail on Saturday at 8. Slow pace, coffee at the end, dogs welcome. Who is in?' });
  await ago(walk.id, 150);
  const zine = await call(ines, 'POST', '/posts', { body: 'Finished the first issue of the zine: 24 pages, all hand-lettered. Copies at the library desk.' });
  await ago(zine.id, 130);
  const audio = await seedAudio();
  const titles = ['Morning pages', 'The bus at 7', 'A song for the rain', 'On cardamom', 'Why I walk', 'Bridge at dusk',
    'The ramen place', 'My grandmother’s radio', 'Notes from the market', 'Last one tonight'];
  for (const [i, title] of titles.entries()) {
    const p = await tape(rafi, audio, title, ['song', 'thought', 'yap'][i % 3]!, 40_000 + i * 9_000, i + 1);
    await ago(p.id, 100 - i * 9);
  }

  // ── Theo on a laptop
  const lap = await open(theo, DESKTOP);
  await lap.page.goto(WEB);
  await welcome(lap.page);
  await lap.page.locator('.posts article.post').first().waitFor();
  await lap.page.waitForTimeout(800);
  await shot(lap.page, '01-feed-top');
  const order1 = await authors(lap.page);
  console.log('order:', order1.join(' '));

  if (!BEFORE) {
    must(order1[0] === 'rafi', `the newest post is not first: ${order1[0]}`);
    for (let i = 1; i < order1.length; i++) must(order1[i] !== order1[i - 1] || order1[i] === 'theo', `two from ${order1[i]} in a row: ${order1.join(' ')}`);
    must(order1.slice(0, 5).includes('maya') && order1.slice(0, 5).includes('ines'), `Maya and Inês are not near the top: ${order1.join(' ')}`);
    const label = lap.page.locator('.feed-since');
    must((await label.innerText()).includes('mixed'), `no "mixed" label: ${await label.innerText()}`);
    // the same visit: a reload keeps the order
    await lap.page.reload();
    await lap.page.locator('.posts article.post').first().waitFor();
    await lap.page.waitForTimeout(800);
    const order2 = await authors(lap.page);
    must(order2.join() === order1.join(), `a reload reshuffled: ${order1.join(' ')} / ${order2.join(' ')}`);
  }
  await lap.page.locator('.feed-fold').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(lap.page, '02-feed-full', true);
  await lap.ctx.close();

  // ── Theo on a phone (a fresh tab is a fresh visit)
  await t.client.query(`update users set feed_seen_through = now() - interval '20 hours' where handle = 'theo'`);
  const phone = await open(theo, PHONE);
  await phone.page.goto(WEB);
  await welcome(phone.page);
  await phone.page.locator('.posts article.post').first().waitFor();
  await phone.page.waitForTimeout(800);
  await shot(phone.page, '03-phone-top');
  await shot(phone.page, '04-phone-full', true);

  if (!BEFORE) {
    // Settings → Feed order → Newest first: the plain timeline comes back
    await phone.page.goto(`${WEB}/settings`);
    const choice = phone.page.getByRole('radio', { name: /Newest first/ });
    await choice.scrollIntoViewIfNeeded();
    await shot(phone.page, '05-settings-feed-order');
    // the radio turns on once the account has saved it
    await choice.click();
    await phone.page.waitForFunction(() => (document.querySelector('input[name="settings-feed-order"][value="newest"]') as HTMLInputElement | null)?.checked === true);
    const me = await call(theo, 'GET', '/me');
    must(me.feedOrder === 'newest', `the choice was not saved: ${me.feedOrder}`);
    await t.client.query(`update users set feed_seen_through = now() - interval '20 hours' where handle = 'theo'`);
    await phone.page.evaluate(() => sessionStorage.clear());
    await phone.page.goto(WEB);
    await phone.page.locator('.posts article.post').first().waitFor();
    await phone.page.waitForTimeout(800);
    const plain = await authors(phone.page);
    must(plain[0] === 'rafi' && plain[1] === 'rafi', `newest first did not come back: ${plain.join(' ')}`);
    must(!(await phone.page.locator('.feed-since').innerText()).includes('mixed'), 'the mixed label shows in newest-first');
    await shot(phone.page, '06-phone-newest-first');

    await phone.page.goto(`${WEB}/feed-rules`);
    await phone.page.getByRole('heading', { name: 'How the feed works' }).waitFor();
    await shot(phone.page, '07-feed-rules', true);
  }
  await phone.ctx.close();

  // ── the landing page's rule
  const out = await browser.newContext(DESKTOP);
  const land = await out.newPage();
  await land.goto(WEB);
  await land.locator('.rules').scrollIntoViewIfNeeded();
  await shot(land, BEFORE ? '05-landing-rules' : '08-landing-rules');
  await out.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
