/**
 * RFC §10.12, posts and replies look different. In-process API on :3101, web build on :3100 (see
 * the other screenshot scripts).
 *
 *   SHOTS=before bun scripts/screenshots-replies.ts   → .screenshots/replies-before/NN-name.png
 *   bun scripts/screenshots-replies.ts                → .screenshots/replies/NN-name.png (and checks)
 *
 * The same scene both times: a thread with replies (one answering another reply), a member's
 * profile list mixing posts and replies, search results, and the thread on a phone.
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
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'replies-before' : 'replies');
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
async function member(handle: string, displayName: string, gender: string) {
  const authn = new FakeAuthenticator();
  const c = client();
  const raw = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [raw]);
  const o = await c.call('POST', '/auth/register/options', { code: formatInviteCode(raw), handle, displayName });
  await c.call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string>, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const must = (ok: unknown, msg: string) => { if (!BEFORE && !ok) throw new Error(msg); };
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);

  const hike = await maya.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate, back by noon. Bring water, the café at the top is closed this month.' });
  const r1 = await theo.call('POST', '/posts', { body: 'In! Can we do the ridge path this time? The forest loop was a mud bath.', parentId: hike.id });
  await ines.call('POST', '/posts', { body: 'Count me in. I can bring a thermos of tea for everyone.', parentId: hike.id });
  await maya.call('POST', '/posts', { body: 'Ridge path it is. Wear proper shoes, it gets steep after the bridge.', parentId: r1.id });
  await theo.call('POST', '/posts', { body: 'Perfect. See you at the gate.', parentId: hike.id });
  await theo.call('POST', '/posts', { body: 'Fixed the bike lights finally. If anyone needs a pump, mine lives by the door now.' });
  await ines.call('POST', '/posts', { body: 'The lido is open late this week. Cold water, warm chips, nobody on their phone.' });
  await theo.call('POST', '/posts', { body: 'Yes. Saturday after the hike?', parentId: (await ines.call('GET', '/feed')).items[0].id });

  // ── 1. the thread on a laptop
  const lap = await open(ines.jar, { width: 1366, height: 900 });
  await lap.goto(`${WEB}/p/${hike.id}`);
  await welcome(lap);
  await lap.getByText('Ridge path it is').waitFor();
  must(await lap.locator('article.post.lead').count() === 1, 'the thread’s post is not drawn as the lead');
  must(await lap.locator('.thread-replies article.post.compact').count() === 4, 'replies are not drawn small on the thread line');
  await shot(lap, 'thread');

  // ── 2. Theo's profile: his posts and his replies, mixed
  await lap.goto(`${WEB}/u/theo`);
  await lap.getByRole('tab', { name: 'Posts' }).waitFor();
  await lap.getByText('Perfect. See you at the gate.').waitFor();
  if (!BEFORE) {
    must(await lap.locator('.reply-to').count() === 3, `expected 3 "Replied to" lines, got ${await lap.locator('.reply-to').count()}`);
    must((await lap.locator('.reply-to').first().innerText()).includes('Replied to Inês Moreau’s post'), 'the newest reply does not say what it answers');
  }
  await lap.getByRole('tab', { name: 'Posts' }).scrollIntoViewIfNeeded();
  await shot(lap, 'profile-posts-and-replies');

  // ── 3. search finds a post and a reply
  await lap.goto(`${WEB}/search?q=ridge`);
  await lap.getByText('Ridge path it is').waitFor();
  await shot(lap, 'search');
  await lap.close();

  // ── 4. the thread on a phone
  const phone = await open(ines.jar, { width: 390, height: 844 });
  await phone.goto(`${WEB}/p/${hike.id}`);
  await welcome(phone);
  await phone.getByText('Ridge path it is').waitFor();
  await shot(phone, 'phone-thread', true);
  await phone.goto(`${WEB}/u/theo`);
  await phone.getByText('Perfect. See you at the gate.').waitFor();
  await phone.getByRole('tab', { name: 'Posts' }).scrollIntoViewIfNeeded();
  await shot(phone, 'phone-profile');
  await phone.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
