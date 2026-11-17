/**
 * RFC §10.26, fewer taps: the same six jobs before and after.
 *   1 reply from the feed (phone)      before: Reply opens the post's own page   after: the box opens under the post
 *   2 the You tab (phone)              before: a menu sheet                      after: your profile, its links on top
 *   3 search (phone)                   before: a page of its own                 after: the box on Members, people and posts
 *   4 change your name (laptop)        before: "Name and bio" sends you to Settings   after: Edit, on the profile
 *   5 invite someone (laptop)          before: "Invites from Settings fill them" after: Invite, by the seat chart
 *   6 Settings (laptop, whole page)    before: 12 sections                       after: what is left
 * Same stack as the other screenshot scripts (see AGENTS.md):
 *   $env:SHOTS='before'; bun scripts/screenshots-fewer-taps.ts   # or without SHOTS for "after"
 * Output: .screenshots/fewer-taps-before/ and .screenshots/fewer-taps-after/
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'fewer-taps-before' : 'fewer-taps-after');
mkdirSync(OUT, { recursive: true });

const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'member@example.com' });

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
  const c = client();
  const raw = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [raw]);
  await c.call('POST', '/auth/join', { code: formatInviteCode(raw), handle, displayName, pin: '739206' });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
async function open(jar: Map<string, string>, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  return p;
}
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };
const must = (ok: unknown, what: string) => { if (!ok) throw new Error(what); };
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 900 };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const rafi = await member('rafi', 'Rafi Haddad', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  await theo.call('PATCH', '/me/portfolio', { headline: 'Illustrator and zine maker', location: 'Kathmandu', skills: ['Illustration', 'Risograph', 'Layout'] });
  await theo.call('PATCH', '/me', { bio: 'Ink on my hands most days.' });
  await theo.call('PUT', '/me/interests', { interests: ['hiking', 'photography'] });
  for (const c of [maya, theo, ines, rafi]) {
    const p = await c.call('POST', '/posts', { body: 'Hello, room.' });
    await t.client.query(`update posts set created_at = now() - interval '2 days' where id = $1`, [p.id]);
  }
  const ridge = await maya.call('POST', '/posts', { body: 'Walked the north ridge at sunrise. Worth the climb.' });
  await rafi.call('POST', '/posts', { body: 'The ridge past the water tank?', parentId: ridge.id });
  const lido = await rafi.call('POST', '/posts', { body: 'Is the lido open late this week? Asking for a friend (me).' });
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 90) where id = $1`, [ridge.id]);
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 10) where id = $1`, [lido.id]);

  // 1 ── reply from the feed, on a phone
  const ph = await open(theo.jar, PHONE);
  await ph.goto(WEB);
  await welcome(ph);
  await ph.locator('.posts article.post').first().waitFor();
  await ph.locator('.posts article.post .post-foot .foot-btn').first().click();
  await ph.waitForTimeout(1200);
  await shot(ph, 'reply-phone');
  if (!BEFORE) {
    // the reply is sent from the feed and you are still in the feed
    await ph.locator('.reply-here textarea').fill('Open till nine, I think.');
    await ph.locator('.reply-here').getByRole('button', { name: 'Reply', exact: true }).click();
    await ph.getByText('Reply sent.').waitFor();
    must(new URL(ph.url()).pathname === '/', 'replying left the feed');
    const thread = await theo.call('GET', `/posts/${lido.id}`);
    must(thread.replies.length === 1 && thread.replies[0].body === 'Open till nine, I think.', 'the reply was not saved');
  }

  // 2 ── the You tab
  await ph.goto(WEB);
  await ph.locator('.posts article.post').first().waitFor();
  await ph.locator('.tabbar .tb-you').click();
  await ph.waitForTimeout(1200);
  await shot(ph, 'you-phone');
  if (!BEFORE) must(new URL(ph.url()).pathname === '/u/theo', 'You did not go to the profile');

  // 3 ── search: the old address, which forwards once the two boxes are one
  await ph.goto(`${WEB}/search?q=ridge`);
  await ph.locator('input[type=search]').first().waitFor();
  await ph.waitForTimeout(1200);
  await shot(ph, 'search-phone', true);
  await ph.close();

  // 4 ── change your name, on a laptop
  const lap = await open(theo.jar, LAPTOP);
  await lap.goto(`${WEB}/u/theo`);
  await welcome(lap);
  await lap.getByRole('heading', { name: 'Theo Brandt' }).waitFor();
  const old = lap.getByRole('link', { name: 'Name and bio' });
  if (await old.count()) await old.click();
  else await lap.locator('.pf-actions button').first().click();
  await lap.waitForTimeout(1200);
  await shot(lap, 'edit-me-laptop');

  // 5 ── invite someone
  await lap.goto(`${WEB}/members`);
  await lap.locator('.seat-chart').waitFor();
  const invite = lap.getByRole('button', { name: /invite someone/i });
  if (await invite.count()) { await invite.first().click(); await lap.locator('.seat-invite .code').waitFor(); }
  await shot(lap, 'invite-laptop');

  // 6 ── Settings, the whole page
  await lap.goto(`${WEB}/settings`);
  await lap.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot(lap, 'settings-laptop', true);

  if (!BEFORE) {
    // 7 ── the rest of what Settings held, on the profile: face, interests, the birthday tag; one Save keeps it all
    await lap.goto(`${WEB}/u/theo?edit=1#interests`);
    const you = lap.locator('.pf-you');
    await you.waitFor();
    await lap.locator('.pf-hero-edit').getByLabel('Name', { exact: true }).fill('Theo B. Brandt');
    await you.getByRole('button', { name: 'Film', exact: true }).click();
    await you.getByLabel('Non-binary').check();
    await you.scrollIntoViewIfNeeded();
    await shot(lap, 'edit-me-face-laptop');
    await lap.getByRole('button', { name: 'Save', exact: true }).click();
    await lap.getByRole('button', { name: 'Edit profile' }).waitFor();
    await lap.getByRole('heading', { name: 'Theo B. Brandt' }).waitFor();
    const me = await theo.call('GET', '/me');
    must(me.displayName === 'Theo B. Brandt', 'the name was not saved');
    must(me.gender === 'nonbinary' || me.gender === 'non_binary' || me.gender === 'non-binary', `the face was not saved: ${me.gender}`);
    must([...me.interests].sort().join() === 'film,hiking,photography', `the interests were not saved: ${me.interests}`);
    // the old Search address forwards, with its words
    await lap.goto(`${WEB}/search?q=ridge`);
    await lap.locator('.posts article.post').first().waitFor();
    must(new URL(lap.url()).pathname === '/members', '/search did not forward to Members');
  }
  await lap.close();

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
