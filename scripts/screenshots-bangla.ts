/**
 * Bangla text in Li Golesta Borno (Lipighor), the owner's choice (2026-11-09). In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-bangla.ts
 * Output: .screenshots/bangla/NN-name.png
 * A member with a Bangla name posts in Bangla (mixed with English), hosts an event with a Bangla
 * title, and has a Bangla About; Chrome's own report of the fonts it drew with must say Golesta Borno
 * for the Bangla and Archivo for the English in the same paragraph.
 */
import { chromium, type CDPSession, type Page } from 'playwright-core';
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
const ABOUT = 'আমি পাটনে কাঠ আর স্টিলে আসবাব ডিজাইন করি। ছোট দোকানের জন্য অল্প করে বানাই, আর মাঝে মাঝে বন্ধুদের জন্য চেয়ার। নতুন ডিজাইনারদের পোর্টফোলিও দেখতে ভালো লাগে, কোন কাজ আগে দেখাবে সেটা বেছে দিতে পারি। ' +
  'I also write in English sometimes, when the words do not come in Bangla. এখানে এসেছি কারণ একজন বন্ধু বলেছিল এখানে মানুষ সত্যিই কথা বলে আর মাঝে মাঝে দেখা করে। সাইকেল, রুটি আর খারাপ টাইপফেস নিয়ে জিজ্ঞেস করতে পারো।';
const SETUP = { about: ABOUT, gender: 'woman', birthday: '1996-04-02', phone: '+880 1700 000000', email: 'member@example.com' };
const OUT = join(import.meta.dir, '..', '.screenshots', 'bangla');
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
async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}
const pageErrors: string[] = [];

async function apiMember(handle: string, displayName: string, gender = 'undisclosed') {
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
  await call('PUT', '/me/setup', { ...SETUP, gender });
  return { call, jar };
}

/** The fonts Chrome actually drew a node's text with, from DevTools: [{ familyName, glyphCount }]. */
async function fontsOf(cdp: CDPSession, page: Page, selector: string) {
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no node for ${selector}`);
  const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  void page;
  return r.fonts as { familyName: string; glyphCount: number }[];
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ana = await apiMember('ana', 'আনা শ্রেষ্ঠা', 'woman');
  const theo = await apiMember('theo', 'Theo Park', 'man');
  const post = await ana.call('POST', '/posts', { body: 'আজ বাজারে নতুন একটা চায়ের দোকান খুলেছে। Their milk tea is great, যাবে কেউ শনিবার?' });
  await theo.call('POST', '/posts', { body: 'Count me in for Saturday.', parentId: post.id });
  await ana.call('POST', '/events', { title: 'শনিবারের চা আড্ডা', description: 'চা, গল্প আর একটু হাঁটা। সবাই আসতে পারো।', startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), location: 'পুরান ঢাকা, লালবাগ' });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies([...theo.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (/Content.Security.Policy/i.test(m.text())) pageErrors.push(`CSP: ${m.text()}`); });
  page.setDefaultTimeout(90_000);
  const fontRequests: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'font') fontRequests.push(r.url()); });
  const cdp = await ctx.newCDPSession(page);

  // ── 1. the feed: a Bangla post with English in the middle, by a member with a Bangla name
  await page.goto(WEB);
  await page.getByText('Their milk tea is great').waitFor();
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const body = await fontsOf(cdp, page, 'article.post p.body');
  const names = body.map((f) => f.familyName).join(', ');
  console.log('post body fonts:', JSON.stringify(body));
  if (!body.some((f) => /Golesta/i.test(f.familyName))) throw new Error(`Bangla in a post is not drawn in Golesta Borno: ${names}`);
  if (!body.some((f) => /Archivo/i.test(f.familyName))) throw new Error(`the English in the same post is not Archivo: ${names}`);
  if (!fontRequests.some((u) => /Golesta/i.test(u) || /\.ttf/i.test(u))) console.log('note: font requests', fontRequests);
  await shot(page, 'feed-bangla-post');

  // ── 2. the event with a Bangla title (poster heading, bold)
  await page.goto(`${WEB}/events`);
  await page.getByText('শনিবারের চা আড্ডা').first().waitFor();
  await page.getByRole('link', { name: /শনিবারের চা আড্ডা/ }).first().click();
  await page.getByRole('heading', { name: 'শনিবারের চা আড্ডা' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const h1 = await fontsOf(cdp, page, 'h1');
  if (!h1.some((f) => /Golesta/i.test(f.familyName))) throw new Error(`the Bangla event title is not Golesta Borno: ${JSON.stringify(h1)}`);
  await shot(page, 'event-bangla-title');

  // ── 3. her portfolio: Bangla name and About
  await page.goto(`${WEB}/u/ana`);
  await page.getByText('আসবাব ডিজাইন করি').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, 'portfolio-bangla', true);

  // ── 4. the members page and a phone
  await page.goto(`${WEB}/members`);
  await page.getByText('আনা শ্রেষ্ঠা').first().waitFor();
  await shot(page, 'members-bangla-name');
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies([...theo.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => pageErrors.push(`${ph.url()}: ${e.message}`));
  await ph.goto(WEB);
  await ph.getByText('Their milk tea is great').waitFor();
  await ph.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await ph.evaluate(() => document.fonts.ready);
  await shot(ph, 'phone-feed-bangla');
  await phone.close();

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
