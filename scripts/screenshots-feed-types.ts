/**
 * A mixed feed: photo posts, short statuses, a long story, a reply-heavy post. The scene for the
 * feed's look (RFC §10.15). In-process API on :3101, web build on :3100 (see the other scripts).
 *
 *   SHOTS=before bun scripts/screenshots-feed-types.ts   → .screenshots/feed-types-before/
 *   bun scripts/screenshots-feed-types.ts                → .screenshots/feed-types/
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const sharp = (await import('../apps/api/node_modules/sharp')).default;
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'feed-types-before' : 'feed-types');
mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' });

const t = await createTestDb({ seatCap: 20 });
const storage = new MemoryStorage();
const server = createApp({
  db: t.db, storage, payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

function client() {
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: BodyInit, type?: string) => {
    const headers: Record<string, string> = { origin: WEB };
    if (type) headers['content-type'] = type;
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await server.handle(new Request('http://localhost' + path, { method, headers, body }));
    for (const sc of r.headers.getSetCookie()) { const [k, ...v] = sc.split(';')[0]!.split('='); if (v.join('=')) jar.set(k!.trim(), v.join('=')); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const call = (method: string, path: string, body?: unknown) =>
    send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? undefined : 'application/json');
  /** a made-up photo: a gradient sky over a dark hill, so it reads as a picture */
  const upload = async (w: number, h: number, hue: [number, number, number]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${hue.join(',')})"/><stop offset="1" stop-color="#f6e7c8"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.5} ${w * 0.55} ${h * 0.68} T ${w} ${h * 0.6} V ${h} H 0 Z" fill="#2b3a2e"/>
      <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.08}" fill="#fff6d0"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const form = new FormData();
    form.append('file', new File([png], 'p.png', { type: 'image/png' }));
    return (await send('POST', '/uploads', form)).id as string;
  };
  return { call, upload, jar };
}
async function member(handle: string, displayName: string, gender: string) {
  const c = client();
  const raw = generateInviteCode();
  await t.client.query('select create_invite(null, $1)', [raw]);
  await c.call('POST', '/auth/join', { code: formatInviteCode(raw), handle, displayName, pin: '739206' });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}
const ago = (id: string, minutes: number) => t.client.query(`update posts set created_at = now() - make_interval(mins => $2) where id = $1`, [id, minutes]);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string>, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const rafi = await member('rafi', 'Rafi Haddad', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  // a quiet first post for each, two days ago, so today's posts carry no "First post" badge
  for (const c of [maya, theo, ines, rafi]) await ago((await c.call('POST', '/posts', { body: 'Hello, room.' })).id, 3000);

  // newest last in this list (each is moved back in time a little less than the one before)
  const scene: [ReturnType<typeof client>, Record<string, unknown>, number][] = [
    [ines, { body: 'Tried the new bakery on 5th. The cardamom buns are worth the queue.' }, 140],
    [maya, { body: 'Sunset from the north ridge tonight. Worth the climb.', imageIds: [await maya.upload(1200, 800, [233, 120, 80])] }, 120],
    [theo, { body: 'Anyone have a long-arm stapler I can borrow this week?' }, 110],
    [rafi, { body: '', imageIds: [await rafi.upload(900, 1100, [90, 140, 200])] }, 100],
    [ines, { body: 'I finally did it. After three years of saying "next summer", I signed up for the open-water swim at the lake. ' +
      'The first session was terrifying: the water is darker than you expect, and you cannot see your own hands. ' +
      'The coach told us to count strokes instead of looking for the shore. By the end I could do two hundred metres without stopping, ' +
      'which is two hundred more than last week. If anyone wants to come on Thursday mornings, the group is friendly and nobody is fast. ' +
      'Bring a bright cap so the lifeguard can see you, and something warm for after. I will be the one shivering by the van.' }, 80],
    [maya, { body: 'Market day haul: two zines, one plant, zero regrets.', imageIds: [await maya.upload(800, 800, [200, 90, 140]), await maya.upload(800, 800, [120, 170, 90]), await maya.upload(800, 800, [230, 190, 90])] }, 60],
    [theo, { body: 'Good morning.' }, 40],
    [rafi, { body: 'Is the lido open late this week? Asking for a friend (me).' }, 20],
  ];
  for (const [c, body, mins] of scene) await ago((await c.call('POST', '/posts', body)).id, mins);
  await t.client.query(`update users set feed_seen_through = now() - interval '3 hours' where handle = 'theo'`);

  const lap = await open(theo.jar, { width: 1366, height: 900 });
  await lap.goto(WEB);
  await welcome(lap);
  await lap.locator('.posts article.post').first().waitFor();
  await shot(lap, 'laptop-top');
  await lap.mouse.wheel(0, 700);
  await shot(lap, 'laptop-middle');
  await lap.mouse.wheel(0, 800);
  await shot(lap, 'laptop-lower');
  await lap.close();

  const ph = await open(theo.jar, { width: 390, height: 844 });
  await ph.goto(WEB);
  await welcome(ph);
  await ph.locator('.posts article.post').first().waitFor();
  await shot(ph, 'phone-feed', true);
  await ph.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
