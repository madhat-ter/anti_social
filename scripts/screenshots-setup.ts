/**
 * Setup (RFC §10.3) screenshots. In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-setup.ts
 * Output: .screenshots/setup/NN-name.png
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'setup');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 10 });
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
const elShot = async (page: Page, selector: string, name: string) => {
  await page.locator(selector).first().screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
  console.log('saved', name);
};

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

/** Joins through the real UI and stops where every new member lands now: the setup page. */
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
  await page.getByRole('heading', { name: 'Set up your profile' }).waitFor();
}

/** A member who only talks to the API: joins with a fake passkey and finishes setup with this gender. */
async function apiMember(handle: string, displayName: string, gender: string) {
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
  await call('PUT', '/me/setup', { about: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '), gender, birthday: '1994-08-09' });
  return call;
}

const ABOUT = 'I design small objects that get used every day: lamps, tools, the things on a kitchen table. '
  + 'I start with a pencil and end with a prototype I can hold. Before design I studied mechanical engineering, '
  + 'which is why my sketches have tolerances written in the margins. I came here because a friend promised '
  + 'a room where people actually talk, and meet up now and then. Ask me about bikes, bread, or bad typefaces.';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1280, height: 860 } };

  // ── 1. the faces, without a gender (the originals) and per gender
  const sheet = await browser.newPage(view);
  sheet.on('pageerror', (e) => pageErrors.push(`faces: ${e.message}`));
  await sheet.goto(`${WEB}/dev/faces`);
  await sheet.getByRole('heading', { name: 'Faces' }).waitFor();
  await shot(sheet, 'faces');
  await sheet.close();

  // ── 2. a new member lands on setup; nothing else opens until it is done
  const nova = await newUser(await browser.newContext(view));
  await join_(nova, 'nova', 'Nova Lind');
  await shot(nova, 'setup-empty');
  await nova.goto(`${WEB}/members`);
  await nova.getByRole('heading', { name: 'Set up your profile' }).waitFor();
  if (!nova.url().endsWith('/setup')) throw new Error(`members did not redirect to setup: ${nova.url()}`);
  console.log('locked until setup ok');

  // ── 3. filling it in: the counter, the face redrawing per gender, the birthday
  await nova.locator('#su-about-text').fill(ABOUT.split(' ').slice(0, 30).join(' '));
  await nova.getByText('30 / 50–300 words · 20 to go').waitFor();
  await nova.getByLabel('Man', { exact: true }).check();
  await elShot(nova, 'section[aria-labelledby=su-gender]', 'gender-man');
  await nova.getByLabel('Woman', { exact: true }).check();
  await elShot(nova, 'section[aria-labelledby=su-gender]', 'gender-woman');
  await nova.locator('#su-about-text').fill(ABOUT);
  await nova.getByLabel('Your birthday', { exact: true }).fill('2001-03-17');
  await shot(nova, 'setup-filled');
  await nova.getByRole('button', { name: 'Done' }).click();
  await nova.getByPlaceholder('What is on your mind?').waitFor();
  const row = (await q(`select gender, birthday::text as b, setup_done_at is not null as done from users where handle = 'nova'`)).rows[0] as any;
  if (row.gender !== 'woman' || row.b !== '2001-03-17' || !row.done) throw new Error(`setup not saved: ${JSON.stringify(row)}`);
  const about = (await q(`select about from portfolios p join users u on u.id = p.user_id where u.handle = 'nova'`)).rows[0] as any;
  if (about.about !== ABOUT) throw new Error('About was not saved to the portfolio');
  console.log('setup saved ok');
  await shot(nova, 'feed-after-setup', false);
  await nova.getByRole('button', { name: 'Got it' }).click();

  // ── 3b. the checklist takes the welcome's place; items tick themselves as they get done
  await nova.getByRole('heading', { name: 'Finish your profile' }).waitFor();
  await nova.getByText('0 of 6 done').waitFor();
  await shot(nova, 'checklist', false);
  await nova.getByRole('button', { name: 'Write a first post' }).click();
  await nova.keyboard.type('Hello everyone. Just set up my profile, it asked good questions.');
  await nova.getByRole('button', { name: 'Post', exact: true }).click();
  await nova.getByText('1 of 6 done').waitFor();
  await nova.getByRole('button', { name: 'Suggest a pick' }).click();
  const sug = nova.locator('dialog[open]');
  await sug.getByText('Book', { exact: true }).click();
  await sug.getByLabel('Name it').fill('The Design of Everyday Things');
  await sug.getByRole('button', { name: 'Suggest', exact: true }).click();
  await nova.getByText('2 of 6 done').waitFor();
  await nova.locator('aside.checklist').screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-checklist-ticked.png`) });
  console.log('saved checklist-ticked');
  await nova.locator('aside.checklist').getByRole('button', { name: 'Hide this' }).click();
  await nova.reload();
  await nova.getByPlaceholder('What is on your mind?').waitFor();
  await nova.waitForTimeout(800);
  if (await nova.getByRole('heading', { name: 'Finish your profile' }).count()) throw new Error('the checklist came back after hiding it');
  console.log('checklist ticks and stays hidden ok');

  // ── 4. the About editor in the portfolio counts words too
  await nova.goto(`${WEB}/u/nova`);
  await nova.getByRole('button', { name: 'Edit portfolio' }).click();
  await nova.getByText(/\d+ \/ 50–300 words/).waitFor();
  await elShot(nova, '.pf-sec:has(textarea)', 'about-editor');

  // ── 5. under 13: asked first, then closed
  const kid = await newUser(await browser.newContext(view));
  await join_(kid, 'kiddo', 'Kid');
  await kid.locator('#su-about-text').fill(ABOUT);
  await kid.getByLabel('Prefer not to say').check();
  await kid.getByLabel('Your birthday', { exact: true }).fill(`${new Date().getFullYear() - 11}-06-01`);
  await kid.getByRole('button', { name: 'Done' }).click();
  await kid.locator('dialog[open]').waitFor();
  await shot(kid, 'underage-confirm', false);
  await kid.locator('dialog[open]').getByRole('button', { name: 'Yes, close my account' }).click();
  await kid.getByRole('heading', { name: 'Account closed' }).waitFor();
  await shot(kid, 'account-closed', false);
  const kidState = (await q(`select count(*)::int as n from users where state = 'deleted'`)).rows[0] as any;
  if (kidState.n !== 1) throw new Error('the account was not closed');
  console.log('under 13: asked, then closed ok');

  // ── 5b. everyone's face follows their gender: the feed, the member list
  const ben = await apiMember('ben', 'Ben Ortiz', 'man');
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman');
  const sam = await apiMember('sam', 'Sam Reed', 'nonbinary');
  await ben('POST', '/posts', { body: 'Bread experiment number four: the crust finally cracks. Who wants a slice on Saturday?' });
  await ivy('POST', '/posts', { body: 'Found a 1970s drafting table on the street. It is now my whole personality.' });
  await sam('POST', '/posts', { body: 'Reminder that the north gate meetup moved to 8, not 7.' });
  await nova.goto(WEB);
  await nova.locator('.posts').getByText('north gate meetup').waitFor();
  await shot(nova, 'feed-faces', false);
  await nova.goto(`${WEB}/members`);
  await nova.getByText('Ivy Chen').first().waitFor();
  await shot(nova, 'members-faces', false);

  // ── 5c. Settings: the face can change any time
  await nova.goto(`${WEB}/settings`);
  const face = nova.locator('section[aria-labelledby=face]');
  await face.getByLabel('Non-binary').check();
  await face.getByText('Saved. Your face is redrawn everywhere.').waitFor();
  await face.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-settings-face.png`) });
  console.log('saved settings-face');
  if (((await q(`select gender from users where handle = 'nova'`)).rows[0] as any).gender !== 'nonbinary') throw new Error('gender change not saved');
  await face.getByLabel('Woman', { exact: true }).check();
  await face.getByText('Saved. Your face is redrawn everywhere.').waitFor();

  // ── 6. phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pip = await newUser(phone);
  await join_(pip, 'pip', 'Pip');
  await pip.getByLabel('Non-binary').check();
  await shot(pip, 'phone-setup');

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
