/**
 * RFC §10.13: joining and signing in with a handle and a 6-digit PIN. In-process API on :3101,
 * web build on :3100 (see the other screenshot scripts).
 *
 *   bun scripts/screenshots-pin.ts          → .screenshots/pin/NN-name.png
 *
 * Walks: joining with an invite (the PIN step, the recovery code); signing in; a wrong PIN, then
 * the rest after five; "Forgot your PIN?" with an admin's reset code; Settings → PIN; the admin's
 * Reset PIN; a member who joined with a passkey meeting the "Choose a PIN" screen.
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

const WEB = 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'pin');
mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

function client() {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) { const [k, ...v] = sc.split(';')[0]!.split('='); if (v.join('=')) jar.set(k!.trim(), v.join('=')); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  return { call, jar };
}
const mint = async () => { const raw = generateInviteCode(); await t.client.query('select create_invite(null, $1)', [raw]); return formatInviteCode(raw); };
async function pinMember(handle: string, displayName: string, gender: string, pin = '739206') {
  const c = client();
  await c.call('POST', '/auth/join', { code: await mint(), handle, displayName, pin });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}
async function passkeyMember(handle: string, displayName: string, gender: string) {
  const authn = new FakeAuthenticator();
  const c = client();
  const o = await c.call('POST', '/auth/register/options', { code: await mint(), handle, displayName });
  await c.call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string> | null, viewport = { width: 1366, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  if (jar) await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };

try {
  const maya = await pinMember('maya', 'Maya Lind', 'woman');
  await t.client.query(`update users set role = 'ops', checklist_dismissed_at = now()`);
  await maya.call('POST', '/posts', { body: 'Welcome to the new way in: your handle and six digits.' });

  // ── 1. joining, on a phone
  const ph = await open(null, { width: 390, height: 844 });
  await ph.goto(`${WEB}/join`);
  await ph.getByLabel('Invite code').fill(await mint());
  await ph.getByRole('button', { name: 'Check code' }).click();
  await ph.getByLabel('Handle', { exact: true }).fill('juno');
  await ph.getByLabel('Display name').fill('Juno Park');
  await ph.getByRole('button', { name: 'Continue' }).click();
  await ph.getByLabel('New PIN').fill('123456');
  await ph.getByLabel('The same PIN again').fill('123456');
  await ph.getByRole('button', { name: 'Join' }).click();
  await ph.getByText('straight run of digits').waitFor();
  await shot(ph, 'join-weak-pin');
  await ph.getByLabel('New PIN').fill('730418');
  await ph.getByLabel('The same PIN again').fill('730418');
  await shot(ph, 'join-pin');
  await ph.getByRole('button', { name: 'Join' }).click();
  await ph.getByRole('heading', { name: 'Save your recovery code' }).waitFor();
  await shot(ph, 'join-recovery-code');
  await ph.close();

  // ── 2. signing in, a wrong PIN, then the rest
  const lg = await open(null);
  await lg.goto(`${WEB}/login`);
  await lg.getByLabel('Handle', { exact: true }).fill('juno');
  await shot(lg, 'sign-in');
  await lg.getByLabel('PIN', { exact: true }).fill('111222');
  await lg.getByText('don’t match').waitFor();
  await shot(lg, 'sign-in-wrong');
  for (let i = 0; i < 4; i++) await client().call('POST', '/auth/pin/login', { handle: 'juno', pin: '999999' }).catch(() => {});
  await lg.getByLabel('PIN', { exact: true }).fill('111333');
  await lg.getByText('resting until').waitFor();
  await shot(lg, 'sign-in-resting');

  // ── 3. an admin makes a reset code; Juno uses it under "Forgot your PIN?"
  const adm = await open(maya.jar);
  await adm.goto(`${WEB}/admin#members`);
  await adm.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
  const row = adm.locator('.adm-members li', { hasText: '@juno' });
  await row.getByRole('button', { name: 'More actions for @juno' }).click();
  await adm.getByRole('menuitem', { name: 'Reset PIN' }).click();
  const box = adm.locator('.pin-reset-code');
  await box.waitFor();
  const code = (await box.locator('.code').innerText()).trim();
  must(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), `odd reset code: ${code}`);
  await box.scrollIntoViewIfNeeded();
  await shot(adm, 'admin-reset-code');
  await adm.close();

  await lg.getByRole('link', { name: 'Forgot your PIN?' }).click();
  await lg.getByRole('heading', { name: 'Forgot your PIN?' }).waitFor();
  await lg.waitForLoadState('networkidle');
  await lg.waitForTimeout(800);
  await lg.getByLabel('Handle', { exact: true }).fill('juno');
  await lg.getByLabel('Recovery code or admin’s reset code').fill(code);
  await lg.getByLabel('New PIN').fill('905173');
  await lg.getByLabel('The same PIN again').fill('905173');
  await shot(lg, 'forgot-pin');
  await lg.getByRole('button', { name: 'Set my new PIN' }).click();
  // signed in again; Juno never finished setup, so the app goes there first (done here through the API)
  await lg.waitForFunction(() => location.pathname !== '/recover');
  const junoJar = new Map((await lg.context().cookies()).map((c) => [c.name, c.value] as [string, string]));
  const juno = client();
  for (const [k, v] of junoJar) juno.jar.set(k, v);
  await juno.call('PUT', '/me/setup', setup('nonbinary'));
  await lg.goto(WEB);
  await lg.getByRole('button', { name: 'Got it' }).click({ timeout: 6000 }).catch(() => {});
  await lg.locator('.posts article.post').first().waitFor();
  await shot(lg, 'signed-in-after-reset');

  // ── 4. Settings → PIN
  await lg.goto(`${WEB}/settings#pin`);
  await lg.getByRole('button', { name: 'Change PIN' }).click();
  await lg.getByLabel('Current PIN').waitFor();
  await lg.locator('#pin').scrollIntoViewIfNeeded();
  await shot(lg, 'settings-change-pin');
  await lg.close();

  // ── 5. someone who joined with a passkey meets "Choose a PIN" first
  const old = await passkeyMember('theo', 'Theo Brandt', 'man');
  const gate = await open(old.jar);
  await gate.goto(WEB);
  await gate.getByRole('heading', { name: 'Choose a PIN' }).waitFor();
  await shot(gate, 'passkey-member-choose-pin');
  await gate.getByLabel('New PIN').fill('640217');
  await gate.getByLabel('The same PIN again').fill('640217');
  await gate.getByRole('button', { name: 'Save my PIN' }).click();
  await gate.getByRole('button', { name: 'Got it' }).click({ timeout: 8000 }).catch(() => {});
  await gate.locator('.posts article.post').first().waitFor();
  must((await old.call('GET', '/me')).pinSet === true, 'the PIN was not saved');
  await gate.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
