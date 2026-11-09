/**
 * Screen time (RFC §10.10). In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-screen-time.ts
 * Output: .screenshots/screen-time/NN-name.png
 * The timer in the header, the nudge at ten minutes, the red pill in the last five, the lock at
 * thirty with its countdown (and the API refusing behind it), the hour passing, and the phone.
 * Time is pushed forward through the database; the page's own heartbeat does the rest.
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
import { FakeAuthenticator } from '../apps/api/test/fake-authenticator';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const SETUP = { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'woman', birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'member@example.com' };
const OUT = join(import.meta.dir, '..', '.screenshots', 'screen-time');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
/** push maya's half hour forward (the row exists only after the first heartbeat, so upsert) */
const setUsed = (s: number) => q(`insert into screen_time (user_id, used_s, window_started_at) select id, ${s}, now() from users where handle = 'maya' on conflict (user_id) do update set used_s = excluded.used_s, window_started_at = coalesce(screen_time.window_started_at, now())`);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
const file = (name: string) => join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}
const pageErrors: string[] = [];
function watch(page: Page) {
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (msg) => { if (/Content.Security.Policy/i.test(msg.text())) pageErrors.push(`CSP: ${msg.text()}`); });
  page.setDefaultTimeout(90_000);
}

/** A member who joins through the API; the session cookie goes into a browser context. */
async function apiMember(handle: string, displayName: string, gender = 'undisclosed') {
  const authn = new FakeAuthenticator();
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) {
      const [k, ...v] = sc.split(';')[0]!.split('=');
      if (v.join('=')) jar.set(k!.trim(), v.join('='));
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${handle}: ${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  const o = await call('POST', '/auth/register/options', { code: formatInviteCode(code), handle, displayName });
  await call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await call('PUT', '/me/setup', { ...SETUP, gender });
  return { call, jar };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await q(`update settings set value = '1'::jsonb where key = 'screen_time'`); // the admins' switch, off by default
  const maya = await apiMember('maya', 'Maya Lind', 'woman');
  const theo = await apiMember('theo', 'Theo Park', 'man');
  await theo.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate.' });
  await maya.call('POST', '/posts', { body: 'First week here. The quiet is loud.' });
  const cookies = [...maya.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' }));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  watch(page);

  // ── 1. the timer counts in the header while the tab is in front
  await page.goto(WEB);
  await page.getByText('The quiet is loud').waitFor();
  const pill = page.getByRole('timer');
  await pill.waitFor();
  await page.waitForTimeout(3200);
  const first = (await pill.innerText()).trim();
  if (!/^0:0[2-9]$/.test(first)) throw new Error(`timer after 3 s reads "${first}"`);
  const centred = async (p: Page, what: string) => {
    const b = (await p.getByRole('timer').boundingBox())!;
    const vw = p.viewportSize()!.width;
    const off = Math.abs(b.x + b.width / 2 - vw / 2);
    if (off > 2) throw new Error(`${what}: timer is ${off.toFixed(1)}px off the centre`);
  };
  await centred(page, 'desktop');
  await shot(page, 'header-timer');

  // ── 2. ten minutes in: the first nudge
  await setUsed(598);
  await page.reload();
  const dlg = page.locator('dialog[open]');
  await dlg.getByText(/Ten minutes/).waitFor();
  await shot(page, 'nudge-ten-minutes');
  await dlg.getByRole('button', { name: 'Fine' }).click();
  await dlg.waitFor({ state: 'hidden' });
  // the same nudge does not come back after a reload
  await page.reload();
  await page.getByText('The quiet is loud').waitFor();
  await page.waitForTimeout(2500);
  if (await page.locator('dialog[open]').count()) throw new Error('the ten-minute nudge showed twice');

  // ── 3. twenty, then the last five: the pill goes red
  await setUsed(1199);
  await page.reload();
  await page.locator('dialog[open]').getByText(/Twenty minutes/).waitFor();
  await page.locator('dialog[open]').getByRole('button', { name: 'Ten more' }).click();
  await setUsed(1499);
  await page.reload();
  await page.locator('dialog[open]').getByText(/Five minutes to go/).waitFor();
  await shot(page, 'nudge-five-to-go');
  await page.locator('dialog[open]').getByRole('button', { name: 'Last five' }).click();
  await page.locator('.time-pill.soon').waitFor();
  await page.locator('.top').screenshot({ path: file('pill-red') });
  console.log('saved pill-red');

  // ── 4. thirty: the lock, and the API refusing behind it
  await setUsed(1797);
  await page.reload();
  await page.getByRole('heading', { name: 'That is your half hour' }).waitFor();
  await page.getByText(/The door opens again in/).waitFor();
  const r = await page.request.get(`${WEB}/api/feed`);
  if (r.status() !== 403 || (await r.json()).error !== 'rest_time') throw new Error(`feed while locked -> ${r.status()}`);
  if (await page.getByText('The quiet is loud').count()) throw new Error('the feed shows behind the lock');
  await shot(page, 'locked');
  await page.locator('.top').screenshot({ path: file('pill-rest') });
  console.log('saved pill-rest');

  // ── 5. the hour passes: a fresh half hour, the feed is back
  await q(`update screen_time set locked_until = now() + interval '2 seconds'`);
  await page.reload();
  await page.getByText('The quiet is loud').waitFor({ timeout: 30_000 });
  const fresh = (await pill.innerText()).trim();
  if (!/^0:\d\d$/.test(fresh)) throw new Error(`timer after the rest reads "${fresh}"`);
  console.log('rest over, fresh half hour ok');
  await ctx.close();

  // ── 6. the phone: the timer between the wordmark and the bell
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(cookies);
  const ph = await phone.newPage();
  watch(ph);
  await ph.goto(WEB);
  await ph.getByText('The quiet is loud').waitFor();
  await ph.getByRole('timer').waitFor();
  await centred(ph, 'phone');
  await shot(ph, 'phone-timer');
  await setUsed(1797);
  await ph.reload();
  await ph.getByRole('heading', { name: 'That is your half hour' }).waitFor();
  await shot(ph, 'phone-locked');
  await phone.close();

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
