/**
 * RFC §10.11, the feed: newest first, with a line where you left off and an end. In-process API
 * on :3101, web build on :3100 (see the other screenshot scripts).
 *
 *   bun scripts/screenshots-feed.ts          → .screenshots/feed/NN-name.png
 *
 * Checks: "N new since…" over the posts; a busy poster folded after two posts that day, opened in
 * place; "new here", "First post" and "Say hello" on a newcomer; a conversation row and an event
 * row placed in time; like counts only on your own post; the end card at the line, nothing loading
 * on its own under it, "Show older posts"; the line moves after the card was seen; /feed-rules.
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
import { FakeAuthenticator } from '../apps/api/test/fake-authenticator';

const WEB = 'http://localhost:3100';
const OUT = join(import.meta.dir, '..', '.screenshots', 'feed');
mkdirSync(OUT, { recursive: true });
let n = 0;
const shot = async (p: Page, name: string, fullPage = false) => {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage });
  console.log('saved', name);
};
const ABOUT = 'I draw for small presses and print zines on an old risograph. Most weeks I am at the market with a sketchbook, drawing the stalls and the people who keep them going. I like slow projects, paper that smells of ink, and anything with a deadline far enough away to do it properly. Ask me about layout, colour separations, or where to find cheap paper in town.';
const setup = (gender: string) => ({ about: ABOUT, gender, birthday: '1996-04-02', phone: '+977 980 000 0000', email: 'm@example.com' });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

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
async function member(handle: string, displayName: string, gender: string, inviter?: ReturnType<typeof client>) {
  const authn = new FakeAuthenticator();
  const c = client();
  let code: string;
  if (inviter) code = (await inviter.call('POST', '/me/invites')).code;
  else {
    const raw = generateInviteCode();
    await t.client.query('select create_invite(null, $1)', [raw]);
    code = formatInviteCode(raw);
  }
  const o = await c.call('POST', '/auth/register/options', { code, handle, displayName });
  await c.call('POST', '/auth/register/verify', { challengeId: o.challengeId, response: await authn.create(o.options, WEB) });
  await c.call('PUT', '/me/setup', setup(gender));
  return c;
}
/** move a post back by this many minutes */
const ago = async (id: string, minutes: number) =>
  t.client.query(`update posts set created_at = now() - make_interval(mins => $2) where id = $1`, [id, minutes]);

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
const must = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };
const welcome = async (p: Page) => { await p.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {}); };

try {
  const maya = await member('maya', 'Maya Lind', 'woman');
  const theo = await member('theo', 'Theo Brandt', 'man');
  const ines = await member('ines', 'Inês Moreau', 'woman');
  const rafi = await member('rafi', 'Rafi Haddad', 'man');
  // everyone but Juno joined two months ago; Juno, invited by Theo, joined today
  await t.client.query(`update users set activated_at = now() - interval '60 days', checklist_dismissed_at = now()`);
  const juno = await member('juno', 'Juno Park', 'nonbinary', theo);

  // ── what was there before Theo's last visit (a day and a half ago, and older)
  const old = [
    [theo, 'Fixed the bike lights finally. If anyone needs a pump, mine lives by the door now.', 50],
    [maya, 'The risograph is jammed again. Bringing biscuits for whoever can unjam it.', 46],
    // (Rafi's first post is older: a first post is never folded, and today's should be)
    [rafi, 'New here last month, still finding the good coffee. Leads welcome.', 40],
    [ines, 'Thinking of a Sunday swim at the lido. Who is in if the weather holds?', 30],
  ] as const;
  const oldIds: string[] = [];
  for (const [c, body, h] of old) { const p = await c.call('POST', '/posts', { body }); oldIds.push(p.id); await ago(p.id, h * 60); }
  for (const c of [maya, ines, rafi]) await c.call('POST', `/posts/${oldIds[0]}/like`); // three likes on Theo's own post
  await t.client.query(`update users set feed_seen_through = now() - interval '26 hours' where handle = 'theo'`);

  // ── since then: replies to Inês's swim post (a conversation row), Rafi posting a lot, Juno's first post, an event
  await maya.call('POST', '/posts', { body: 'Yes! I will bring the big towel.', parentId: oldIds[3] });
  await rafi.call('POST', '/posts', { body: 'In, as long as we go before ten.', parentId: oldIds[3] });
  const rafiLines = [
    'Morning. The bakery on 5th has the cardamom buns again.',
    'Update: they sold out by nine. Lesson learned.',
    'Has anyone tried the new ramen place by the river?',
    'Went to the ramen place. Go. Order the spicy one.',
    'Last one today, promise: the sunset from the bridge right now.',
  ];
  for (const [i, body] of rafiLines.entries()) { const p = await rafi.call('POST', '/posts', { body }); await ago(p.id, 50 - i * 10); } // all within the hour: one local day
  await maya.call('POST', '/events', { title: 'Zine swap at the library', description: 'Bring five copies of anything.', startsAt: inDays(3), location: 'Library, room 2' });
  const first = await juno.call('POST', '/posts', { body: 'Hi everyone, Theo dragged me in. I make bread and very bad puns.' });
  await maya.call('POST', '/posts', { body: 'Anyone have a long-arm stapler I can borrow this week?' });

  // ── 1. Theo opens the feed on a laptop
  const lap = await open(theo.jar, { width: 1366, height: 900 });
  await lap.goto(WEB);
  await welcome(lap);
  await lap.locator('.feed-since').waitFor();
  must((await lap.locator('.feed-since').innerText()).match(/^\d+ new since /), 'no "N new since" line');
  must(await lap.locator('.posts article.post').filter({ hasText: 'Theo dragged me in' }).getByText('new here').count() === 1, 'no "new here" on the newcomer');
  must(await lap.getByText('First post', { exact: true }).count() >= 1, 'no First post badge');
  must(await lap.locator('.posts article.post').filter({ hasText: 'Theo dragged me in' }).getByText('Say hello').count() === 1, 'no Say hello on a first post');
  await shot(lap, 'feed-top');

  // the fold: Rafi's posts after his second today
  const fold = lap.locator('.feed-fold');
  must(await fold.count() === 1, `expected one fold row, got ${await fold.count()}`);
  must((await fold.innerText()).startsWith('3 more from Rafi'), `fold says: ${await fold.innerText()}`);
  await fold.scrollIntoViewIfNeeded();
  await shot(lap, 'fold-closed');
  await fold.click();
  await lap.getByText('Has anyone tried the new ramen place').waitFor();
  await shot(lap, 'fold-open');
  await lap.locator('.feed-fold').click(); // Hide

  // the rows: a conversation on Inês's post, Maya's event
  const thread = lap.locator('.feed-row', { hasText: 'people replied since you were here' });
  must(await thread.count() === 1, 'no conversation row');
  must(await lap.locator('.feed-row', { hasText: 'Zine swap at the library' }).count() === 1, 'no event row');
  await thread.scrollIntoViewIfNeeded();
  await shot(lap, 'rows');

  // the end: the card at the line, nothing older loaded on its own under it
  const end = lap.locator('.feed-end');
  await end.scrollIntoViewIfNeeded();
  await lap.waitForTimeout(800);
  must(await lap.getByText('Thinking of a Sunday swim').count() === 0, 'a post from before the line shows without asking');
  must(await end.getByText('You’re caught up.').count() === 1, 'the end card does not say caught up');
  await shot(lap, 'end-card');
  const seen = (await t.client.query<{ t: string | null }>(`select feed_seen_through::text as t from users where handle = 'theo'`)).rows[0]!.t;
  must(seen && Date.parse(seen) > Date.now() - 3_600_000, `the line did not move after the end card: ${seen}`);

  await end.getByRole('button', { name: 'Show older posts' }).click();
  await lap.getByText('Thinking of a Sunday swim').waitFor();
  // Theo's own post: only he sees its like count
  const mine = lap.locator('.posts article.post').filter({ hasText: 'Fixed the bike lights' });
  await mine.scrollIntoViewIfNeeded();
  must((await mine.locator('.foot-btn.like').innerText()).includes('3'), 'no like count on your own post');
  const others = lap.locator('.posts article.post').filter({ hasText: 'risograph is jammed' });
  must(!/\d/.test(await others.locator('.foot-btn.like').innerText()), 'a like count shows on someone else’s post');
  await shot(lap, 'older-posts-and-own-likes');
  await lap.close();

  // ── 2. a phone: a fresh tab is a fresh visit, and Theo already read to the end
  const phone = await open(theo.jar, { width: 390, height: 844 });
  await phone.goto(WEB);
  await welcome(phone);
  // nothing new since he read to the end: the feed is the end card, and older posts wait behind its button
  await phone.locator('.feed-end').getByText('Nothing new.').waitFor();
  must(await phone.locator('.posts article.post').count() === 0, 'posts from before the line show without asking');
  await shot(phone, 'phone-nothing-new');
  await phone.locator('.feed-end').getByRole('button', { name: 'Show older posts' }).click();
  await phone.locator('.posts article.post').first().waitFor();
  await shot(phone, 'phone-older');
  await phone.close();

  // ── 3. Juno's first post rang Theo, the inviter
  const notes = await theo.call('GET', '/notifications');
  must(notes.items.some((x: any) => x.kind === 'invitee_first_post' && x.post?.id === first.id), 'the inviter was not told');
  const inbox = await open(theo.jar, { width: 1366, height: 700 });
  await inbox.goto(`${WEB}/notifications`);
  await inbox.getByText('wrote their first post').waitFor();
  await shot(inbox, 'inviter-notification');

  // ── 4. the rules page
  await inbox.goto(`${WEB}/feed-rules`);
  await inbox.getByRole('heading', { name: 'How the feed works' }).waitFor();
  await shot(inbox, 'feed-rules');
  await inbox.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
