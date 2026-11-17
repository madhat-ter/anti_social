/**
 * Consulting approval (RFC §10.18) screenshots, before and after the same scenes.
 *
 * The "before" is produced by the code that was there before the rule: an offer switched on goes
 * live, there is no queue. The "after" is the same database and the same clicks, with this change.
 * Rather than switching source trees, both are captured here from one run of the *current* code by
 * reloading with the gate arranged the way each name implies:
 *
 *   before  an active offer with no approval  →  lives at  /members/ana  (Book a consultation)
 *   after   the same offer, waiting           →  /consultations?tab=offer shows "waiting"
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md). Nothing touches the real database.
 *
 *   bun scripts/screenshots-consult-approval.ts          → .screenshots/consult-approval-after/
 *   bun scripts/screenshots-consult-approval.ts --before  → .screenshots/consult-approval-before/
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

const BEFORE = process.argv.includes('--before');
const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'consult-approval-before' : 'consult-approval-after');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
const file = (name: string) => join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
const AXE = require.resolve('axe-core/axe.min.js');
const a11y: string[] = [];
async function audit(page: Page, name: string) {
  await page.addScriptTag({ path: AXE });
  const v = await page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.map((x: { id: string; help: string; nodes: { target: string[] }[] }) => `${x.id}: ${x.help} @ ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
  });
  for (const x of v as string[]) a11y.push(`${name}: ${x}`);
}
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: file(name), fullPage });
  await audit(page, name);
  console.log('saved', name);
}
const pageErrors: string[] = [];
const ABOUT = 'I design furniture and small objects for a studio in Patan, mostly in wood and steel. Before that I spent four years in a product team shipping kitchen tools. I like helping people early in their careers put a portfolio together, pick projects that show how they think, and prepare for the first interviews. Ask me about sketching, prototyping and how studios hire.';

async function apiJoin(handle: string, displayName: string, gender: string) {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) { const [k, ...v] = sc.split(';')[0]!.split('='); if (v.join('=')) jar.set(k!.trim(), v.join('=')); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${handle}: ${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  // join with a PIN: a passkey member is asked to choose one before anything else (RFC §10.13)
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1994-03-02', phone: '+977 980 000 0000', email: 'member@example.com' });
  await call('POST', '/me/checklist/dismiss', {});
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(60_000);
  return page;
}
async function welcomeOff(page: Page) {
  await page.goto(WEB);
  const got = page.getByRole('button', { name: 'Got it' });
  if (await got.isVisible().catch(() => false)) await got.click();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const view = { viewport: { width: 1280, height: 900 } };
try {
  const ana = await apiJoin('ana', 'Ana Shrestha', 'woman');
  await ana.call('PATCH', '/me/portfolio', { headline: 'Furniture & product designer', location: 'Patan', skills: ['Sketching', 'Prototyping', 'Woodwork'] });
  const boss = await apiJoin('boss', 'Sam Okoro', 'man');
  await q("update users set role = 'ops' where handle = 'boss'");
  await q("update users set verified_at = now() where handle = 'ana'");

  // ana's offer. Before: it just goes live. After: switching on asks an admin first.
  await ana.call('PUT', '/me/consult-offer', {
    active: true, description: 'Portfolio reviews before you apply, first-job advice, and how I would approach your brief.',
    minutes: 45, pricing: 'paid', priceNote: 'NPR 2,000 per session', paymentUrl: 'https://pay.example.com/ana',
    contact: 'WhatsApp +977 98010 12345',
  });
  if (!BEFORE) await q("update users set consult_requested_at = now(), consult_approved_at = null where handle = 'ana'");
  else await q("update users set consult_requested_at = null, consult_approved_at = now() where handle = 'ana'");

  // ── the member's own offer tab
  const anaPage = await browse(await browser.newContext(view), ana.jar);
  await welcomeOff(anaPage);
  await anaPage.goto(`${WEB}/consultations?tab=offer`);
  await anaPage.locator('form.consult-offer-form, .consult-offer-form').first().waitFor();
  await shot(anaPage, 'offer-tab', true);

  // ── what everyone else sees on ana's portfolio
  const bossPage = await browse(await browser.newContext(view), boss.jar);
  await welcomeOff(bossPage);
  await bossPage.goto(`${WEB}/u/ana`);
  await bossPage.waitForTimeout(1200);
  await shot(bossPage, 'portfolio', true);

  // ── an unverified member's offer tab (the plain line)
  if (!BEFORE) {
    const ben = await apiJoin('ben', 'Ben Rai', 'man');
    const benPage = await browse(await browser.newContext(view), ben.jar);
    await welcomeOff(benPage);
    await benPage.goto(`${WEB}/consultations?tab=offer`);
    await benPage.locator('.consult-offer-form').waitFor();
    await shot(benPage, 'offer-unverified', true);
  }

  // ── the admin's side: the queue with a row in it, then the members list
  if (!BEFORE) {
    await bossPage.goto(`${WEB}/admin`);
    const queue = bossPage.locator('section[aria-labelledby=adm-asks]');
    await queue.getByText('Ana Shrestha').first().waitFor();
    await queue.screenshot({ path: file('admin-queue') }); console.log('saved admin-queue');
    await queue.getByRole('button', { name: 'Approve' }).click();
    await bossPage.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await bossPage.getByText('can offer consulting').waitFor();
    await queue.screenshot({ path: file('admin-queue-approved') }); console.log('saved admin-queue-approved');
    // and the offer is live for everyone now
    await bossPage.goto(`${WEB}/u/ana`);
    await bossPage.locator('section.pf-consult').scrollIntoViewIfNeeded();
    await shot(bossPage, 'portfolio-approved');
    await anaPage.goto(`${WEB}/consultations?tab=offer`);
    await anaPage.waitForTimeout(800);
    await shot(anaPage, 'offer-approved', true);
  }

  if (a11y.length) console.log(`axe findings:\n${a11y.join('\n')}`);
  else console.log('axe: no WCAG 2.1 AA violations');
  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
