/**
 * RFC §10.33: someone gone quiet. Maya used to come often and has been away 8 days; Ana, who
 * talks with her most, finds a note in her bell with "Say hi", which opens the post box with
 * "@maya " typed. Theo has been away 23 days and hears his seat is kept for him.
 *
 *   SHOTS=before bun scripts/screenshots-quiet.ts → .screenshots/quiet-before/ (the job does not run)
 *   bun scripts/screenshots-quiet.ts              → .screenshots/quiet-after/ (and checks)
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots").
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';
import { JOBS, runJob } from '../apps/api/src/lib/jobs';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', `quiet-${BEFORE ? 'before' : 'after'}`);
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const storage = new MemoryStorage();
const payments = new FakeStripeProvider(WEB);
const server = createApp({
  db: t.db, storage, payments,
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

type Jar = Map<string, string>;
async function call(jar: Jar, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: WEB };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
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
/** last here `days` ago, after coming on 12 of the 30 days before that */
async function away(handle: string, days: number) {
  await t.client.query(`update users set activated_at = now() - interval '90 days', last_seen_at = now() - make_interval(days => $2),
                          last_seen_on = (now() - make_interval(days => $2))::date where handle = $1`, [handle, days]);
  await t.client.query(`insert into user_seen_days (user_id, day)
                          select id, (now() - make_interval(days => $2))::date - g from users, generate_series(0, 11) g where handle = $1
                          on conflict do nothing`, [handle, days]);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const DESKTOP = { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' as const };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
async function open(jar: Jar, opts: typeof DESKTOP | typeof PHONE) {
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log('saved', name);
};

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const ana = await member('ana', 'Ana Ruiz', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);
  const hers = await call(maya, 'POST', '/posts', { body: 'Printing all weekend. The riso is finally behaving.' });
  await call(ana, 'POST', '/posts', { body: 'Save me a copy of the new one?', parentId: hers.id });
  const anas = await call(ana, 'POST', '/posts', { body: 'Anyone up for the market on Saturday?' });
  await call(maya, 'POST', '/posts', { body: 'Me! Same corner as always.', parentId: anas.id });
  await away('maya', 8);
  await away('theo', 23);
  if (!BEFORE) {
    const r = await runJob(t.db, JOBS.find((j) => j.name === 'quiet')!, { storage, payments });
    console.log('quiet job:', JSON.stringify(r));
  }

  // Ana's bell, on a computer and a phone
  for (const [kind, opts] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
    const a = await open(ana, opts);
    await a.page.goto(`${WEB}/notifications`);
    await a.page.locator('h1', { hasText: 'Notifications' }).waitFor();
    if (!BEFORE) await a.page.getByText('hasn’t been around for a week').waitFor();
    await shot(a.page, `1-bell-${kind}`);
    if (!BEFORE) {
      must(await a.page.locator('.notif-act', { hasText: 'Say hi' }).count() === 1, 'no Say hi on the note');
      // Say hi: the feed opens with the box holding "@maya "
      await a.page.locator('.notif-act').click();
      await a.page.waitForURL((u) => u.pathname === '/');
      await a.page.waitForFunction(() => (document.querySelector('#compose textarea') as HTMLTextAreaElement | null)?.value.startsWith('@maya '));
      must(!new URL(a.page.url()).search.includes('say='), 'the address keeps ?say=');
      const focused = await a.page.waitForFunction(() => document.activeElement === document.querySelector('#compose textarea'), null, { timeout: 3000 })
        .then(() => true, () => false);
      must(focused, `the box does not have the cursor (it is on ${await a.page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`)})`);
      await a.page.keyboard.type('we miss you at the market. Saturday?');
      await shot(a.page, `2-say-hi-${kind}`);
    } else {
      await a.page.goto(WEB);
      await a.page.locator('#compose textarea').waitFor();
      await shot(a.page, `2-say-hi-${kind}`);
    }
    await a.ctx.close();
  }

  // Theo, day 23: his own bell
  const th = await open(theo, PHONE);
  await th.page.goto(`${WEB}/notifications`);
  await th.page.locator('h1', { hasText: 'Notifications' }).waitFor();
  if (!BEFORE) await th.page.getByText('Your seat is kept for you until').waitFor();
  await shot(th.page, '3-seat-kept-phone');
  await th.ctx.close();
  // Maya herself sees nothing about it
  if (!BEFORE) must((await call(maya, 'GET', '/notifications')).items.every((n: any) => n.kind !== 'gone_quiet'), 'Maya was told about herself');

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
