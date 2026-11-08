/**
 * Admin page screenshots. In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-admin.ts
 * Output: .screenshots/admin/NN-name.png
 * Seeds a realistic queue through the real API: a spam post hidden by 5 reports, a post with 2,
 * a project with 1. Then the moderator creates invites, removes the spam, bans its author.
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
import { FakeAuthenticator } from '../apps/api/test/fake-authenticator';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'admin');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

const pageErrors: string[] = [];
async function newUser(ctx: BrowserContext) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(90_000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return page;
}

async function join_(page: Page, handle: string, name: string) {
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(formatInviteCode(code));
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
  await page.getByRole('button', { name: 'Got it' }).waitFor();
  await page.getByRole('button', { name: 'Got it' }).click();
}

/** A member who only talks to the API (no browser): joins with a fake passkey, keeps its session cookie. */
async function apiMember(handle: string, displayName: string) {
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
  return { call, jar };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1280, height: 860 } };

  // ── the moderator joins through the real UI, then gets the ops role (on the live site: OPS_HANDLES)
  const seefCtx = await browser.newContext(view);
  const seef = await newUser(seefCtx);
  await join_(seef, 'seef', 'Seef');
  await q(`update users set role = 'ops' where handle = 'seef'`);

  // ── members and a realistic queue, all through the API
  const maya = await apiMember('maya', 'Maya Lind');
  const theo = await apiMember('theo', 'Theo Park');
  const others = await Promise.all([
    apiMember('juno', 'Juno Reyes'), apiMember('kai', 'Kai Moreno'),
    apiMember('lena', 'Lena Ott'), apiMember('omar', 'Omar Haddad'),
  ]);
  const [juno, kai, lena, omar] = others;
  const spam = await omar!.call('POST', '/posts', { body: 'FREE FOLLOWERS!!! 10k followers for $5, DM me now. Limited offer, only today. Link in bio.' });
  const rant = await theo.call('POST', '/posts', { body: 'Honestly the events page is a mess and whoever planned the last meetup should not plan another one.' });
  const project = await kai!.call('POST', '/me/projects', { title: 'Logo pack', year: 2026, role: 'Designer', summary: 'Twelve logos I made this year.', draft: false });
  const spamReasons = ['Spam', 'Selling followers', 'Same post five times', '', 'Scam link'];
  for (const [i, m] of [maya, theo, juno!, kai!, lena!].entries()) {
    await m.call('POST', `/posts/${spam.id}/flag`, spamReasons[i] ? { reason: spamReasons[i] } : {});
  }
  await juno!.call('POST', `/posts/${rant.id}/flag`, { reason: 'Mean about the organisers' });
  await maya.call('POST', `/posts/${rant.id}/flag`, {});
  await lena!.call('POST', `/projects/${project.id}/flag`, { reason: 'These look copied from a stock site' });

  // ── 1. the Admin page with the queue: hidden spam first, then by report count
  await seef.goto(`${WEB}/admin`);
  await seef.getByRole('heading', { name: 'Reports' }).waitFor();
  await seef.getByText('FREE FOLLOWERS').waitFor();
  const nav = seef.getByRole('navigation', { name: 'Main' });
  if (!(await nav.getByRole('link', { name: 'Admin' }).count())) throw new Error('ops does not see the Admin link');
  await shot(seef, 'admin-queue');

  // ── 2. invite codes
  const inv = seef.locator('section[aria-labelledby=adm-inv]');
  await inv.getByLabel('How many').selectOption('3');
  await inv.getByRole('button', { name: 'Create', exact: true }).click();
  await seef.getByRole('button', { name: 'Copy all' }).waitFor();
  const codes = await seef.locator('.code').allInnerTexts();
  if (codes.length !== 3) throw new Error(`expected 3 codes, got ${codes.length}`);
  const check = await (await fetch('http://localhost:3101/invites/check', { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: JSON.stringify({ code: codes[0] }) })).json();
  if (!check.valid) throw new Error('a created invite code is not valid');
  console.log('created codes are valid ok');
  await seef.locator('section[aria-labelledby=adm-inv]').screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-invites-created.png`) });
  console.log('saved invites-created');

  // ── 2b. open the hidden spam from the queue: admins can review what reports hid
  await seef.locator('.adm-reports > li', { hasText: 'FREE FOLLOWERS' }).getByRole('link', { name: 'Open' }).click();
  await seef.getByText('hidden after reports').waitFor();
  await seef.getByText('FREE FOLLOWERS').waitFor();
  await shot(seef, 'review-hidden-post', false);
  await seef.goto(`${WEB}/admin`);
  await seef.getByText('FREE FOLLOWERS').waitFor();

  // ── 3. remove the spam: the confirmation, then the shorter queue
  const spamRow = seef.locator('.adm-reports > li', { hasText: 'FREE FOLLOWERS' });
  await spamRow.getByRole('button', { name: 'Remove' }).click();
  await seef.locator('dialog[open]').waitFor();
  await shot(seef, 'remove-confirm', false);
  await seef.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
  await seef.getByText('FREE FOLLOWERS').waitFor({ state: 'detached' });
  await shot(seef, 'after-remove');

  // ── 4. members: ban the spammer (and check unban works), make maya an admin, rename theo
  const row = (handle: string) => seef.locator('.adm-members > li', { has: seef.getByText(`@${handle}`, { exact: true }) });
  const membersSec = seef.locator('section#members');
  await membersSec.scrollIntoViewIfNeeded();
  await membersSec.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-members.png`) });
  console.log('saved members');
  await row('omar').getByRole('button', { name: 'Ban' }).click();
  await seef.locator('dialog[open]').waitFor();
  await shot(seef, 'ban-confirm', false);
  await seef.locator('dialog[open]').getByRole('button', { name: 'Ban' }).click();
  await seef.getByText('@omar is banned.').waitFor();
  const stateOf = async (h: string) => ((await q(`select state, role from users where handle = $1`, [h])).rows[0] as { state: string; role: string });
  if ((await stateOf('omar')).state !== 'banned') throw new Error('omar was not banned');
  await row('omar').getByRole('button', { name: 'Unban' }).waitFor();
  await row('omar').getByRole('button', { name: 'Unban' }).click();
  await seef.locator('dialog[open]').getByRole('button', { name: 'Unban' }).click();
  await seef.getByText('@omar is back, with a seat.').waitFor();
  if ((await stateOf('omar')).state !== 'active') throw new Error('omar was not unbanned');
  await row('omar').getByRole('button', { name: 'Ban' }).click(); // the spammer goes again
  await seef.locator('dialog[open]').getByRole('button', { name: 'Ban' }).click();
  await seef.getByText('@omar is banned.').waitFor();
  console.log('ban, unban, ban through the UI ok');

  await row('maya').getByRole('button', { name: 'Make admin' }).click();
  await seef.locator('dialog[open]').getByRole('button', { name: 'Make admin' }).click();
  await seef.getByText('@maya is now an admin.').waitFor();
  if ((await stateOf('maya')).role !== 'ops') throw new Error('maya is not an admin');

  await row('theo').getByRole('button', { name: 'Change handle' }).click();
  const dlg = seef.locator('dialog[open]');
  await dlg.getByLabel('New handle').fill('theo_park');
  await shot(seef, 'rename-dialog', false);
  await dlg.getByRole('button', { name: 'Change' }).click();
  await seef.getByText('@theo is now @theo_park.').waitFor();
  if (!(await q(`select 1 from users where handle = 'theo_park'`)).rows.length) throw new Error('theo was not renamed');
  console.log('make admin and rename through the UI ok');
  await membersSec.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-members-after.png`) });
  console.log('saved members-after');

  // ── 5. the room's settings: the seat chart follows the cap
  const room = seef.locator('section[aria-labelledby=adm-room]');
  await room.getByLabel('Seats in the room').fill('50');
  await room.getByRole('button', { name: 'Save' }).click();
  await room.getByText('Saved.').waitFor();
  await room.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-community.png`) });
  console.log('saved community');
  await seef.goto(`${WEB}/members`);
  await seef.getByText(/of 50 seats taken/).waitFor();
  console.log('seat chart reads the new cap ok');

  // ── 6. remove someone's post straight from the feed; your own posts carry the admin tag
  await maya.call('POST', '/posts', { body: 'Anyone up for a hike on Saturday? Leaving at 7 from the north gate.' });
  await seef.goto(WEB);
  await seef.getByPlaceholder('What is on your mind?').fill('Welcome, everyone. Be kind, post often, report anything that feels off.');
  await seef.getByRole('button', { name: 'Post', exact: true }).click();
  const feed = seef.locator('.posts');
  await feed.getByText('Welcome, everyone').waitFor();
  const theoPost = feed.locator('article.post', { hasText: 'events page is a mess' });
  await theoPost.getByRole('button', { name: 'Post actions' }).click();
  await theoPost.getByRole('menuitem', { name: 'Remove (admin)' }).waitFor();
  await shot(seef, 'feed-admin-menu', false);
  await theoPost.getByRole('menuitem', { name: 'Remove (admin)' }).click();
  await seef.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
  await feed.getByText('events page is a mess').waitFor({ state: 'detached' });
  console.log('removed a post from the feed ok');

  // ── 7. remove a project from its page
  await seef.goto(`${WEB}/u/kai/work/${project.id}`);
  await seef.getByRole('button', { name: 'Remove (admin)' }).waitFor();
  await shot(seef, 'project-admin', false);
  await seef.getByRole('button', { name: 'Remove (admin)' }).click();
  await seef.locator('dialog[open]').getByRole('button', { name: 'Remove' }).click();
  await seef.waitForURL(`${WEB}/u/kai`);
  if ((await q(`select 1 from projects where id = $1`, [project.id])).rows.length) throw new Error('project still there');
  console.log('removed a project from its page ok');

  // ── 8. the renamed member is told (and that their post was removed)
  const theoCtx = await browser.newContext(view);
  await theoCtx.addCookies([...theo.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const tp = await theoCtx.newPage();
  tp.on('pageerror', (e) => pageErrors.push(`${tp.url()}: ${e.message}`));
  await tp.goto(`${WEB}/notifications`);
  await tp.getByText('An admin changed your handle to @theo_park').waitFor();
  await tp.getByText('An admin removed one of your posts.').waitFor();
  await shot(tp, 'renamed-member-notifications', false);
  // ── 9. the moderator's notification links to the Admin page
  await seef.goto(`${WEB}/notifications`);
  const note = seef.getByRole('link', { name: /needs review in Admin/ });
  await note.waitFor();
  if ((await note.getAttribute('href')) !== '/admin') throw new Error('notification does not link to /admin');
  await shot(seef, 'notification', false);

  // ── 10. a member (not maya: she is an admin now) sees no Admin link, and /admin says Not found
  const memberCtx = await browser.newContext(view);
  await memberCtx.addCookies([...juno!.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const mp = await memberCtx.newPage();
  mp.on('pageerror', (e) => pageErrors.push(`${mp.url()}: ${e.message}`));
  await mp.goto(`${WEB}/admin`);
  await mp.getByText('Not found.').waitFor();
  if (await mp.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Admin' }).count()) throw new Error('a member sees the Admin link');
  const opsApi = await mp.request.get(`${WEB}/api/ops/flags`);
  if (opsApi.status() !== 404) throw new Error(`member got ${opsApi.status()} from /ops/flags`);
  console.log('member: no Admin link, page and API say not found ok');
  await shot(mp, 'member-view', false);

  // ── 11. phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(await seefCtx.cookies());
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => pageErrors.push(`${ph.url()}: ${e.message}`));
  await ph.goto(`${WEB}/admin`);
  await ph.getByRole('heading', { name: 'Reports' }).waitFor();
  await shot(ph, 'phone');
  await phone.close();

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
