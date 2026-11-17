/**
 * Pet Corner with drawn faces (RFC §10.17): one pet's page and the Pet Corner feed. Pets get fixed
 * variants, so a "before" and an "after" build draw the same pets. In-process API on :3101, web
 * build on :3100 (see AGENTS.md → Screenshots).
 *
 *   SHOTS=before bun scripts/screenshots-pets.ts   → .screenshots/pets/page-before-*.png
 *   bun scripts/screenshots-pets.ts                → .screenshots/pets/page-after-*.png
 */
import { chromium } from 'playwright-core';
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
const OUT = join(import.meta.dir, '..', '.screenshots', 'pets');
mkdirSync(OUT, { recursive: true });

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
  await c.call('PUT', '/me/setup', { about: 'I walk every morning, rain or not, with a dog who thinks every puddle is a lake. '.repeat(4), gender, birthday: '1994-03-02', phone: '+977 980 000 0000', email: 'm@example.com' });
  return c;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  const pets = [
    [maya, { name: 'Biscuit', species: 'dog', avatarVariant: 7919 * 3 }],
    [maya, { name: 'Miso', species: 'cat', avatarVariant: 7919 * 11 }],
    [theo, { name: 'Pip', species: 'bird', avatarVariant: 7919 * 5 }],
    [theo, { name: 'Rolo', species: 'dog', avatarVariant: 7919 * 22 }],
  ] as const;
  const made: { id: string }[] = [];
  for (const [c, body] of pets) made.push(await c.call('POST', '/pets', body));
  const say = ['Walked by the river today. Very proud of himself.', 'Found the one sunny spot in the flat.', 'Learned a new whistle this week.', 'Any tips for a dog who hates the bath?'];
  for (let i = 0; i < made.length; i++) await pets[i]![0].call('POST', '/posts', { body: say[i], petId: made[i]!.id, petLabel: i === 3 ? 'advice' : 'everyday' });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...theo.jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  for (const [name, path] of [['pet', `/pet/${made[0]!.id}`], ['corner', '/pets']] as const) {
    await p.goto(WEB + path);
    await p.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(OUT, `page-${TAG}-${name}.png`) });
    console.log('saved', name);
  }
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.stop();
  process.exit(0);
}
