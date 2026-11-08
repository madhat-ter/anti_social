/**
 * Milestone 5 (events) screenshots: hosting, list, RSVP + waitlist, RSVP-only location,
 * attendance confirmation, promotion notification. Same setup as screenshots-m3.ts (in-process API on :3101, in-memory DB):
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/screenshots-m5.ts
 * Output: .screenshots/m5/NN-name.png
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { finishSetup } from './lib/setup';
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'm5');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 10 });
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
  await finishSetup(page);
  await page.waitForLoadState('networkidle').catch(() => {});
}

const pad = (n: number) => String(n).padStart(2, '0');
/** datetime-local value N days from now at hh:mm local time. */
const localAt = (days: number, hh: number, mm = 0) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hh)}:${pad(mm)}`;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1100, height: 820 }, colorScheme: 'dark' as const };
  const noor = await newUser(await browser.newContext(view));
  const bob = await newUser(await browser.newContext(view));
  const cyd = await newUser(await browser.newContext(view));
  await join_(noor, 'noor', 'Noor Ito');
  await join_(bob, 'bob', 'Bob Reyes');
  await join_(cyd, 'cyd', 'Cyd Moreau');

  // ── Noor hosts a walk through the form
  await noor.goto(`${WEB}/events/new`);
  await noor.getByLabel('Title').fill('Saturday market walk');
  await noor.getByLabel('What is it?').fill('Slow loop through the farmers market, then coffee at the corner place. Bring a bag.');
  await noor.getByLabel('Starts').fill(localAt(3, 9, 30));
  await noor.getByLabel('Ends (optional)').fill(localAt(3, 11, 30));
  await noor.getByLabel('Where').fill('Elm Square fountain');
  await noor.getByLabel('Capacity (empty = no limit)').fill('8');
  await shot(noor, 'host-event-form');
  await noor.getByRole('button', { name: 'Create event' }).click();
  await noor.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  await noor.getByRole('heading', { name: /Saturday market walk/ }).waitFor();
  await shot(noor, 'event-detail-host');
  const walkId = noor.url().split('/').pop()!;

  // ── A small dinner: 1 seat, address only for people going
  await noor.goto(`${WEB}/events/new`);
  await noor.getByLabel('Title').fill('Dumpling night at mine');
  await noor.getByLabel('What is it?').fill('Folding and eating. I have flour, bring a filling.');
  await noor.getByLabel('Starts').fill(localAt(5, 19, 0));
  await noor.getByLabel('Where').fill('14 Birch Lane, flat 3');
  await noor.getByLabel('Only show the location to people who are going').check();
  await noor.getByLabel('Capacity (empty = no limit)').fill('1');
  await noor.getByRole('button', { name: 'Create event' }).click();
  await noor.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  const dinnerId = noor.url().split('/').pop()!;

  // ── Bob browses, takes the only dinner spot and joins the walk
  await bob.goto(`${WEB}/events`);
  await bob.getByText('Dumpling night at mine').waitFor();
  await shot(bob, 'events-list');
  await bob.goto(`${WEB}/events/${dinnerId}`);
  await bob.getByText('The location is shared with people who are going.').waitFor();
  await shot(bob, 'event-location-hidden');
  await bob.getByRole('button', { name: "I'm going" }).click();
  await bob.getByText('14 Birch Lane, flat 3').waitFor();
  await shot(bob, 'event-going-location-shown');
  await bob.goto(`${WEB}/events/${walkId}`);
  await bob.getByRole('button', { name: "I'm going" }).click();
  await bob.getByRole('button', { name: "Can't make it" }).waitFor();

  // ── Cyd: the dinner is full → waitlist
  await cyd.goto(`${WEB}/events/${dinnerId}`);
  await cyd.getByRole('button', { name: 'Join the waitlist' }).click();
  await cyd.getByText(/You are #1 on the waitlist/).waitFor();
  await shot(cyd, 'event-waitlisted');

  // ── Bob drops out → Cyd is promoted and notified
  await bob.goto(`${WEB}/events/${dinnerId}`);
  await bob.getByRole('button', { name: "Can't make it" }).click();
  await bob.getByRole('button', { name: "I'm going" }).or(bob.getByRole('button', { name: 'Join the waitlist' })).waitFor();
  await cyd.goto(`${WEB}/notifications`);
  await cyd.getByText(/A spot opened up/).waitFor();
  await shot(cyd, 'notification-promoted');

  // ── The walk happened: Noor confirms who came
  await q(`update events set starts_at = now() - interval '5 hours', ends_at = null where id = $1`, [walkId]);
  await noor.goto(`${WEB}/events/${walkId}`);
  await noor.getByRole('heading', { name: 'Who came?' }).waitFor();
  await noor.getByLabel(/Bob Reyes/).check();
  await noor.getByRole('button', { name: 'Save attendance' }).click();
  await noor.getByText('Saved.').waitFor();
  await shot(noor, 'attendance-confirmed');

  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.goto(`${WEB}/events?x=1`);
  await bob.getByRole('tab', { name: 'Past' }).click();
  await bob.getByText('Saturday market walk').waitFor();
  await shot(bob, 'events-past-phone');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}