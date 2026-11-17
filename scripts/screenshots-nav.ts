/**
 * Fewer hidden steps, one way of doing things (RFC Â§10.20): the same scenes before and after.
 * In-process API on :3101, web build on :3100 (see AGENTS.md â†’ Screenshots).
 *
 *   SHOTS=before bun scripts/screenshots-nav.ts   â†’ .screenshots/nav-before/
 *   bun scripts/screenshots-nav.ts                â†’ .screenshots/nav-after/
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

const WEB = 'http://localhost:3100';
const TAG = process.env.SHOTS === 'before' ? 'before' : 'after';
const OUT = join(import.meta.dir, '..', '.screenshots', `nav-${TAG}`);
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 20 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
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
  await q('select create_invite(null, $1)', [raw]);
  await c.call('POST', '/auth/join', { code: formatInviteCode(raw), handle, displayName, pin: '739206' });
  await c.call('PUT', '/me/setup', { about: 'I make furniture in a small shop by the river and teach a weekend class on hand tools. '.repeat(3), gender, birthday: '1994-03-02', phone: '+977 980 000 0000', email: 'm@example.com' });
  return c;
}

const pageErrors: string[] = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open(jar: Map<string, string>, phone = false): Promise<Page> {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e.message}`));
  return p;
}
const AXE = require.resolve('axe-core/axe.min.js');
const a11y: string[] = [];
async function shot(p: Page, name: string, fullPage = false) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  if (TAG === 'after') {
    await p.addScriptTag({ path: AXE });
    const v = await p.evaluate(async () => {
      // @ts-expect-error injected global
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return r.violations.map((x: { id: string; help: string; nodes: { target: string[] }[] }) => `${x.id}: ${x.help} @ ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
    });
    for (const x of v as string[]) a11y.push(`${name}: ${x}`);
  }
  console.log('saved', name);
}
/** RFC §10.20: a delete or report opens a confirm first; Cancel leaves everything as it was */
async function asksFirst(p: Page, click: () => Promise<void>, what: string) {
  await click();
  const dlg = p.locator('dialog[open]');
  await dlg.waitFor({ timeout: 5000 }).catch(() => { throw new Error(`${what}: no confirm dialog`); });
  await dlg.getByRole('button', { name: /Cancel|Keep/ }).first().click();
  await dlg.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  console.log('asks first:', what);
}

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const boss = await member('boss', 'Sam Okoro', 'man');
  await q(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  await q("update users set role = 'ops' where handle = 'boss'");

  const day = new Date(Date.now() + 4 * 86_400_000); day.setHours(18, 30, 0, 0);
  const ev = await maya.call('POST', '/events', { title: 'Hand tools evening', description: 'Sharpen a chisel, cut a joint, take it home.', startsAt: day.toISOString(), location: 'The shop by the river', interests: ['art'] });
  const co = await maya.call('POST', '/collabs', { title: 'A bench for the park', description: 'Four Saturdays, one oak bench.', interests: ['volunteering'], roles: [], teamMax: 6, joinMode: 'open' });
  await theo.call('POST', `/collabs/${co.id}/join`, {});
  const pet = await maya.call('POST', '/pets', { name: 'Biscuit', species: 'dog', avatarVariant: 7919 * 3 });
  const pp = await maya.call('POST', '/posts', { body: 'Walked by the river today. Very proud of himself.', petId: pet.id, petLabel: 'everyday' });
  await theo.call('POST', `/posts/${pp.id}/flag`, { reason: 'test report' });
  const proj = await maya.call('POST', '/me/projects', { title: 'Oak stool', year: 2026, role: 'Maker', summary: 'Three legs, one evening.', draft: false });
  // a consulting offer waiting for an admin's yes (RFC Â§10.18)
  await q("update users set verified_at = now() where handle = 'theo'");
  await theo.call('PUT', '/me/consult-offer', { active: true, description: 'Joinery questions, tool buying advice.', minutes: 30, pricing: 'free', contact: 'Email theo@example.com' });
  await q("update users set consult_requested_at = now(), consult_approved_at = null where handle = 'theo'");

  const m = await open(maya.jar);
  await m.goto(WEB); await m.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await m.goto(`${WEB}/events/${ev.id}`); await m.getByRole('heading', { name: 'Hand tools evening' }).waitFor();
  await shot(m, '01-event-host');
  await m.goto(`${WEB}/collabs/${co.id}`); await m.getByRole('heading', { name: /A bench for the park/ }).waitFor();
  await shot(m, '02-collab-host', true);
  await m.goto(`${WEB}/settings`); await m.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot(m, '03-settings');
  await m.goto(`${WEB}/pet/${pet.id}`); await m.getByText('Walked by the river').first().waitFor();
  await shot(m, '04-pet-owner');
  await m.goto(`${WEB}/u/maya/work/${proj.id}`); await m.getByRole('heading', { name: 'Oak stool' }).waitFor();
  await shot(m, '08-project-owner');

  if (TAG === 'after') {
    await m.goto(`${WEB}/pet/${pet.id}`); await m.getByText('Walked by the river').first().waitFor();
    await asksFirst(m, () => m.getByRole('button', { name: 'Delete post' }).click(), 'delete a pet post');
    await m.getByText('Walked by the river').first().waitFor();
    await m.goto(`${WEB}/collabs/${co.id}`); await m.getByRole('heading', { name: /A bench for the park/ }).waitFor();
    await asksFirst(m, () => m.getByRole('button', { name: 'Remove from team' }).click(), 'remove someone from a collab');
    await m.goto(`${WEB}/events/${ev.id}`); await m.getByRole('heading', { name: 'Hand tools evening' }).waitFor();
    await asksFirst(m, () => m.getByRole('button', { name: 'Cancel event' }).click(), 'cancel an event');
    await m.goto(`${WEB}/u/maya/work/${proj.id}`); await m.getByRole('heading', { name: 'Oak stool' }).waitFor();
    await asksFirst(m, () => m.getByRole('button', { name: 'Delete project' }).click(), 'delete a project');
    const tp = await open(theo.jar);
    await tp.goto(`${WEB}/pet/${pet.id}`); await tp.getByText('Walked by the river').first().waitFor();
    await asksFirst(tp, () => tp.getByRole('button', { name: 'Report' }).first().click(), 'report a pet post');
    const still = await maya.call('GET', `/pets/${pet.id}`);
    if (!still.posts?.length) throw new Error('a cancelled confirm still deleted the pet post');
  }

  const b = await open(boss.jar);
  await b.goto(WEB); await b.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await b.goto(`${WEB}/admin`); await b.getByRole('heading', { name: 'Admin' }).waitFor();
  await b.getByText('Theo Brandt').first().waitFor().catch(() => {});
  await shot(b, '05-admin');

  const ph = await open(maya.jar, true);
  await ph.goto(WEB); await ph.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
  await ph.locator('.tb-you').click();
  await ph.locator('#you-sheet').waitFor();
  await shot(ph, '06-phone-you');
  await ph.goto(`${WEB}/settings`); await ph.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot(ph, '07-phone-settings');

  if (TAG === 'after') console.log(a11y.length ? `axe findings:\n${a11y.join('\n')}` : 'axe: no WCAG 2.1 AA violations');
  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
