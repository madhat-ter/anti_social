/**
 * RFC §10.26, the making shortcuts: Record in the post box, and Event / Activity / Project straight
 * from the Collab page (no "what is it?" screen in between). Same scenes before and after:
 *   1 the feed's post box on a laptop        2 the post box on a phone, tapped open
 *   3 the Collab page on a laptop            4 the Collab page on a phone
 * In the "after" run it also checks that Record opens the recorder and each start button opens its
 * own form in one tap. Same stack as the other screenshot scripts (see AGENTS.md):
 *   $env:SHOTS='before'; bun scripts/screenshots-make-shortcuts.ts   # or without SHOTS for "after"
 * Output: .screenshots/make-shortcuts-before/ and .screenshots/make-shortcuts-after/
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
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'make-shortcuts-before' : 'make-shortcuts-after');
mkdirSync(OUT, { recursive: true });

const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

function client() {
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
  return { call, jar };
}
async function member(handle: string, displayName: string, gender: string) {
  const c = client();
  const raw = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [raw]);
  await c.call('POST', '/auth/join', { code: formatInviteCode(raw), handle, displayName, pin: '739206' });
  await c.call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'member@example.com' });
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const must = (ok: unknown, what: string) => { if (!ok) throw new Error(what); };
async function open(jar: Map<string, string>, viewport: { width: number; height: number }) {
  const phone = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  return p;
}
let n = 0;
const shot = async (p: Page, name: string) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
  console.log('saved', name);
};
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  for (const c of [maya, theo]) {
    const p = await c.call('POST', '/posts', { body: 'Hello, room.' });
    await t.client.query(`update posts set created_at = now() - interval '2 days' where id = $1`, [p.id]);
  }
  await maya.call('POST', '/posts', { body: 'Walked the north ridge at sunrise. Worth the climb.' });
  await theo.call('POST', '/events', { title: 'Zine swap at the library', startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), location: 'Library, room 2' });
  await maya.call('POST', '/collabs', { kind: 'project', title: 'Zine about the old market', interests: ['photography'], roles: ['Writer'], teamMax: 4, joinMode: 'approve' });

  // 1 ── the post box on a laptop
  const lap = await open(theo.jar, { width: 1366, height: 900 });
  await lap.goto(WEB);
  await welcome(lap);
  await lap.locator('.posts article.post').first().waitFor();
  await shot(lap, 'feed-laptop');

  // 2 ── the post box on a phone: one line, then tapped open
  const ph = await open(theo.jar, { width: 390, height: 844 });
  await ph.goto(WEB);
  await welcome(ph);
  await ph.locator('.posts article.post').first().waitFor();
  await shot(ph, 'feed-phone');
  await ph.locator('#compose textarea').tap();
  await shot(ph, 'feed-phone-open');

  // 3, 4 ── the Collab page
  await lap.goto(`${WEB}/collab`);
  await lap.getByRole('heading', { name: 'Collab', exact: true }).waitFor();
  await shot(lap, 'collab-laptop');
  await ph.goto(`${WEB}/collab`);
  await ph.getByRole('heading', { name: 'Collab', exact: true }).waitFor();
  await shot(ph, 'collab-phone');

  if (!BEFORE) {
    // Record, straight from the feed (on a phone, from the closed one-line box)
    await ph.goto(WEB);
    await ph.locator('.posts article.post').first().waitFor();
    await ph.locator('#compose').getByRole('link', { name: /Record/ }).first().tap();
    await ph.getByRole('heading', { name: 'Record a monologue' }).waitFor();
    // each kind, one tap from Collab, lands on its own form
    for (const [label, heading] of [['+ Event', 'Start an event'], ['+ Activity', 'Start an activity'], ['+ Project', 'Start a project']] as const) {
      await lap.goto(`${WEB}/collab`);
      await lap.getByRole('link', { name: label, exact: true }).click();
      await lap.getByRole('heading', { name: heading }).waitFor();
      must(await lap.getByLabel('Title').count(), `${label}: no form`);
    }
    await shot(lap, 'collab-project-form');
  }

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
