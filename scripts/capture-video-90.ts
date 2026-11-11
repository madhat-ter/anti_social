/**
 * Real screens for the ninety-second video (docs/video/anti-90-seconds.md): every feature a member
 * can see, captured from a throwaway stack with made-up members, never the live site. Phone viewport
 * (390 × 844) at 3× pixels, so a crop shown 960 px wide in a 1080 × 1920 frame stays sharp.
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/capture-video-90.ts [outDir]     # default E:/work/anti-video-90/assets/shots
 * Writes PNGs plus shots.json (sizes, and where the things the cursor taps sit inside each image).
 */
import { chromium, type Locator, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';
const sharp = (await import('../apps/api/node_modules/sharp')).default;

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const OUT = process.argv[2] ?? 'E:/work/anti-video-90/assets/shots';
mkdirSync(join(OUT, 'seats'), { recursive: true });
const DPR = 3;
const meta: Record<string, unknown> = {};

const t = await createTestDb({ seatCap: 30 });
const q = (sql: string, args: unknown[] = []) => t.client.query(sql, args);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

type Jar = Map<string, string>;
async function call(jar: Jar, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: WEB };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const r = await server.handle(new Request('http://localhost' + path, {
    method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  }));
  for (const sc of r.headers.getSetCookie()) {
    const [k, ...v] = sc.split(';')[0]!.split('=');
    if (v.join('=')) jar.set(k!.trim(), v.join('='));
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const mint = async () => { const raw = generateInviteCode(); await q('select create_invite(null, $1)', [raw]); return formatInviteCode(raw); };
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const ABOUT = 'I write for small presses and print zines on an old risograph. Most weeks I am at the market with a notebook, talking to the people who keep the stalls going. Ask me about layout, paper, or where to find cheap ink in town. I like slow projects, long walks by the lake, and anything with a deadline far enough away to do it properly.';
async function member(handle: string, displayName: string, gender: string, birthday = '1995-02-11'): Promise<Jar> {
  const jar: Jar = new Map();
  await call(jar, 'POST', '/auth/join', { code: await mint(), handle, displayName, pin: '739206' });
  await call(jar, 'PUT', '/me/setup', { about: ABOUT, gender, birthday, phone: '+977 980 000 0000', email: 'member@example.com' });
  return jar;
}
/** a made-up photo, so a picture post has something to show */
async function upload(jar: Jar, w: number, h: number, hue: [number, number, number]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${hue.join(',')})"/><stop offset="1" stop-color="#f6e7c8"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.5} ${w * 0.55} ${h * 0.68} T ${w} ${h * 0.6} V ${h} H 0 Z" fill="#2b3a2e"/>
    <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.08}" fill="#fff6d0"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const form = new FormData();
  form.append('file', new File([png], 'p.png', { type: 'image/png' }));
  return (await call(jar, 'POST', '/uploads', form)).id as string;
}
async function tape(jar: Jar, title: string, kind: string, ms: number, seed: number) {
  const wave = Array.from({ length: 96 }, (_, i) => Math.round(25 + 60 * Math.abs(Math.sin((i + seed) / 6) * Math.cos((i + seed) / 13))));
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(400).fill(7)]) as BlobPart], 'take.webm', { type: 'audio/webm' }));
  form.append('durationMs', String(ms));
  form.append('peaks', JSON.stringify(wave));
  const audio = await call(jar, 'POST', '/monologues/audio', form);
  return call(jar, 'POST', '/posts', { body: '', monologue: { audioId: audio.id, title, kind, mine: true } });
}
const inDays = (days: number, hour: number) => { const d = new Date(Date.now() + days * 86_400_000); d.setHours(hour, 0, 0, 0); return d.toISOString(); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors: string[] = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true };
const HANDLES = ['sneho', 'mira', 'ben', 'ana', 'kai', 'lena', 'juno', 'tara'];

const px = (n: number) => Math.round(n * DPR);
/** an element's box inside another element's screenshot, in image pixels */
async function boxIn(inner: Locator, outer: Locator) {
  const a = (await inner.boundingBox())!; const b = (await outer.boundingBox())!;
  return { x: px(a.x - b.x), y: px(a.y - b.y), w: px(a.width), h: px(a.height) };
}
async function shot(loc: Locator, name: string) {
  await loc.scrollIntoViewIfNeeded();
  await loc.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
  const b = (await loc.boundingBox())!;
  meta[name] = { w: px(b.width), h: px(b.height) };
  console.log('saved', name);
}
async function screen(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
  meta[name] = { w: px(390), h: px(844) };
  console.log('saved', name);
}
async function open(jar: Jar | null, opts: Record<string, unknown> = PHONE, extra: { name: string; value: string }[] = []): Promise<Page> {
  const ctx = await browser.newContext(opts);
  const cookies = [...(jar ? [...jar].map(([name, value]) => ({ name, value })) : []), ...extra]
    .map((c) => ({ ...c, domain: 'localhost', path: '/' }));
  if (cookies.length) await ctx.addCookies(cookies);
  // the house rules window shows once per device; these members have seen it
  await ctx.addInitScript((hs: string[]) => { try { for (const h of hs) localStorage.setItem(`anti:welcomed:${h}`, '1'); } catch { /* */ } }, HANDLES);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  return page;
}
const settle = async (p: Page, ms = 600) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(ms); };
const noTabbar = (p: Page) => p.addStyleTag({ content: '.tabbar { display: none !important; }' });
const gotIt = (p: Page) => p.getByRole('button', { name: 'Got it' }).click({ timeout: 3000 }).catch(() => {});

try {
  // ── the landing: the alert, the hundred seats, the wordmark ──
  {
    const page = await open(null);
    await page.goto(`${WEB}/`);
    const alert = page.locator('.zoom .win').first();
    await alert.waitFor();
    await page.waitForTimeout(2600); // the zoom and the seats finish
    await shot(alert, 'alert');
    meta.alertYes = await boxIn(page.getByRole('link', { name: 'Yes, I have an invite' }), alert);
    const seats = page.locator('.seat-grid .seat');
    const n = await seats.count();
    for (let i = 0; i < n; i++) await seats.nth(i).screenshot({ path: join(OUT, 'seats', `seat-${String(i + 1).padStart(3, '0')}.png`), animations: 'disabled' });
    meta.seats = n;
    console.log('saved', n, 'seats');
    await page.context().close();
  }

  // ── getting in: the join form, typed into the way a new member would ──
  {
    const page = await open(null);
    await page.goto(`${WEB}/join`);
    const form = page.locator('.shell-main, main').first();
    await page.getByLabel('Invite code').waitFor();
    await page.waitForTimeout(400);
    await page.getByLabel('Invite code').fill(await mint());
    await shot(form, 'join-1');
    await page.getByRole('button', { name: 'Check code' }).click();
    await page.getByLabel('Handle', { exact: true }).fill('tara');
    await page.getByLabel('Display name').fill('Tara Rai');
    await page.locator('.you-face').first().waitFor();
    await page.waitForTimeout(400);
    await shot(form, 'join-2');
    meta.joinFace = await boxIn(page.locator('.you-face').first(), form);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('New PIN').fill('730418');
    await page.getByLabel('The same PIN again').fill('730418');
    await page.waitForTimeout(300);
    await shot(form, 'join-3');
    await page.context().close();
  }

  // ── the face, drawn again with every letter of the handle (large: 8× pixels) ──
  {
    const page = await open(null, { ...PHONE, deviceScaleFactor: 8 });
    await page.goto(`${WEB}/join`);
    await page.getByLabel('Invite code').fill(await mint());
    await page.getByRole('button', { name: 'Check code' }).click();
    const handle = page.getByLabel('Handle', { exact: true });
    await handle.waitFor();
    for (const h of ['t', 'ta', 'tar', 'tara']) {
      await handle.fill(h);
      await page.waitForTimeout(400);
      const face = page.locator('.you-face > :first-child').first();
      await face.screenshot({ path: join(OUT, `face-${h}.png`), animations: 'disabled' });
      console.log('saved face', h);
    }
    await page.context().close();
  }

  // ── members and what they made ──
  const sneho = await member('sneho', 'Sneho', 'woman');
  const mira = await member('mira', 'Mira Gurung', 'woman');
  // Ben's birthday is today, so the feed tags it
  const ben = await member('ben', 'Ben Thapa', 'man', `${now.getFullYear() - 31}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  const ana = await member('ana', 'Ana', 'undisclosed');
  const kai = await member('kai', 'Kai Lama', 'man');
  const lena = await member('lena', 'Lena Shah', 'woman');
  const juno = await member('juno', 'Juno Park', 'undisclosed');
  await q(`update users set checklist_dismissed_at = now(), activated_at = now() - interval '60 days'`);
  await q(`update users set role = 'ops' where handle = 'sneho'`);
  await q(`update users set verified_at = now() where handle in ('mira', 'ana')`);

  // quiet first posts two days back, so today's posts carry no "First post" badge
  for (const j of [sneho, mira, ben, ana, kai, lena, juno]) {
    const p = await call(j, 'POST', '/posts', { body: 'Hello, room.' });
    await q(`update posts set created_at = now() - interval '2 days' where id = $1`, [p.id]);
  }

  // a post the room reported five times: hidden until an admin looks
  const spam = await call(kai, 'POST', '/posts', { body: 'Cheap followers!! 10k in a day, DM me' });
  for (const [j, reason] of [[sneho, 'Spam'], [mira, 'Selling followers'], [ben, ''], [ana, 'Spam'], [lena, '']] as const) {
    await call(j, 'POST', `/posts/${spam.id}/flag`, reason ? { reason } : {});
  }

  const tea = await call(ben, 'POST', '/posts', { body: 'The tea stall by the bridge reopened. Same chipped cups, same radio. Somebody finally fixed the bench outside, so now there is nowhere to complain.' });
  await call(ana, 'POST', '/posts', { body: 'Darkroom is free on Thursday if anyone wants to print.' });
  await tape(mira, 'Why I stopped keeping a to-do list', 'thought', 252000, 0);
  const lake = await call(mira, 'POST', '/posts', { body: 'The lake at six this morning. Nobody else there.', imageIds: [await upload(mira, 1200, 800, [233, 120, 80])] });
  await call(ben, 'POST', '/posts', { body: 'Which side? I want to try the run there on Sunday.', parentId: lake.id });
  await call(lena, 'POST', '/posts', { body: 'North side, past the boats. Go before seven.', parentId: lake.id });
  await call(sneho, 'POST', `/posts/${tea.id}/like`);
  await call(mira, 'POST', `/posts/${tea.id}/like`);
  await call(kai, 'POST', `/posts/${tea.id}/like`);
  const bangla = await call(ana, 'POST', '/posts', { body: 'আজ বাজারে নতুন একটা চায়ের দোকান খুলেছে। Their milk tea is great, যাবে কেউ শনিবার?' });
  await q(`update posts set created_at = now() - make_interval(mins => 300) where id = $1`, [bangla.id]);

  // Mira's portfolio: a headline, a finished project, a few more tapes on her shelf
  await call(mira, 'PATCH', '/me/portfolio', { headline: 'Writer and zine maker', location: 'Kathmandu', skills: ['Writing', 'Risograph', 'Layout'] });
  await call(mira, 'POST', '/me/projects', { title: 'Market zine, issue 3', year: 2026, role: 'Writer and layout', summary: 'Twelve stalls, twelve people, printed on the risograph.', draft: false });
  await call(mira, 'POST', '/me/projects', { title: 'The bridge tea stall', year: 2026, role: 'Interviews', summary: 'Forty years of the same radio.', draft: false });
  for (const [title, kind, ms, seed] of [['Rain on the tin roof', 'song', 184000, 9], ['Monday, again', 'yap', 97000, 31]] as const) {
    const p = await tape(mira, title, kind, ms, seed);
    await q(`update posts set created_at = now() - interval '1 day' where id = $1`, [p.id]);
  }

  // the small rooms: a pick, a pet, a consultation offer
  const pick = await call(lena, 'POST', '/suggestions', { kind: 'movie', title: 'Perfect Days', note: 'A toilet cleaner in Tokyo, and somehow the calmest film of the year.' });
  await call(ben, 'PUT', `/suggestions/${pick.id}/vote`, { vote: 1, remark: 'Watched it twice. The tree shadows!' });
  await call(ana, 'PUT', `/suggestions/${pick.id}/vote`, { vote: 1 });
  const pet = await call(ana, 'POST', '/pets', { name: 'Biscuit', species: 'dog', avatarVariant: 7919 * 3 });
  await call(ana, 'POST', '/posts', { body: 'Biscuit will not walk past the vet. Any tricks that worked for you?', petId: pet.id, petLabel: 'advice' });
  await call(ana, 'PUT', '/me/consult-offer', {
    active: true, description: 'Portfolio reviews before you apply, first-job advice, and how I would approach your brief.',
    minutes: 45, pricing: 'paid', priceNote: 'NPR 2,000 per session', paymentUrl: 'https://pay.example.com/ana', contact: 'WhatsApp +977 98010 12345',
  });
  await q(`update users set consult_requested_at = null, consult_approved_at = now() where handle = 'ana'`);

  // Collab: an event, an activity, a project
  const ev = await call(mira, 'POST', '/events', { title: 'Picnic by the lake', startsAt: inDays(3, 11), endsAt: inDays(3, 14), location: 'The lake, north side', capacity: 12, interests: ['food'] });
  await call(ben, 'POST', '/collabs', { kind: 'activity', title: 'Sunday run club', meets: 'Sundays 7am, by the lake', interests: ['music'], teamMax: null, joinMode: 'open' });
  await call(ana, 'POST', '/collabs', { kind: 'project', title: 'A zine about the market', interests: ['photography'], roles: ['Writer'], teamMax: 5, joinMode: 'approve' });
  await call(ben, 'POST', `/events/${ev.id}/rsvp`, {}).catch((e) => console.log('rsvp ben skipped:', String(e).slice(0, 80)));

  // ── the feed: the line, the cards, a birthday, the pick window, the end ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/`);
    await gotIt(page);
    await page.getByText('Darkroom is free').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 800);
    await screen(page, 'feed-screen');
    // dark, by choice (Settings flips this same switch): the same screen, the other colour
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForTimeout(400);
    await screen(page, 'feed-screen-dark');
    await page.evaluate(() => { delete document.documentElement.dataset.theme; });
    await page.waitForTimeout(300);
    await noTabbar(page);
    const since = page.locator('.feed-since').first();
    if (await since.count()) await shot(since, 'feed-since');
    const card = (text: string) => page.locator('.posts article.post', { hasText: text }).first();
    await shot(card('The lake at six'), 'post-photo');
    await shot(card('The tea stall by the bridge'), 'post-tea');
    const teaCard = card('The tea stall by the bridge');
    const like = teaCard.getByRole('button', { name: /like/i }).first();
    if (await like.count()) meta.teaLike = await boxIn(like, teaCard);
    const bday = teaCard.locator('.tag.bday').first();
    if (await bday.count()) meta.teaBday = await boxIn(bday, teaCard);
    await shot(card('Why I stopped keeping'), 'post-tape');
    await shot(card('Their milk tea is great'), 'post-bangla');
    const bdayLine = page.locator('p.banner.bday-line').first();
    if (await bdayLine.count()) await shot(bdayLine, 'bday-line');
    const pickWin = page.locator('aside.pick-win').first();
    if (await pickWin.count()) {
      await pickWin.locator('.pick-title').waitFor();
      await shot(pickWin, 'pick');
      const up = pickWin.getByRole('button', { name: /^Upvote/ }).first();
      meta.pickUp = await boxIn(up, pickWin);
      await up.click();
      await page.waitForTimeout(300);
      const save = pickWin.getByRole('button', { name: 'Save' });
      if (await save.count()) { await save.click(); await page.waitForTimeout(700); }
      await shot(pickWin, 'pick-voted');
    }
    await shot(page.locator('.feed-end').first(), 'feed-end');
    await page.context().close();
  }

  // ── typing @ in the post box opens the member list ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/`);
    await gotIt(page);
    await page.getByPlaceholder('What is on your mind?').tap();
    await page.locator('#compose .composer .composer-bar').waitFor();
    const box = page.locator('#compose textarea').first();
    await box.type('Picnic on Saturday, @m', { delay: 30 });
    const list = page.locator('ul.mention-list').first();
    await list.locator('button').first().waitFor();
    await page.waitForTimeout(400);
    const a = (await page.locator('#compose').boundingBox())!; const b = (await list.boundingBox())!;
    const top = Math.min(a.y, b.y), bottom = Math.max(a.y + a.height, b.y + b.height);
    await page.screenshot({ path: join(OUT, 'mention.png'), clip: { x: 0, y: top - 8, width: 390, height: bottom - top + 16 } });
    meta.mention = { w: px(390), h: px(bottom - top + 16) };
    console.log('saved mention');
    await page.context().close();
  }

  // ── a thread: replies sit under the post, smaller ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/p/${lake.id}`);
    await page.locator('.thread-replies article.post').first().waitFor();
    await settle(page);
    await noTabbar(page);
    await shot(page.locator('.thread-replies').first(), 'thread-replies');
    await page.context().close();
  }

  // ── Collab: Start, the three choices, an event and its button ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/collab`);
    await gotIt(page);
    await page.getByText('Picnic by the lake').first().waitFor();
    await settle(page, 500);
    const head = page.locator('.shell-main .row.between').first();
    await shot(head, 'collab-head');
    meta.collabStart = await boxIn(page.getByRole('link', { name: '+ Start' }), head);
    await page.goto(`${WEB}/collab/new`);
    await shot(page.locator('.start-choices').first(), 'start-choices');
    await page.goto(`${WEB}/collab/event/${ev.id}`);
    const going = page.getByRole('button', { name: /I.m going/ }).first();
    await going.waitFor();
    await settle(page, 500);
    await screen(page, 'event-screen');
    const g = (await going.boundingBox())!;
    meta.eventGoing = { x: px(g.x), y: px(g.y), w: px(g.width), h: px(g.height) };
    await going.click();
    await page.waitForTimeout(1200);
    await screen(page, 'event-screen-going');
    await page.context().close();
  }

  // ── a profile is a portfolio: Mira's, the whole page ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/u/mira`);
    await page.getByRole('heading', { name: 'Mira Gurung' }).first().waitFor();
    await settle(page, 800);
    await noTabbar(page);
    await page.screenshot({ path: join(OUT, 'profile-full.png'), fullPage: true, animations: 'disabled' });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    meta['profile-full'] = { w: px(390), h: px(h) };
    // the film only scrolls as far as the shelf of tapes
    await sharp(join(OUT, 'profile-full.png')).extract({ left: 0, top: 0, width: px(390), height: Math.min(px(h), 3700) }).toFile(join(OUT, 'profile.png'));
    const at = async (sel: string) => {
      const l = page.locator(sel).first();
      if (!(await l.count())) return null;
      const b = await l.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; });
      return { x: px(b.x), y: px(b.y), w: px(b.w), h: px(b.h) };
    };
    meta.profileBadge = await at('.verified-badge');
    meta.profileShelf = await at('.shelf');
    meta.profileWork = await at('text=Market zine, issue 3');
    meta.profileName = await at('h1');
    console.log('saved profile-full', meta.profileBadge, meta.profileShelf, meta.profileWork);
    const shelf = page.locator('.shelf').first();
    if (await shelf.count()) await shot(shelf, 'shelf');
    await page.context().close();
  }

  // ── Pet Corner: Biscuit's page and his question ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/pet/${pet.id}`);
    await page.locator('.pet-hero').first().waitFor();
    await settle(page);
    await noTabbar(page);
    await shot(page.locator('.pet-hero').first(), 'pet-hero');
    const pc = page.locator('article.pet-card, article.post', { hasText: 'walk past the vet' }).first();
    if (await pc.count()) await shot(pc, 'pet-post');
    await page.context().close();
  }

  // ── Consulting: Ana's offer on her profile ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/u/ana`);
    const sec = page.locator('section.pf-consult').first();
    await sec.waitFor();
    await settle(page);
    await noTabbar(page);
    await shot(sec, 'consult');
    meta.consultBook = await boxIn(sec.getByRole('link', { name: 'Book a consultation' }), sec);
    await page.context().close();
  }

  // ── Admin: the reports queue ──
  {
    const page = await open(sneho);
    await page.goto(`${WEB}/admin`);
    await page.getByRole('heading', { name: 'Reports' }).waitFor();
    await settle(page);
    await noTabbar(page);
    await shot(page.locator('section[aria-labelledby=adm-rep]').first(), 'reports');
    await page.context().close();
  }

  // ── a visitor with a one-hour pass: they can watch, nothing else ──
  {
    const pass = await call(sneho, 'POST', '/ops/visitor-passes', { label: 'A friend of Mira' });
    const vjar: Jar = new Map();
    await call(vjar, 'POST', '/visit', { code: pass.code });
    const page = await open(vjar);
    await page.goto(`${WEB}/`);
    const strip = page.locator('p.banner.notice.watch-strip').first();
    await strip.waitFor();
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await screen(page, 'visitor-screen');
    const s = (await strip.boundingBox())!;
    meta.visitorStrip = { x: px(s.x), y: px(s.y), w: px(s.width), h: px(s.height) };
    await page.context().close();
  }

  // ── one more face, for the seat that changes hands ──
  {
    const page = await open(mira);
    await page.goto(`${WEB}/members`);
    await settle(page, 1200);
    const faces = page.locator('.shell-main svg.avatar, .shell-main .avatar svg, .shell-main .avatar');
    if (await faces.count()) await faces.first().screenshot({ path: join(OUT, 'face-new.png'), animations: 'disabled' });
    console.log('saved face-new');
    await page.context().close();
  }

  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(meta, null, 2));
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
