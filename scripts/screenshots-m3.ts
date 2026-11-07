/**
 * Milestone 3 (lifecycle) screenshots: waitlist, lurker banner, archival, rejoin, seat offer.
 *
 * Self-contained: runs the API in-process on an in-memory PGlite DB (port 3101, seat cap 2) and
 * moves accounts through the lifecycle with SQL + run_lifecycle, the same job the scheduler runs.
 * Needs only the web app pointed at it:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; bunx next dev -p 3100
 *   bun scripts/screenshots-m3.ts
 * Output: .screenshots/m3/NN-name.png
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

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const API_PORT = 3101;
const OUT = join(import.meta.dir, '..', '.screenshots', 'm3');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 2 });
const db = t.db;
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const storage = new MemoryStorage();
const server = createApp({ db, storage, cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false } })
  .listen(API_PORT);
const lifecycle = () => runJob(db, JOBS.find((j) => j.name === 'lifecycle')!, { storage });
const mint = async () => {
  const c = generateInviteCode();
  await q('select create_invite(null, $1)', [c]);
  return formatInviteCode(c);
};

const T = 90_000;
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

async function join_(page: Page, handle: string, name: string) {
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(await mint());
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle (permanent)').fill(handle);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function post(page: Page, body: string) {
  await page.getByPlaceholder('What is on your mind?').fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('.posts').getByText(body.slice(0, 20)).waitFor();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1100, height: 820 }, colorScheme: 'dark' as const };
  const ctx = async () => newUser(await browser.newContext(view));
  const maya = await ctx(), theo = await ctx(), mira = await ctx(), ben = await ctx();

  // ── Two seats: Maya and Theo take them; Mira and Ben queue
  await join_(maya, 'maya', 'Maya Lind');
  await post(maya, 'Morning walk by the river. Herons everywhere today.');
  await join_(theo, 'theo', 'Theo Park');
  await join_(mira, 'mira', 'Mira Okafor');
  await mira.getByText('You are on the waitlist').waitFor();
  await join_(ben, 'ben', 'Ben Hale');
  await ben.getByText('You are on the waitlist').waitFor();
  await shot(ben, 'waitlisted-position');

  // ── Theo reads every day for weeks but never posts → flagged on the hourly run
  await q(`update users set activated_at = now() - interval '40 days', last_seen_at = now() where handle = 'theo'`);
  await q(`insert into user_seen_days(user_id, day)
    select id, current_date - g from users, generate_series(0, 9) g where handle = 'theo' on conflict do nothing`);
  await lifecycle();
  await theo.goto(WEB);
  await theo.getByText('Your seat is at risk.').waitFor();
  await shot(theo, 'lurker-banner');
  await post(theo, 'Fair point, I have been lurking. Hello everyone.');
  await theo.getByText('1 of 2').waitFor();
  await shot(theo, 'lurker-banner-progress');
  await theo.goto(`${WEB}/members`);
  await theo.getByText('Maya Lind').first().waitFor();
  await shot(theo, 'lurker-banner-other-page');

  // ── Maya disappears for 31 days → archived; Mira (first in line) is seated
  await q(`update users set activated_at = now() - interval '60 days',
    last_seen_at = now() - interval '31 days', last_seen_on = current_date - 31 where handle = 'maya'`);
  await lifecycle();
  await maya.goto(WEB);
  await maya.getByText('Your seat was released').waitFor();
  await shot(maya, 'archived-inactive');
  await mira.goto(WEB);
  await mira.getByPlaceholder('What is on your mind?').waitFor();
  await mira.goto(`${WEB}/notifications`);
  await mira.getByText('You have a seat. Welcome in.').waitFor();
  await shot(mira, 'promoted-notification');

  // ── Maya rejoins (free) and jumps ahead of Ben
  await maya.getByRole('button', { name: 'Rejoin the queue' }).click();
  await maya.getByText('in the queue').waitFor();
  await shot(maya, 'archived-rejoined-queue');
  await ben.goto(WEB);
  await ben.getByText('You are on the waitlist').waitFor();

  // ── Theo's grace runs out → archived; the freed seat is held for Maya for 72 h
  await q(`update users set lurker_flagged_at = now() - interval '8 days' where handle = 'theo'`);
  await lifecycle();
  await theo.goto(WEB);
  await theo.getByText('Your seat was released').waitFor();
  await shot(theo, 'archived-lurker');
  await maya.goto(WEB);
  await maya.getByText('A seat is being held for you').waitFor();
  await shot(maya, 'seat-offer');

  await maya.setViewportSize({ width: 390, height: 844 });
  await maya.reload();
  await maya.getByText('A seat is being held for you').waitFor();
  await shot(maya, 'seat-offer-phone');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
