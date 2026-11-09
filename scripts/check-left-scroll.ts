/**
 * The left column scrolls on its own (2026-11-09). In-process API on :3101, web build on :3100 (see
 * other screenshot scripts). A short screen makes the menu + pick window taller than the window:
 * scrolling the feed must leave the left column where it is, and the wheel over the left column
 * must move only the left column.
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';
import { FakeAuthenticator } from '../apps/api/test/fake-authenticator';

const WEB = 'http://localhost:3100';
const SETUP = { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'woman', birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' };
const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

async function member(handle: string) {
  const authn = new FakeAuthenticator();
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: WEB };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of r.headers.getSetCookie()) { const [k, ...v] = sc.split(';')[0]!.split('='); if (v.join('=')) jar.set(k!.trim(), v.join('=')); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const code = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [code]);
  const o = await call('POST', '/auth/register/options', { code: formatInviteCode(code), handle, displayName: handle });
  await call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await call('PUT', '/me/setup', SETUP);
  return { call, jar };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const maya = await member('maya');
  await t.client.query(`update users set role = 'ops' where handle = 'maya'`); // admins have the longest menu
  // 18: the API allows 20 posts an hour
  for (let i = 0; i < 18; i++) await maya.call('POST', '/posts', { body: `Post number ${i + 1}. ` + 'A line of text to make the feed long. '.repeat(12) });
  await maya.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'A house with infinite halls.' });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 560 } });
  await ctx.addCookies([...maya.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  await p.goto(WEB);
  await p.getByText('Post number 18.').waitFor();
  await p.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  const left = p.locator('.shell-left');
  const m = await left.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  if (m.scrollH <= m.clientH) throw new Error(`the left column fits (${m.scrollH} <= ${m.clientH}); the test needs it taller`);

  // scroll the feed to the very bottom: the left column must not move
  await p.mouse.move(640, 400);
  for (let i = 0; i < 40; i++) await p.mouse.wheel(0, 600);
  await p.waitForTimeout(400);
  const afterFeed = await left.evaluate((el) => el.scrollTop);
  const pageY = await p.evaluate(() => window.scrollY);
  if (afterFeed !== 0) throw new Error(`scrolling the feed moved the left column to ${afterFeed}`);
  if (pageY < 500) throw new Error(`the feed did not scroll (${pageY})`);

  // the wheel over the left column moves it, and only it
  await p.mouse.move(110, 300);
  for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 300);
  await p.waitForTimeout(400);
  const afterLeft = await left.evaluate((el) => el.scrollTop);
  const pageY2 = await p.evaluate(() => window.scrollY);
  if (afterLeft <= 0) throw new Error('the wheel over the left column did not scroll it');
  if (Math.abs(pageY2 - pageY) > 2) throw new Error(`scrolling the left column moved the page (${pageY} → ${pageY2})`);
  await p.screenshot({ path: join(import.meta.dir, '..', '.screenshots', 'left-scroll.png') });
  console.log(`left column ${m.clientH}px tall showing ${m.scrollH}px; feed scrolled to ${pageY}, column stayed at 0; column scrolled to ${afterLeft}, page stayed ok`);
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
