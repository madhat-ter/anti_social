/**
 * Consultations (RFC §10.6) screenshots. In-process API on :3101, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-consult.ts
 * Output: .screenshots/consult/NN-name.png
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'consult');
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
// accessibility: axe-core (WCAG 2.1 AA) on every full screen we capture
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
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1994-03-02' });
  await call('POST', '/me/checklist/dismiss', {});
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (msg) => { if (/Content.Security.Policy/i.test(msg.text())) pageErrors.push(`CSP: ${msg.text()}`); });
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
  const ana = await apiMember('ana', 'Ana Shrestha', 'woman');
  await ana.call('PATCH', '/me/portfolio', { headline: 'Furniture & product designer', location: 'Patan', skills: ['Sketching', 'Prototyping', 'Woodwork'] });
  const ben = await apiMember('ben', 'Ben Rai', 'man');
  const kai = await apiMember('kai', 'Kai Gurung', 'man');
  await kai.call('PUT', '/me/consult-offer', { active: true, topics: ['photography'], description: 'Shooting on a budget.', minutes: 30, pricing: 'free', contact: 'Signal @kai' });

  // ── the offer: set up on the Consultations page
  const anaPage = await browse(await browser.newContext(view), ana.jar);
  await welcomeOff(anaPage);
  await anaPage.goto(`${WEB}/consultations?tab=offer`);
  const form = anaPage.locator('form.consult-offer-form');
  await form.waitFor();
  for (const label of ['Design', 'Art']) await form.getByRole('button', { name: label, exact: true }).click();
  await form.getByLabel('About your sessions').fill('Portfolio reviews before you apply, first-job advice, and how I would approach your brief. Bring work in progress.');
  await form.getByLabel('Session length').selectOption({ label: '45 min' });
  await form.getByLabel('Paid').check();
  await form.getByLabel('Price').fill('NPR 2,000 per session');
  await form.getByLabel(/Your payment link/).fill('https://pay.example.com/ana');
  await form.getByLabel(/How people reach you/).fill('WhatsApp +977 98010 12345 · Telegram @ana_makes');
  await shot(anaPage, 'offer-setup', true);
  await form.getByRole('button', { name: 'Switch on' }).click();
  await anaPage.getByText('Saved. Your portfolio shows').waitFor();
  await shot(anaPage, 'offer-on');

  // ── what Ben sees on Ana's portfolio, and booking
  const benPage = await browse(await browser.newContext(view), ben.jar);
  await welcomeOff(benPage);
  await benPage.goto(`${WEB}/members`);
  await benPage.getByText('consults').first().waitFor();
  await benPage.getByLabel('Only people who offer consultations').check();
  await shot(benPage, 'members-consults');
  await benPage.goto(`${WEB}/u/ana`);
  const sec = benPage.locator('section.pf-consult');
  await sec.waitFor();
  await sec.scrollIntoViewIfNeeded();
  await shot(benPage, 'portfolio-consulting');
  await sec.screenshot({ path: file('portfolio-consulting-section') }); console.log('saved portfolio-consulting-section');
  await sec.getByRole('link', { name: 'Book a consultation' }).click();
  await benPage.waitForURL(/\/u\/ana\/consult$/);
  await benPage.getByRole('radio', { name: 'Design' }).click();
  await benPage.getByLabel('What you need help with').fill('I am applying to two furniture studios next month. Could you look at my portfolio and tell me which three projects to lead with? I have six, most from school.');
  await benPage.getByLabel('When suits you').fill('Weekday evenings after 6, or Saturday morning');
  await benPage.getByLabel('How they can reach you').fill('Telegram @benrai · or ben.rai.design@proton.me');
  await shot(benPage, 'book', true);
  await benPage.getByRole('button', { name: 'Send request' }).click();
  await benPage.waitForURL(/\/consultations\/[0-9a-f-]{36}$/);
  const reqUrl = benPage.url();
  await benPage.getByText('Waiting for an answer').waitFor();
  await shot(benPage, 'request-sent', true);

  // ── Ana answers: a lower price for this one
  await anaPage.goto(`${WEB}/consultations`);
  await anaPage.locator('.consult-card').first().waitFor();
  await shot(anaPage, 'received');
  await anaPage.goto(reqUrl);
  await anaPage.getByRole('heading', { name: 'Accept this request' }).waitFor();
  await anaPage.getByLabel('Price').fill('NPR 1,000, student price');
  await shot(anaPage, 'accept-form', true);
  await anaPage.getByRole('button', { name: 'Accept', exact: true }).click();
  await anaPage.getByText('Accepted. They will see the price').waitFor();
  await shot(anaPage, 'accepted-waiting', true);

  // ── Ben agrees to the price → contacts swap
  await benPage.goto(`${WEB}/notifications`);
  await benPage.getByText(/accepted your request on Design and set a price/).waitFor();
  await shot(benPage, 'notif-accepted');
  await benPage.goto(reqUrl);
  await benPage.getByRole('button', { name: 'I agree to pay this' }).waitFor();
  await shot(benPage, 'agree', true);
  await benPage.getByRole('button', { name: 'I agree to pay this' }).click();
  await benPage.getByText('Agreed. Your contacts are swapped.').waitFor();
  await shot(benPage, 'contacts-swapped', true);
  await anaPage.goto(reqUrl);
  await anaPage.locator('.consult-contacts').waitFor();
  await anaPage.locator('.consult-contacts').screenshot({ path: file('contacts-consultant-side') }); console.log('saved contacts-consultant-side');

  // ── done, and a thank-you on the portfolio
  await benPage.getByRole('button', { name: 'Mark done' }).click();
  await benPage.getByRole('dialog').getByRole('button', { name: 'Mark done' }).click();
  await benPage.getByText('Marked done.').waitFor();
  await benPage.getByPlaceholder('What helped.').fill('Ana picked my three strongest projects in ten minutes and told me exactly what to cut. I got an interview at the first studio.');
  await benPage.getByRole('button', { name: 'Post thank-you' }).click();
  await benPage.getByText('Thanks posted.').waitFor();
  await shot(benPage, 'done-thanks', true);
  await anaPage.goto(`${WEB}/u/ana`);
  await anaPage.locator('section.pf-consult .pf-thanks').waitFor();
  await anaPage.locator('section.pf-consult').screenshot({ path: file('portfolio-thanks-owner') }); console.log('saved portfolio-thanks-owner');
  await anaPage.goto(`${WEB}/notifications`);
  await anaPage.getByText(/left a thank-you/).waitFor();
  await shot(anaPage, 'notif-consultant');

  // ── a report, and what admins see
  const boss = await apiMember('boss', 'Sam Okoro', 'man');
  await q("update users set role = 'ops' where handle = 'boss'");
  const second = await ben.call('POST', '/members/kai/consultations', { topic: 'photography', need: 'Which second-hand lens should I buy?', when: '', contact: 'Telegram @benrai' });
  await kai.call('POST', `/consultations/${second.id}/accept`, { pricing: 'free' });
  await kai.call('POST', `/consultations/${second.id}/flag`, { reason: 'Kept asking me to work for free on his projects.' });
  const bossPage = await browse(await browser.newContext(view), boss.jar);
  await welcomeOff(bossPage);
  await bossPage.goto(`${WEB}/admin`);
  const rep = bossPage.locator('section[aria-labelledby=adm-rep]');
  await rep.getByText('Consultation request').waitFor();
  await rep.getByRole('button', { name: 'Read the request' }).click();
  await rep.locator('.adm-consult').waitFor();
  await rep.screenshot({ path: file('admin-report') }); console.log('saved admin-report');
  await bossPage.locator('section[aria-labelledby=adm-con]').screenshot({ path: file('admin-consultations') }); console.log('saved admin-consultations');

  // ── phone
  const mobile = await browse(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }), ben.jar);
  await mobile.goto(reqUrl);
  await mobile.locator('.consult-contacts').waitFor();
  await shot(mobile, 'mobile-request', true);
  await mobile.goto(`${WEB}/u/ana`);
  await mobile.locator('section.pf-consult').scrollIntoViewIfNeeded();
  await shot(mobile, 'mobile-portfolio-consulting');

  if (a11y.length) console.log(`axe findings:\n${a11y.join('\n')}`);
  else console.log('axe: no WCAG 2.1 AA violations');
  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
