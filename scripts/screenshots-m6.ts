/**
 * Milestone 6 (hardening) screenshots: reporting a post, push toggle in Settings. Same setup as screenshots-m3.ts (in-process API on :3101, in-memory DB):
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/screenshots-m6.ts
 * Output: .screenshots/m6/NN-name.png
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
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'm6');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 10 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const storage = new MemoryStorage();
const payments = new FakeStripeProvider(WEB);
const server = createApp({ db: t.db, storage, payments, push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'), cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false } })
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
  await maya.getByPlaceholder('What is on your mind?').fill('Hot take: pineapple belongs on everything.');
  await maya.getByRole('button', { name: 'Post', exact: true }).click();
  await maya.locator('.posts').getByText('Hot take').waitFor();
  await join_(theo, 'theo', 'Theo Park');

  // ── Theo reports Maya's post from the post menu
  await theo.goto(WEB);
  await theo.locator('.posts').getByText('Hot take').waitFor();
  await theo.getByRole('button', { name: 'Post actions' }).first().click();
  await theo.getByRole('menuitem', { name: 'Report' }).waitFor();
  await shot(theo, 'post-menu-report');
  theo.once('dialog', (d) => d.accept('Spam, posted the same thing five times'));
  await theo.getByRole('menuitem', { name: 'Report' }).click();
  await theo.getByText('Reported. Thanks, a moderator will take a look.').waitFor();
  await shot(theo, 'post-reported');

  // ── Settings: push toggle (server has VAPID configured)
  await theo.goto(`${WEB}/settings`);
  await theo.getByRole('heading', { name: 'Notifications on this device' }).waitFor();
  await theo.getByRole('button', { name: 'Turn on' }).or(theo.getByText(/not support|blocked/)).waitFor();
  await theo.locator('section[aria-labelledby=push]').screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-settings-push.png`) });
  console.log('saved settings-push');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}