/**
 * UI redesign screenshots (1-bit desktop × zine). In-process API on :3101 with an in-memory DB:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots'; bunx next dev -p 3100
 *   bun scripts/screenshots-ui.ts
 * Output: .screenshots/ui/NN-name.png   (the site has one theme, always light)
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { finishSetup } from './lib/setup';
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'ui');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 3 }); // the 4th member waits for a seat
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

// ── accessibility: axe-core (WCAG 2.1 AA) runs on every screen we capture
const AXE = require.resolve('axe-core/axe.min.js');
type Finding = { id: string; impact: string; help: string; screens: Set<string>; targets: Set<string> };
const a11y = new Map<string, Finding>();
async function audit(page: Page, name: string) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.map((v: { id: string; impact: string; help: string; nodes: { target: string[] }[] }) =>
      ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
  for (const v of violations as { id: string; impact: string; help: string; targets: string[] }[]) {
    const f = a11y.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, screens: new Set(), targets: new Set() };
    f.screens.add(name); v.targets.forEach((t) => f.targets.add(t));
    a11y.set(v.id, f);
  }
}

let n = 0;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  await audit(page, name);
  console.log('saved', file);
}

/** Any uncaught error in any page fails the run (e.g. a React hook-order crash). */
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
  if (waitlisted) return;
  await finishSetup(page);
  await page.getByPlaceholder('What is on your mind?').waitFor();
  // first visit: the welcome window with the house rules
  if (capture) await shot(page, 'welcome', false);
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {}); // the rules now live at the end of setup; the welcome window only shows for members from before
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
  const view = { viewport: { width: 1100, height: 860 } };
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

  // draft autosave: type, reload, the words are still there; welcome stays dismissed
  await maya.getByPlaceholder('What is on your mind?').fill('Half-written thought that must survive a reload');
  await maya.getByText('Draft saved').waitFor();
  await maya.reload();
  await maya.getByPlaceholder('What is on your mind?').waitFor();
  const restored = await maya.getByPlaceholder('What is on your mind?').inputValue();
  if (!restored.startsWith('Half-written')) throw new Error(`draft not restored: "${restored}"`);
  if (await maya.getByRole('button', { name: 'Got it' }).count()) throw new Error('welcome shown twice');
  console.log('draft restored after reload ok; welcome shown once ok');
  await maya.getByPlaceholder('What is on your mind?').fill('');

  await post(maya, 'Found a quiet café on Elm Street. No wifi, no music, just coffee and people reading.\nGo early.', img);

  const theo = await newUser(b);
  await join_(theo, 'theo', 'Theo Park');
  await post(theo, 'Day 3 without an algorithm telling me what to think. I read a whole book. Who am I.');
  await theo.getByRole('button', { name: /^Like \d/ }).last().click();
  await theo.getByRole('link', { name: /repl(y|ies)$/ }).last().click();
  await theo.getByPlaceholder('Write a reply...').fill('Is that the one next to the bookshop? Going Saturday.');
  await theo.getByRole('button', { name: 'Reply', exact: true }).click();
  await theo.getByText('next to the bookshop').waitFor();

  const ines = await newUser(c);
  await join_(ines, 'ines', 'Inês Moreau');
  await post(ines, 'Reminder that the best social network is a dinner table. Hosting one on Friday, see Events.');
  await ines.getByRole('button', { name: /^Like \d/ }).nth(1).click();
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

  // picks from the other members, so the pick window has something to show
  for (const [page, kind, title, note] of [
    [theo, 'movie', 'Perfect Days', 'Watch it alone, late, phone in another room.'],
    [ines, 'food', 'Khao soi at Mae', 'Go on a cold day. Ask for extra pickles.'],
    [theo, 'book', 'Piranesi', null],
    [ines, 'place', 'The lido after 7pm', 'Empty lanes, orange sky.'],
  ] as const) {
    const r = await page.request.post(`${WEB}/api/suggestions`, { data: { kind, title, note } });
    if (!r.ok()) throw new Error(`suggest failed: ${r.status()} ${await r.text()}`);
  }

  // spread the posts over a few days so the feed shows its day headers
  await q(`update posts set created_at = now() - interval '1 day' where body like 'Day 3%'`);
  await q(`update posts set created_at = now() - interval '3 days' where body like 'Reminder%'`);

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

  // image viewer window
  await maya.locator('.post').filter({ hasText: 'Found a quiet café' }).locator('.imgs a').first().click();
  await maya.locator('dialog.viewer[open] img').waitFor();
  await shot(maya, 'image-viewer', false);
  await maya.keyboard.press('Escape');

  // a real delete: menu → alert → tombstone, with no React error
  await post(maya, 'Temporary post, about to delete it.');
  const temp = maya.locator('.post').filter({ hasText: 'Temporary post' });
  await temp.getByRole('button', { name: 'Post actions' }).click();
  await maya.getByRole('menuitem', { name: 'Delete' }).click();
  await maya.locator('dialog[open]').getByRole('button', { name: 'Delete' }).click();
  await maya.getByText('This post was deleted.').waitFor();
  console.log('delete → tombstone ok');

  await maya.locator('.post').filter({ hasText: 'Found a quiet café' }).getByRole('link', { name: /repl(y|ies)$/ }).click();
  await maya.getByText('next to the bookshop').waitFor();
  await shot(maya, 'thread');

  // Maya suggests something through the dialog (1100px: pick window in the left column)
  await maya.locator('.pick-win .pick-title').waitFor();
  await maya.locator('.pick-win').getByRole('button', { name: '+ Suggest' }).click();
  await maya.locator('dialog[open]').getByText('Book', { exact: true }).click();
  await maya.getByLabel('Name it').fill('Stoner, by John Williams');
  await maya.getByLabel('Why? (optional)').fill('A quiet life, told perfectly.');
  await shot(maya, 'suggest-dialog', false);
  await maya.locator('dialog[open]').getByRole('button', { name: 'Suggest', exact: true }).click();
  await maya.locator('.pick-win').getByText('Stoner, by John Williams').waitFor();
  console.log('suggest → shown in pick window ok');

  await maya.goto(`${WEB}/notifications`);
  await maya.getByText(/replied to your post/).waitFor();
  console.log('tab title:', await maya.title());
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
  await maya.goto(`${WEB}/events/new`);
  await maya.getByLabel('Title').fill('Night swim at the lido');
  await maya.getByLabel('Starts').fill('2026-11-21T19:30');
  await maya.getByLabel('Where').fill('Brockwell Lido, gate B');
  await maya.getByLabel(/^Capacity/).fill('8');
  await maya.locator('.poster-preview').getByText('Night swim').waitFor();
  await shot(maya, 'host-event');
  await maya.goto(`${WEB}/this-page-does-not-exist`);
  await maya.getByText('This page left the network').waitFor();
  await shot(maya, 'not-found', false);

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

  // ── Maya gets flagged as a lurker: the seat_at_risk window, then the test checkout
  await q(`update users set state = 'flagged_lurker', lurker_flagged_at = now() - interval '2 days' where handle = 'maya'`);
  await maya.goto(WEB);
  await maya.locator('.win.risk').waitFor();
  await shot(maya, 'lurker-warning', false);
  await maya.locator('.win.risk').getByRole('button', { name: /Pay stay fee/ }).click();
  await maya.waitForURL(/\/dev\/checkout/);
  await maya.getByText('Total').waitFor();
  await shot(maya, 'test-checkout', false);

  await maya.setViewportSize({ width: 390, height: 844 });
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('dinner table').waitFor();
  await shot(maya, 'phone-feed', false);
  // phone: the pick window lives in the feed under the composer; Suggest opens the dialog over it
  await maya.locator('.feed-pick .pick-title').waitFor();
  await maya.locator('.feed-pick').scrollIntoViewIfNeeded();
  await shot(maya, 'phone-pick', false);
  await maya.locator('.feed-pick').getByRole('button', { name: '+ Suggest' }).click();
  await maya.locator('dialog[open]').getByText('Movie', { exact: true }).click();
  await maya.getByLabel('Name it').fill('Paterson');
  await maya.getByLabel('Why? (optional)').fill('A bus driver writes poems. Nothing happens, beautifully.');
  await shot(maya, 'phone-suggest-dialog', false);
  await maya.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  await maya.setViewportSize({ width: 820, height: 1180 });
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('dinner table').waitFor();
  await shot(maya, 'tablet-feed', false);
  await maya.goto(`${WEB}/members`);
  await maya.getByText('Inês Moreau').first().waitFor();
  await shot(maya, 'tablet-members', false);

  // full desktop: menu | feed | side windows
  await maya.setViewportSize({ width: 1440, height: 960 });
  await maya.goto(WEB);
  await maya.locator('.posts').getByText('dinner table').waitFor();
  await maya.locator('.rail-events li').first().waitFor();
  await shot(maya, 'desktop-feed', false);
  await maya.goto(`${WEB}/events`);
  await maya.getByText('Long table dinner').first().waitFor();
  await shot(maya, 'desktop-events', false);
  const wide = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
  await wide.goto(WEB);
  await wide.locator('.hero').waitFor();
  await wide.waitForTimeout(2200); // let the entrance finish
  await shot(wide, 'desktop-landing', false);
  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await anon.goto(WEB);
  await anon.locator('.hero').waitFor();
  await shot(anon, 'phone-landing');
  console.log(`\naccessibility: ${a11y.size} rule(s) violated`);
  for (const f of a11y.values()) {
    console.log(`- [${f.impact}] ${f.id}: ${f.help}\n    screens: ${[...f.screens].join(', ')}\n    e.g. ${[...f.targets].slice(0, 4).join(' | ')}`);
  }
  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('no page errors');
} finally {
  await browser.close();
  server.stop();
}
