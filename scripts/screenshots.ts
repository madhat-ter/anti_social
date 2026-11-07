/**
 * UI walkthrough screenshots. Drives the locally installed Chrome (no browser download) with a
 * virtual WebAuthn authenticator, so the real passkey sign-up runs without a fingerprint/PIN.
 *
 * Expects a throwaway stack (see scripts/screenshots.ps1): web on WEB_URL, API with DATABASE_URL.
 *   bun scripts/screenshots.ts
 * Output: .screenshots/NN-name.png
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots');
const CODES = (process.env.INVITE_CODES ?? '').split(',').filter(Boolean);
if (CODES.length < 2) throw new Error('INVITE_CODES must hold at least 2 comma-separated codes');
mkdirSync(OUT, { recursive: true });

const T = 90_000; // first compile of each route under `next dev` is slow
let n = 0;
async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('saved', file);
}

async function newUser(ctx: BrowserContext) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  return page;
}

async function join_(page: Page, code: string, handle: string, name: string, capture: boolean) {
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code);
  if (capture) await shot(page, 'join-invite-code');
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await page.getByLabel('Display name').fill(name);
  if (capture) await shot(page, 'join-handle');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create passkey' }).waitFor();
  if (capture) await shot(page, 'join-passkey');
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  if (capture) await shot(page, 'join-recovery-code');
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
}

async function makeImage(ctx: BrowserContext, file: string) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 800 });
  await p.setContent(`<body style="margin:0"><div style="width:1200px;height:800px;
    background:linear-gradient(160deg,#f6d365 0%,#fda085 45%,#6a5acd 100%);
    display:flex;align-items:flex-end;padding:48px;box-sizing:border-box;font:600 56px system-ui;color:#fff">
    Saturday market, 7am</div></body>`);
  writeFileSync(file, await p.screenshot());
  await p.close();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1100, height: 820 }, colorScheme: 'dark' as const };
  const a = await browser.newContext(view);
  const b = await browser.newContext(view);
  const img = join(OUT, '_upload.png');
  await makeImage(a, img);

  // ── Maya: landing → join → empty feed
  const maya = await newUser(a);
  await maya.goto(WEB);
  await maya.getByText('A small, quiet network.').waitFor();
  await shot(maya, 'landing');
  await join_(maya, CODES[0]!, 'maya', 'Maya Lind', true);
  await shot(maya, 'empty-feed');

  // ── Maya writes a post with an image
  await maya.getByPlaceholder('What is on your mind?').fill(
    'Found a quiet café on Elm Street. No wifi, no music, just coffee and people reading.\nHighly recommend going early.',
  );
  await maya.locator('input[type=file]').first().setInputFiles(img);
  await maya.locator('.thumbs img').first().waitFor();
  await maya.waitForFunction(() => !document.querySelector('.thumbs .spinner'));
  await shot(maya, 'composing-with-image');
  await maya.getByRole('button', { name: 'Post', exact: true }).click();
  await maya.locator('.posts').getByText('Found a quiet café').waitFor();
  await shot(maya, 'feed-with-post');

  // ── Theo joins, likes, replies, posts
  const theo = await newUser(b);
  await join_(theo, CODES[1]!, 'theo', 'Theo Park', false);
  await theo.getByRole('button', { name: /^Like \d/ }).first().click();
  await theo.getByRole('link', { name: /repl(y|ies)$/ }).first().click();
  await theo.getByPlaceholder('Write a reply...').fill('Is that the one next to the bookshop? Going Saturday.');
  await theo.getByRole('button', { name: 'Reply', exact: true }).click();
  await theo.getByText('next to the bookshop').waitFor();
  await shot(theo, 'thread-with-reply');
  await theo.goto(WEB);
  await theo.getByPlaceholder('What is on your mind?').fill('First post here. Nice that there is no algorithm deciding what I see.');
  await theo.getByRole('button', { name: 'Post', exact: true }).click();
  await theo.locator('.posts').getByText('First post here').waitFor();

  // ── Maya sees the activity
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('First post here').waitFor();
  await shot(maya, 'feed-two-members-unread-badge');
  await maya.goto(`${WEB}/notifications`);
  await maya.getByText(/replied to your post/).waitFor();
  await shot(maya, 'notifications');
  await maya.goto(`${WEB}/u/maya`);
  await maya.getByText('@maya').first().waitFor();
  await shot(maya, 'profile');
  await maya.goto(`${WEB}/members`);
  await maya.getByText('Theo Park').first().waitFor();
  await shot(maya, 'members');
  await maya.goto(`${WEB}/search?q=coffee`); // deep link: exercises reading ?q= on load
  await maya.locator('.posts').getByText('Found a quiet café').waitFor();
  await shot(maya, 'search');
  await maya.goto(`${WEB}/settings`);
  await maya.getByRole('button', { name: 'Create invite' }).click();
  await maya.getByRole('button', { name: 'Hide' }).waitFor();
  await shot(maya, 'settings-new-invite');

  // ── Phone width
  await maya.setViewportSize({ width: 390, height: 844 });
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('First post here').waitFor();
  await shot(maya, 'feed-phone');
} finally {
  await browser.close();
}
