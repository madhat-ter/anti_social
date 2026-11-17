/**
 * RFC §10.25, the landing page speaks to someone who feels alone: the message in four lines, a
 * help line under it, a plain welcome window, and "Ask for a seat" for someone with no invite and
 * nobody inside to ask. The request lands in Admin → Seat requests.
 *
 *   $env:SHOTS='before'; bun scripts/screenshots-landing.ts   → .screenshots/landing-before/
 *   bun scripts/screenshots-landing.ts                        → .screenshots/landing/
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md, "Screenshots"). "before" only takes
 * the landing page itself; without it the script sends a request through the form and follows it
 * to the admin's bell and the Admin page.
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

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'landing-before' : 'landing');
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
const DESKTOP = { viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' as const };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' as const };
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
/** the hundred seats fill over ~1.8s even with motion off: wait until the last face is in */
const settled = async (p: Page) => { await p.locator('.seat-grid').waitFor(); await p.waitForTimeout(2600); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  await t.client.query(`update users set role = 'ops', activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);

  // ── a stranger opens the site, on a computer and on a phone
  const out = await open(null, DESKTOP);
  await out.page.goto(WEB);
  await settled(out.page);
  await shot(out.page, 'landing-desktop');
  await shot(out.page, 'landing-desktop-full', true);
  const outPhone = await open(null, PHONE);
  await outPhone.page.goto(WEB);
  await settled(outPhone.page);
  await shot(outPhone.page, 'landing-phone');
  await shot(outPhone.page, 'landing-phone-full', true);

  if (!BEFORE) {
    must(await out.page.getByText('Social Life').count() === 0, 'the delete joke is still on the page');
    // the help line was taken off on the owner's word (2026-11-17): Kaan Pete Roi did not answer
    must(await out.page.getByText('Kaan Pete Roi').count() === 0, 'the help line is still on the page');

    // ── no invite and nobody inside: ask for a seat, right there
    await out.page.getByRole('button', { name: 'Ask for a seat' }).click();
    await out.page.getByLabel('Your name').waitFor();
    must(await out.page.getByRole('button', { name: 'Send' }).isDisabled(), 'an empty request can be sent');
    await shot(out.page, 'ask-open');
    await out.page.getByLabel('Your name').fill('Nabila');
    await out.page.getByLabel('How can we reach you?').fill('nabila.r@example.com');
    await out.page.getByLabel(/Anything you want to say/).fill('I am 16. I found this page at 2am. I don’t know anyone inside, but I would like to sit somewhere quiet with people.');
    await shot(out.page, 'ask-filled');
    await out.page.getByRole('button', { name: 'Send' }).click();
    await out.page.getByText('Sent.').waitFor();
    await shot(out.page, 'ask-sent');

    await outPhone.page.getByRole('button', { name: 'Ask for a seat' }).click();
    await outPhone.page.getByLabel('Your name').fill('Sam');
    await outPhone.page.getByLabel('Your name').scrollIntoViewIfNeeded();
    await shot(outPhone.page, 'ask-phone');

    // ── the admin: the bell, then Admin → Seat requests
    const own = await open(maya, DESKTOP);
    await own.page.goto(`${WEB}/notifications`);
    await own.page.getByText('Nabila asked for a seat').waitFor();
    await shot(own.page, 'admin-bell');
    await own.page.goto(`${WEB}/admin`);
    await own.page.getByRole('heading', { name: 'Seat requests' }).waitFor();
    await own.page.getByText('nabila.r@example.com').waitFor();
    await own.page.getByRole('heading', { name: 'Seat requests' }).scrollIntoViewIfNeeded();
    await shot(own.page, 'admin-requests');
    await own.page.getByRole('button', { name: 'Make an invite' }).click();
    await own.page.getByRole('dialog').getByRole('button', { name: 'Make an invite' }).click();
    await own.page.getByText('Send this to Nabila yourself').waitFor();
    await own.page.getByRole('heading', { name: 'Seat requests' }).scrollIntoViewIfNeeded();
    await shot(own.page, 'admin-invited');
    await own.ctx.close();
  }
  await out.ctx.close();
  await outPhone.ctx.close();

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
