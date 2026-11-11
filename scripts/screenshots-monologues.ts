/**
 * RFC §10.22, monologues: the feed with cassettes in it, the Monologue tab, the recorder, a
 * profile's shelf of tapes, and dark mode. Same stack as the other screenshot scripts:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-monologues.ts   # or without SHOTS for "after"
 * Output: .screenshots/monologues-before/ and .screenshots/monologues-after/
 * Chrome runs with a fake microphone (a beep), so the recorder really records.
 */
import { chromium, type BrowserContext } from 'playwright-core';
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'monologues-before' : 'monologues-after');
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
const about = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
async function member(handle: string, displayName: string, gender: string): Promise<Jar> {
  const jar: Jar = new Map();
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  await call(jar, 'POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call(jar, 'PUT', '/me/setup', { about, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  return jar;
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors: string[] = [];

/** a real six-second recording (a soft chord), made by Chrome itself, to seed the tapes */
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
      // a slow swell, so the waveform has a shape
      gain.gain.setValueAtTime(0.02, ac.currentTime);
      gain.gain.linearRampToValueAtTime(g, ac.currentTime + 2);
      gain.gain.linearRampToValueAtTime(0.05, ac.currentTime + 4);
      gain.gain.linearRampToValueAtTime(g, ac.currentTime + 6);
      o.connect(gain).connect(dest); o.start();
    }
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(); await new Promise((r) => setTimeout(r, 6000)); rec.stop(); await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = ''; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  await ctx.close();
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const wave = (seed: number) => Array.from({ length: 96 }, (_, i) =>
  Math.round(25 + 60 * Math.abs(Math.sin(i / (5 + seed)) * Math.cos(i / (11 + seed * 2)))));

async function tape(jar: Jar, audio: Uint8Array, title: string, kind: string, durationMs: number, seed: number, note = '') {
  const form = new FormData();
  form.append('file', new File([audio as BlobPart], 'take.webm', { type: 'audio/webm' }));
  form.append('durationMs', String(durationMs));
  form.append('peaks', JSON.stringify(wave(seed)));
  const a = await call(jar, 'POST', '/monologues/audio', form);
  return call(jar, 'POST', '/posts', { body: note, monologue: { audioId: a.id, title, kind, mine: true } });
}

async function open(viewer: Jar, opts: Parameters<typeof browser.newContext>[0]): Promise<BrowserContext> {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([...viewer].map(([n, value]) => ({ name: n, value, domain: 'localhost', path: '/' })));
  return ctx;
}
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

try {
  const sneho = await member('sneho', 'Sneho', 'woman');
  const mira = await member('mira', 'Mira Gurung', 'woman');
  const ben = await member('ben', 'Ben Thapa', 'man');
  const ana = await member('ana', 'Ana', 'undisclosed');

  await call(ben, 'POST', '/posts', { body: 'The tea stall by the bridge reopened. Same chipped cups, same radio.' });
  if (!BEFORE) {
    const audio = await seedAudio();
    await tape(mira, audio, 'Songs my grandmother hummed', 'song', 6_000, 1, 'Recorded on the roof at 6am. The birds are not mine.');
    await tape(ana, audio, 'Why I stopped keeping a to-do list', 'thought', 252_000, 2);
    await tape(ben, audio, 'Monday, the bus, a man with a parrot', 'yap', 74_000, 3);
  }
  await call(mira, 'POST', '/posts', { body: 'Darkroom is free on Thursday if anyone wants to print.' });

  for (const [name, opts] of [['feed-desktop', DESKTOP], ['feed-phone', PHONE]] as const) {
    const ctx = await open(sneho, opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${WEB}/`);
    await page.getByRole('button', { name: /got it|let me in|start/i }).first().click({ timeout: 3000 }).catch(() => {});
    await page.getByText('Darkroom is free').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: name === 'feed-desktop' });
    console.log('saved', name);
    await ctx.close();
  }

  {
    const ctx = await open(sneho, PHONE);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${WEB}/u/${BEFORE ? 'mira' : 'mira'}`);
    await page.getByText('Mira Gurung').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, 'profile-phone.png'), fullPage: true });
    console.log('saved profile-phone');
    // the tab bar covers the middle of a full-page phone shot: the shelf on its own as well
    const shelf = page.locator('.shelf');
    if (await shelf.count()) {
      await shelf.scrollIntoViewIfNeeded();
      await shelf.screenshot({ path: join(OUT, 'profile-shelf-phone.png') });
      console.log('saved profile-shelf-phone');
    }
    await ctx.close();
  }
  if (!BEFORE) {
    // a shelf with more than one tape on it
    const audio2 = await seedAudio();
    await tape(mira, audio2, 'Rain on a tin roof, Pokhara', 'song', 131_000, 4);
    await tape(mira, audio2, 'On being bad at chess', 'thought', 288_000, 5);
    await tape(mira, audio2, 'The tailor who remembers everyone', 'yap', 47_000, 6);
    const ctx = await open(sneho, DESKTOP);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${WEB}/u/mira`);
    await page.locator('.shelf').waitFor({ timeout: 30_000 });
    await page.locator('.shelf').scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'profile-desktop.png') });
    console.log('saved profile-desktop');
    await ctx.close();
  }

  if (!BEFORE) {
    // the Monologue tab, desktop and phone
    for (const [name, opts] of [['tab-desktop', DESKTOP], ['tab-phone', PHONE]] as const) {
      const ctx = await open(sneho, opts);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${WEB}/monologue`);
      await page.getByRole('button', { name: 'Show older monologues' }).click({ timeout: 4000 }).catch(() => {});
      await page.getByText('Songs my grandmother hummed').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: name === 'tab-desktop' });
      console.log('saved', name);
      if (name === 'tab-phone') {
        // playing: the reels turn and the tape moves across
        await page.getByRole('button', { name: /^Play Songs my grandmother hummed/ }).click();
        await page.waitForTimeout(3200);
        await page.screenshot({ path: join(OUT, 'playing-phone.png') });
        console.log('saved playing-phone');
      }
      await ctx.close();
    }

    // the recorder: fill in, record a few seconds from the fake microphone, stop, review
    {
      const ctx = await open(sneho, PHONE);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${WEB}/monologue/new`);
      await page.getByLabel('Title').fill('What the river taught me');
      await page.getByRole('radio', { name: 'Thought' }).click();
      await page.screenshot({ path: join(OUT, 'record-1-ready.png'), fullPage: true });
      await page.getByRole('button', { name: /^Record/ }).click();
      await page.waitForTimeout(3500);
      await page.screenshot({ path: join(OUT, 'record-2-recording.png'), fullPage: true });
      await page.getByRole('button', { name: /^Stop/ }).click();
      await page.getByRole('button', { name: /^Re-record/ }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, 'record-3-review.png'), fullPage: true });
      console.log('saved record-*');
      await ctx.close();
    }

    // one monologue's own page, and the feed in dark mode
    {
      const ctx = await open(mira, PHONE);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${WEB}/monologue`);
      await page.getByRole('link', { name: /reply|replies/i }).first().click();
      await page.getByText('Songs my grandmother hummed').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, 'thread-phone.png'), fullPage: true });
      console.log('saved thread-phone');
      await ctx.close();
    }
    await call(sneho, 'PATCH', '/me', { theme: 'dark' });
    {
      const ctx = await open(sneho, PHONE);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${WEB}/monologue`);
      // heard them all already: like the feed, older ones wait behind the end card
      await page.getByRole('button', { name: 'Show older monologues' }).click({ timeout: 8000 }).catch(() => {});
      await page.getByText('Songs my grandmother hummed').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, 'tab-phone-dark.png') });
      console.log('saved tab-phone-dark');
      await ctx.close();
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
