/**
 * UI redesign screenshots (1-bit desktop × zine). In-process API on :3101 with an in-memory DB:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/screenshots-ui.ts            (SCHEME=dark for the dark theme)
 * Output: .screenshots/ui-<scheme>/NN-name.png
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const SCHEME = (process.env.SCHEME === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
const OUT = join(import.meta.dir, '..', '.screenshots', `ui-${SCHEME}`);
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 3 }); // the 4th member waits for a seat
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

async function newUser(ctx: BrowserContext) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return page;
}

async function join_(page: Page, handle: string, name: string, capture = false, waitlisted = false) {
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(formatInviteCode(code));
  if (capture) await shot(page, 'join-code', false);
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await page.getByLabel('Display name').fill(name);
  if (capture) await shot(page, 'join-this-is-you', false);
  await page.getByRole('button', { name: 'Continue' }).click();
  if (capture) { await page.getByRole('button', { name: 'Create passkey' }).waitFor(); await shot(page, 'join-passkey', false); }
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  if (capture) await shot(page, 'join-recovery-code', false);
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  if (!waitlisted) await page.getByPlaceholder('What is on your mind?').waitFor();
}

async function post(page: Page, text: string, image?: string) {
  await page.getByPlaceholder('What is on your mind?').fill(text);
  if (image) {
    await page.locator('input[type=file]').first().setInputFiles(image);
    await page.waitForFunction(() => document.querySelector('.thumbs img') && !document.querySelector('.thumbs .spinner'));
  }
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('.posts').getByText(text.slice(0, 20)).first().waitFor();
}

async function makeImage(ctx: BrowserContext, file: string) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 800 });
  await p.setContent(`<body style="margin:0"><div style="width:1200px;height:800px;background:#131313;position:relative;overflow:hidden;
    font-family:Impact,sans-serif;color:#f2efe8">
    <div style="position:absolute;left:640px;top:120px;width:420px;height:420px;border-radius:50%;background:#e5432a"></div>
    <div style="position:absolute;left:70px;top:90px;font-size:210px;line-height:.82;text-transform:uppercase">Saturday<br>market</div>
    <div style="position:absolute;left:76px;bottom:70px;font:700 34px monospace;letter-spacing:4px">ELM ST · 7AM · BRING A BAG</div>
  </div></body>`);
  writeFileSync(file, await p.screenshot());
  await p.close();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1100, height: 860 }, colorScheme: SCHEME };
  const a = await browser.newContext(view);
  const b = await browser.newContext(view);
  const c = await browser.newContext(view);
  const img = join(OUT, '_upload.png');
  await makeImage(a, img);

  const maya = await newUser(a);
  await maya.goto(WEB);
  await maya.locator('.hero').waitFor();
  await shot(maya, 'landing');
  await join_(maya, 'maya', 'Maya Lind', true);
  await shot(maya, 'empty-feed', false);

  await post(maya, 'Found a quiet café on Elm Street. No wifi, no music, just coffee and people reading.\nGo early.', img);

  const theo = await newUser(b);
  await join_(theo, 'theo', 'Theo Park');
  await post(theo, 'Day 3 without an algorithm telling me what to think. I read a whole book. Who am I.');
  await theo.getByRole('button', { name: /^Like \(/ }).last().click();
  await theo.getByRole('link', { name: /repl(y|ies)$/ }).last().click();
  await theo.getByPlaceholder('Write a reply...').fill('Is that the one next to the bookshop? Going Saturday.');
  await theo.getByRole('button', { name: 'Reply', exact: true }).click();
  await theo.getByText('next to the bookshop').waitFor();

  const ines = await newUser(c);
  await join_(ines, 'ines', 'Inês Moreau');
  await post(ines, 'Reminder that the best social network is a dinner table. Hosting one on Friday, see Events.');
  await ines.getByRole('button', { name: /^Like \(/ }).nth(1).click();
  await ines.request.post(`${WEB}/api/events`, {
    data: {
      title: 'Long table dinner', description: 'Bring one dish and one story. Phones in a basket.',
      startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), endsAt: null,
      location: 'The back room at Ottolenghi, Elm St', locationRsvpOnly: true, capacity: 12, priceNote: null, externalPaymentUrl: null,
    },
  });
  await theo.request.post(`${WEB}/api/events`, {
    data: {
      title: 'Silent book club', description: 'One hour of reading together, then talk if you want.',
      startsAt: new Date(Date.now() + 9 * 864e5).toISOString(), endsAt: null,
      location: 'Elm Street café', locationRsvpOnly: false, capacity: null, priceNote: null, externalPaymentUrl: null,
    },
  });

  // ── Maya's view
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('dinner table').waitFor();
  await shot(maya, 'feed');
  await shot(maya, 'feed-fold', false);
  await maya.locator('.post').filter({ hasText: 'Found a quiet café' }).getByRole('button', { name: 'Post actions' }).click();
  await shot(maya, 'post-menu', false);
  await maya.getByRole('menuitem', { name: 'Delete' }).click();
  await maya.locator('dialog[open]').waitFor();
  await shot(maya, 'delete-dialog', false);
  await maya.getByRole('button', { name: 'Cancel' }).click();

  await maya.locator('.post').filter({ hasText: 'Found a quiet café' }).getByRole('link', { name: /repl(y|ies)$/ }).click();
  await maya.getByText('next to the bookshop').waitFor();
  await shot(maya, 'thread');

  await maya.goto(`${WEB}/notifications`);
  await maya.getByText(/replied to your post/).waitFor();
  await shot(maya, 'notifications');
  await maya.goto(`${WEB}/members`);
  await maya.getByText('Inês Moreau').first().waitFor();
  await shot(maya, 'members');
  await maya.goto(`${WEB}/u/theo`);
  await maya.getByText('@theo').first().waitFor();
  await shot(maya, 'profile');
  await maya.goto(`${WEB}/events`);
  await maya.getByText('Long table dinner').first().waitFor();
  await shot(maya, 'events');
  await maya.getByText('Long table dinner').first().click();
  await maya.getByRole('heading', { name: /Long table dinner/i }).waitFor();
  await maya.getByRole('button', { name: "I'm going" }).click();
  await maya.locator('.crowd').waitFor();
  await shot(maya, 'event-detail');
  await maya.goto(`${WEB}/search?q=coffee`);
  await maya.locator('.posts').getByText('quiet café').waitFor();
  await shot(maya, 'search');
  await maya.goto(`${WEB}/settings`);
  await maya.getByRole('button', { name: 'Create invite' }).waitFor();
  await shot(maya, 'settings');

  // ── a fourth person arrives: all 3 seats are taken, so they wait
  const pat = await newUser(await browser.newContext(view));
  await join_(pat, 'pat_in_line', 'Pat Okafor', false, true);
  await pat.getByText('in line').waitFor();
  await shot(pat, 'waitlist');

  // ── signed-out screens
  const out = await (await browser.newContext(view)).newPage();
  await out.goto(`${WEB}/login`);
  await out.getByRole('button', { name: 'Sign in with passkey' }).waitFor();
  await shot(out, 'sign-in', false);
  await out.goto(`${WEB}/recover`);
  await out.getByRole('button', { name: 'Recover and create passkey' }).waitFor();
  await shot(out, 'recover', false);

  await maya.setViewportSize({ width: 390, height: 844 });
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('dinner table').waitFor();
  await shot(maya, 'phone-feed', false);
  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: SCHEME })).newPage();
  await anon.goto(WEB);
  await anon.locator('.hero').waitFor();
  await shot(anon, 'phone-landing');
} finally {
  await browser.close();
  server.stop();
}
