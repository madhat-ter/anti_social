/**
 * Milestone 4 (payments, fake Stripe) screenshots: stay fee and reinstatement through the
 * built-in test checkout. Same setup as screenshots-m3.ts (in-process API on :3101, in-memory DB):
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/screenshots-m4.ts
 * Output: .screenshots/m4/NN-name.png
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { JOBS, runJob } from '../apps/api/src/lib/jobs';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'm4');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 2 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const storage = new MemoryStorage();
const payments = new FakeStripeProvider(WEB);
const server = createApp({ db: t.db, storage, payments, cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false } })
  .listen(3101);
const lifecycle = () => runJob(t.db, JOBS.find((j) => j.name === 'lifecycle')!, { storage, payments });

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
  await page.waitForLoadState('networkidle').catch(() => {});
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1100, height: 820 }, colorScheme: 'dark' as const };
  const maya = await newUser(await browser.newContext(view));
  const theo = await newUser(await browser.newContext(view));
  await join_(maya, 'maya', 'Maya Lind');
  await maya.getByPlaceholder('What is on your mind?').fill('Morning walk by the river. Herons everywhere today.');
  await maya.getByRole('button', { name: 'Post', exact: true }).click();
  await join_(theo, 'theo', 'Theo Park');

  // ── Stay fee: Theo is flagged, pays instead of posting
  await q(`update users set activated_at = now() - interval '40 days', last_seen_at = now() where handle = 'theo'`);
  await q(`insert into user_seen_days(user_id, day) select id, current_date - g from users, generate_series(0, 9) g
           where handle = 'theo' on conflict do nothing`);
  await lifecycle();
  await theo.goto(WEB);
  await theo.getByRole('button', { name: /Pay stay fee \(/ }).waitFor();
  await shot(theo, 'lurker-banner-pay-button');
  await theo.getByRole('button', { name: /Pay stay fee \(/ }).click();
  await theo.waitForURL(/\/dev\/checkout\?session=/);
  await theo.getByRole('button', { name: /^Pay / }).waitFor();
  await shot(theo, 'test-checkout-stay-fee');
  await theo.getByRole('button', { name: /^Pay / }).click();
  await theo.getByText('Payment received. Thank you.').waitFor();
  await shot(theo, 'stay-fee-paid-banner-gone');
  await theo.goto(`${WEB}/settings`);
  await theo.getByText(/You are exempt from the posting rule until/).waitFor();
  await theo.getByText('Stay fee (90 days)').waitFor();
  await theo.locator('section[aria-labelledby=pay]').screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-settings-payments.png`) });
  console.log('saved settings-payments');

  // ── Reinstatement: Maya archived for inactivity, rejoins, the freed seat is held, she pays
  await q(`update users set activated_at = now() - interval '60 days', last_seen_at = now() - interval '31 days',
           last_seen_on = current_date - 31 where handle = 'maya'`);
  await lifecycle();
  await maya.goto(WEB);
  await maya.getByRole('button', { name: 'Rejoin the queue' }).click();
  await maya.getByRole('button', { name: /Pay to reinstate \(/ }).waitFor();
  await shot(maya, 'seat-held-pay-button');
  await maya.getByRole('button', { name: /Pay to reinstate \(/ }).click();
  await maya.waitForURL(/\/dev\/checkout\?session=/);
  await maya.getByRole('button', { name: /^Pay / }).waitFor();
  await shot(maya, 'test-checkout-reinstatement');
  await maya.getByRole('button', { name: /^Pay / }).click();
  await maya.getByText('Payment received. Thank you.').waitFor();
  await maya.getByPlaceholder('What is on your mind?').waitFor();
  await shot(maya, 'reinstated-back-in-feed');
  await maya.goto(`${WEB}/notifications`);
  await maya.getByText(/Welcome back/).waitFor();
  await shot(maya, 'reinstated-notification');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
