/**
 * Starting something in Collab (RFC §10.21), clicked through the way a member does it:
 * Collab → + Start → Event / Activity / Project → fill in → create. Fails loudly if any of the
 * three does not end on its new page. Same stack as the other screenshot scripts:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-collab-start.ts   # or without SHOTS for "after"
 * Output: .screenshots/collab-start-before/ and .screenshots/collab-start-after/
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'collab-start-before' : 'collab-start-after');
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
  console.log('saved', name);
};
const problems: string[] = [];

async function apiMember(handle: string, displayName: string) {
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
  await t.client.query('select create_invite(null, $1)', [code]);
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call('PUT', '/me/setup', { about: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' '), gender: 'woman', birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  return { call, jar };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const nova = await apiMember('nova', 'Nova Lind');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...nova.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (e) => problems.push(`page error at ${page.url()}: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`${r.request().method()} ${r.url()} -> ${r.status()}`); });
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});

  const inAWeek = (() => { const d = new Date(Date.now() + 7 * 86_400_000); const p = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T18:30`; })();
  const kinds = [
    { kind: 'Event', title: 'Darkroom evening', fill: async () => {
      await page.getByLabel('Starts').fill(inAWeek);
      await page.getByLabel('Where').fill('Studio B');
    }, button: 'Create event', lands: /\/collab\/event\// },
    { kind: 'Activity', title: 'Sunday run club', fill: async () => {
      await page.getByLabel('When we meet').fill('Sundays 7am, by the lake');
      await page.locator('.collab-form .chip').first().click();
    }, button: 'Start it', lands: /\/collab\/[^/]+$/ },
    { kind: 'Project', title: 'A zine about the market', fill: async () => {
      await page.locator('.collab-form .chip').first().click();
    }, button: 'Start it', lands: /\/collab\/[^/]+$/ },
  ];

  for (const k of kinds) {
    // the way a member gets there: the Collab page, its Start button, then the choice
    await page.goto(`${WEB}/collab`);
    await page.getByRole('link', { name: '+ Start' }).click();
    await page.waitForURL(/\/collab\/new$/);
    await page.locator('.start-choice', { hasText: k.kind }).click();
    const formUp = await page.getByLabel('Title').waitFor({ timeout: 5000 }).then(() => true, () => false);
    await shot(page, `${k.kind.toLowerCase()}-after-choosing`);
    if (!formUp) { problems.push(`${k.kind}: the form never appeared after choosing it (still at ${page.url()})`); continue; }
    await page.getByLabel('Title').fill(k.title);
    await k.fill();
    await page.getByRole('button', { name: k.button }).click();
    const landed = await page.waitForURL(k.lands, { timeout: 10_000 }).then(() => true, () => false);
    await shot(page, `${k.kind.toLowerCase()}-after-create`);
    if (!landed) problems.push(`${k.kind}: pressing "${k.button}" did not open the new page (still at ${page.url()}; note on screen: ${await page.locator('.error, [role=alert]').allInnerTexts().catch(() => [])})`);
    else console.log(`${k.kind}: created`);
  }

  if (problems.length) throw new Error(`problems:\n${problems.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
