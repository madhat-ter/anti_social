/**
 * One Collab (RFC §10.21): events, activities and projects in one place.
 * Before/after pairs of the same scenes, in the same order:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   $env:SHOTS='before'; bun scripts/screenshots-collab-merge.ts   # today's pages
 *   bun scripts/screenshots-collab-merge.ts                        # the new ones
 * Output: .screenshots/collab-merge-before/ and .screenshots/collab-merge-after/
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

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const BEFORE = process.env.SHOTS === 'before';
const OUT = join(import.meta.dir, '..', '.screenshots', BEFORE ? 'collab-merge-before' : 'collab-merge-after');
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
  await page.waitForTimeout(300);
  await page.screenshot({ path: file(name), fullPage });
  console.log('saved', name);
}
const pageErrors: string[] = [];
const ABOUT = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const pad = (x: number) => String(x).padStart(2, '0');
const inDays = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
};

async function apiMember(handle: string, displayName: string, gender: string) {
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
  // join with a PIN: a passkey member is made to choose one before anything else (RFC §10.13)
  await call('POST', '/auth/join', { code: formatInviteCode(code), handle, displayName, pin: '739206' });
  await call('PUT', '/me/setup', { about: ABOUT, gender, birthday: '1995-02-11', phone: '+977 980 000 0000', email: 'member@example.com' });
  return { call, jar };
}
async function browse(ctx: BrowserContext, jar: Map<string, string>) {
  await ctx.addCookies([...jar].map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(60_000);
  return page;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const wide = { viewport: { width: 1280, height: 900 } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true };
try {
  const nova = await apiMember('nova', 'Nova Lind', 'woman');
  const ivy = await apiMember('ivy', 'Ivy Chen', 'woman');
  await ivy.call('PUT', '/me/interests', { interests: ['film', 'photography', 'music'] });

  // ── seed: one event, one project-style collab with roles and a team-only meetup
  const event = await nova.call('POST', '/events', {
    title: 'Darkroom evening', description: 'Develop a roll of black-and-white film together. Chemicals and tanks provided.',
    startsAt: inDays(5, 18), location: 'Studio B, the old print works', capacity: 8, interests: ['photography'],
  });
  const project = await nova.call('POST', '/collabs', {
    title: 'A short film about the night market',
    description: 'Ten minutes, shot on phones over four Friday nights. We need people who can hold a camera steady, record sound, and cut it together.',
    interests: ['film', 'photography'], roles: ['Camera', 'Sound', 'Editor'], teamMax: 6, joinMode: 'approve',
  });
  await nova.call('POST', '/events', {
    collabId: project.id, audience: 'team', title: 'First night of shooting',
    description: 'We walk the market from 7pm and get the wide shots.', startsAt: inDays(3, 19), location: 'North gate of the night market',
  });
  // after only: an activity, so the third kind has a page of its own
  const activity = BEFORE ? null : await nova.call('POST', '/collabs', {
    kind: 'activity', title: 'Sunday run club', meets: 'Sundays 7am, by the lake',
    description: 'Easy pace, five kilometres, coffee after. Anyone can join any Sunday.',
    interests: ['music'], teamMax: null, joinMode: 'open',
  });

  const novaPage = await browse(await browser.newContext(wide), nova.jar);
  await novaPage.goto(WEB);
  await novaPage.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});

  const listUrl = BEFORE ? `${WEB}/collabs` : `${WEB}/collab`;
  const startUrl = BEFORE ? `${WEB}/collabs/new` : `${WEB}/collab/new`;
  const eventUrl = BEFORE ? `${WEB}/events/${event.id}` : `${WEB}/collab/event/${event.id}`;
  const projectUrl = BEFORE ? `${WEB}/collabs/${project.id}` : `${WEB}/collab/${project.id}`;

  // ── 01/02: one list, phone and desktop
  const novaPhone = await browse(await browser.newContext(phone), nova.jar);
  await novaPhone.goto(listUrl);
  await novaPhone.getByText(project.title).first().waitFor();
  await shot(novaPhone, 'list-phone');

  await novaPage.goto(listUrl);
  await novaPage.getByText(project.title).first().waitFor();
  await shot(novaPage, 'list-desktop');

  // ── 03: where starting begins
  await novaPage.goto(startUrl);
  await shot(novaPage, 'start');

  // ── 04/05: the two forms that exist today (activity comes later, 11)
  const eventNew = BEFORE ? `${WEB}/events/new` : `${WEB}/collab/new?kind=event`;
  await novaPage.goto(eventNew);
  await novaPage.getByLabel('Title').fill('Darkroom evening');
  await novaPage.getByLabel('Where').fill('Studio B, the old print works');
  await shot(novaPage, 'form-event', true);

  const projectNew = BEFORE ? `${WEB}/collabs/new` : `${WEB}/collab/new?kind=project`;
  await novaPage.goto(projectNew);
  await novaPage.getByLabel('Title').fill('A short film about the night market');
  const roleBox = novaPage.getByLabel('A role');
  for (const r of ['Camera', 'Sound', 'Editor']) { await roleBox.fill(r); await novaPage.getByRole('button', { name: 'Add', exact: true }).click(); }
  await shot(novaPage, 'form-project', true);

  // ── 06/07: one event page, one project page
  await novaPage.goto(eventUrl);
  await novaPage.getByRole('heading', { name: /Darkroom evening/ }).waitFor();
  await shot(novaPage, 'event-page', true);

  await novaPage.goto(projectUrl);
  await novaPage.getByRole('heading', { name: /A short film/ }).waitFor();
  await shot(novaPage, 'project-page', true);

  // ── 08: the profile's tab
  await novaPage.goto(`${WEB}/u/ivy`);
  await novaPage.getByRole('tab', { name: BEFORE ? 'Collabs' : 'Collab' }).click();
  await novaPage.waitForTimeout(600);
  await shot(novaPage, 'profile-tab');

  // ── 09: the feed's side rail (coming up)
  await novaPage.goto(WEB);
  await novaPage.getByText('next_events').or(novaPage.getByText('coming_up')).first().waitFor({ timeout: 10_000 }).catch(() => {});
  await shot(novaPage, 'feed-rail');

  // ── 10: the phone tab bar
  await novaPhone.goto(WEB);
  await novaPhone.waitForTimeout(600);
  await shot(novaPhone, 'phone-tabbar');

  if (!BEFORE) {
    // ── after only: the activity, the Yours strip, the one join button, the three choices
    const activityUrl = `${WEB}/collab/${activity.id}`;
    await novaPage.goto(`${WEB}/collab/new?kind=activity`);
    await novaPage.getByLabel('Title').fill('Sunday run club');
    await (novaPage.getByLabel(/When we meet/) as ReturnType<Page['getByLabel']>).fill('Sundays 7am, by the lake');
    await shot(novaPage, 'form-activity', true);

    await novaPage.goto(activityUrl);
    await novaPage.getByRole('heading', { name: /Sunday run club/ }).waitFor();
    await shot(novaPage, 'activity-page', true);

    // Yours: ivy asks to join the project, so the host's strip has something in it
    await ivy.call('POST', `/collabs/${project.id}/join`, { note: 'I shoot a lot at night, and I have a gimbal.' });
    await novaPage.goto(`${WEB}/collab`);
    await novaPage.getByText(/request/).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await shot(novaPage, 'yours-strip');

    // one join button: as a stranger (join), as the asker (asked), as a member (you're in)
    const guest = await apiMember('zoe', 'Zoe Hart', 'woman');
    const guestPage = await browse(await browser.newContext(wide), guest.jar);
    await guestPage.goto(projectUrl);
    await guestPage.getByRole('button', { name: /Ask to join|Join/ }).first().waitFor();
    await guestPage.locator('article').first().screenshot({ path: file('join-button-states') });
    console.log('saved join-button-states');

    await novaPage.goto(`${WEB}/collab/new`);
    await novaPage.getByText('Activity').first().waitFor();
    await shot(novaPage, 'start-choices');
  }

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok', BEFORE ? '(before)' : '(after)');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
