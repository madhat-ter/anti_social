/**
 * The whole UI as it stands, into .screenshots/latest/ with fixed names (each run overwrites the
 * previous set, so the newest look is always in the same file names). Run this after any UI change
 * and show the changed screens to the owner; the before/after of one change stays in its own
 * feature folder (e.g. .screenshots/feed-types-before/).
 *
 * In-process API on :3101, web build on :3100 (see AGENTS.md). Nothing touches the real database.
 *
 *   bun scripts/screenshots-latest.ts
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
const sharp = (await import('../apps/api/node_modules/sharp')).default;
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'latest');
mkdirSync(OUT, { recursive: true });
// fixed names: a previous run's files (an old order, a renamed screen) must not linger beside the new set
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) unlinkSync(join(OUT, f));

const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
// a phone and an email are part of setup since §10.7
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'member@example.com' });

const t = await createTestDb({ seatCap: 20 });
const server = createApp({
  db: t.db,
  storage: new MemoryStorage(),
  payments: new FakeStripeProvider(WEB),
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
  /** a made-up photo, so a picture post has something to show */
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors: string[] = [];
async function open(jar: Map<string, string> | null, viewport: { width: number; height: number }, extra: { name: string; value: string }[] = []) {
  const ctx = await browser.newContext({ viewport });
  const cookies = [
    ...(jar ? [...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })) : []),
    ...extra.map((c) => ({ ...c, domain: 'localhost', path: '/' })),
  ];
  if (cookies.length) await ctx.addCookies(cookies);
  const p = await ctx.newPage();
  p.setDefaultTimeout(60_000);
  p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e.message}`));
  return p;
}

let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const rafi = await member('rafi', 'Rafi Haddad', 'man');
  await t.client.query(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  await t.client.query(`update users set role = 'ops' where handle = 'theo'`); // the admin page in the set
  await theo.call('PATCH', '/me/portfolio', { headline: 'Illustrator and zine maker', location: 'Kathmandu', skills: ['Illustration', 'Risograph', 'Layout'] });

  // a quiet first post for each, two days ago, so today's posts carry no "First post" badge
  for (const c of [maya, theo, ines, rafi]) {
    const p = await c.call('POST', '/posts', { body: 'Hello, room.' });
    await t.client.query(`update posts set created_at = now() - interval '2 days' where id = $1`, [p.id]);
  }

  // the feed scene: a photo post, short statuses, a long story, and a reply-heavy post
  const sunset = await maya.call('POST', '/posts', { body: 'Sunset from the north ridge tonight. Worth the climb.', imageIds: [await maya.upload(1200, 800, [233, 120, 80])] });
  const short = await rafi.call('POST', '/posts', { body: 'Is the lido open late this week? Asking for a friend (me).' });
  const long = await ines.call('POST', '/posts', { body: 'I finally did it. After three years of saying "next summer", I signed up for the open-water swim at the lake. ' +
    'The first session was terrifying: the water is darker than you expect, and you cannot see your own hands. ' +
    'The coach told us to count strokes instead of looking for the shore. By the end I could do two hundred metres without stopping, ' +
    'which is two hundred more than last week. If anyone wants to come on Thursday mornings, the group is friendly and nobody is fast. ' +
    'Bring a bright cap so the lifeguard can see you, and something warm for after. I will be the one shivering by the van.' });
  const haul = await maya.call('POST', '/posts', { body: 'Market day haul: two zines, one plant, zero regrets.', imageIds: [await maya.upload(800, 800, [200, 90, 140]), await maya.upload(800, 800, [120, 170, 90])] });

  // replies and a like: the thread page and theo's notifications
  await theo.call('POST', '/posts', { body: 'Which ridge? I have been meaning to try that one.', parentId: sunset.id });
  await ines.call('POST', '/posts', { body: 'Thursday mornings are the good ones. See you there.', parentId: long.id });
  await rafi.call('POST', '/posts', { body: 'The north ridge, past the water tank.', parentId: sunset.id });
  await theo.call('POST', `/posts/${short.id}/like`);
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 90) where id = $1`, [sunset.id]);
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 60) where id = $1`, [long.id]);
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 30) where id = $1`, [haul.id]);
  await t.client.query(`update posts set created_at = now() - make_interval(mins => 10) where id = $1`, [short.id]);

  // the rest of the rooms have something in them
  await maya.call('POST', '/suggestions', { kind: 'book', title: 'Piranesi', note: 'A house with infinite halls. Read it in one sitting.' });
  await theo.call('POST', '/events', { title: 'Zine swap at the library', description: 'Bring five copies of anything.', startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), location: 'Library, room 2' });
  await ines.call('POST', '/collabs', { title: 'Zine about the old market', description: 'We print a small zine about the stalls and the people who run them.', interests: ['writing', 'photography'], roles: ['Writer', 'Photographer'], teamMax: 4, joinMode: 'approve' });
  await theo.call('PUT', '/me/interests', { interests: ['hiking', 'photography'] });

  // ── signed out: the landing page
  const land = await open(null, { width: 1366, height: 900 });
  await land.goto(WEB);
  await land.locator('.hero').waitFor();
  await shot(land, 'landing');
  await land.close();

  // ── signed in, laptop
  const lap = await open(theo.jar, { width: 1366, height: 900 });
  await lap.goto(WEB);
  await welcome(lap);
  await lap.locator('.posts article.post').first().waitFor();
  await shot(lap, 'feed-laptop');

  // RFC §10.16: typing @ opens the member list (face, name, @handle); no mention button
  const composer = lap.locator('#compose textarea, .composer textarea').first();
  await composer.click();
  await composer.type('Coffee with @m');
  await lap.locator('.mention-list button').first().waitFor();
  await shot(lap, 'mention-list');
  await composer.fill('');
  await lap.locator('body').click({ position: { x: 5, y: 300 } });

  const go = async (path: string, name: string, ready?: () => Promise<unknown>) => {
    await lap.goto(WEB + path);
    if (ready) await ready().catch(() => {});
    await shot(lap, name);
  };
  await go(`/p/${sunset.id}`, 'thread', () => lap.getByRole('heading', { name: 'Thread' }).waitFor({ state: 'attached' }));
  await go('/u/theo', 'profile', () => lap.getByRole('heading', { name: 'Theo Brandt' }).waitFor());
  await go('/members', 'members', () => lap.locator('.seat-chart, .members-list, .member-list').first().waitFor());
  await go('/events', 'events', () => lap.getByRole('heading', { name: /events/i }).first().waitFor());
  await go('/collabs', 'collabs', () => lap.getByRole('heading', { name: /collabs/i }).first().waitFor());
  await go('/search', 'search', () => lap.locator('input[type=search]').first().waitFor());
  await go('/notifications', 'notifications', () => lap.locator('.notif-link').first().waitFor());
  await go('/settings', 'settings', () => lap.getByRole('heading', { name: /settings/i }).first().waitFor());
  await go('/admin', 'admin', () => lap.getByRole('heading', { name: /admin/i }).first().waitFor());
  await lap.close();

  // ── your own post as a phone
  const ph = await open(theo.jar, { width: 390, height: 844 });
  await ph.goto(WEB);
  await welcome(ph);
  await ph.locator('.posts article.post').first().waitFor();
  await shot(ph, 'feed-phone');
  await ph.close();

  // ── a short laptop window: the side windows scroll on their own (RFC §10.9)
  const rail = await open(theo.jar, { width: 1280, height: 500 });
  await rail.goto(WEB);
  await welcome(rail);
  await rail.locator('.posts article.post').first().waitFor();
  const box = await rail.locator('.rail').boundingBox();
  if (box) await rail.mouse.move(box.x + box.width / 2, box.y + 120);
  await rail.mouse.wheel(0, 400);
  await shot(rail, 'rail-scroll');
  await rail.close();

  // ── dark, by choice (RFC §10.14): last, so the set above stays light
  await theo.call('PATCH', '/me', { theme: 'dark' });
  const dark = await open(theo.jar, { width: 1366, height: 900 }, [{ name: 'anti_theme', value: 'dark' }]);
  await dark.goto(WEB);
  await welcome(dark);
  await dark.locator('.posts article.post').first().waitFor();
  await shot(dark, 'feed-dark');
  await dark.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  const commit = (() => {
    try {
      const cwd = join(import.meta.dir, '..');
      const dirty = execSync('git status --porcelain', { cwd }).toString().trim() ? '-dirty' : '';
      return execSync('git rev-parse --short HEAD', { cwd }).toString().trim() + dirty;
    } catch { return 'unknown'; }
  })();
  writeFileSync(join(OUT, '_when.txt'), `latest UI: ${new Date().toISOString()}\ncommit: ${commit}\n\nEach file is overwritten by the next run of scripts/screenshots-latest.ts.\n`);
  console.log(`\n${n} screenshots in ${OUT}`);
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
