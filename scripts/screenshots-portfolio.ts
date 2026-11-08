/**
 * Portfolio screenshots. In-process API on :3101 with an in-memory DB, against a web build:
 *   (apps/web)  $env:API_URL='http://localhost:3101'; $env:NEXT_DIST_DIR='.next-shots-prod'; bun run build; bunx next start -p 3100
 *   bun scripts/screenshots-portfolio.ts     (SCHEME=dark for the dark theme)
 * Output: .screenshots/portfolio-<scheme>/NN-name.png
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../packages/db/src/testing';
import { formatInviteCode } from '../packages/shared/src/index';
import { createApp } from '../apps/api/src/app';
import { generateInviteCode } from '../apps/api/src/lib/crypto';
import { MemoryStorage } from '../apps/api/src/lib/storage';
import { FakeStripeProvider } from '../apps/api/src/lib/payments';
import { MemoryPushSender } from '../apps/api/src/lib/push';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const SCHEME = (process.env.SCHEME === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
const OUT = join(import.meta.dir, '..', '.screenshots', `portfolio-${SCHEME}`);
mkdirSync(OUT, { recursive: true });

const t = await createTestDb({ seatCap: 10 });
const q = (text: string, params: unknown[] = []) => t.client.query(text, params);
const server = createApp({
  db: t.db, storage: new MemoryStorage(), payments: new FakeStripeProvider(WEB),
  push: new MemoryPushSender('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  cfg: { rpId: 'localhost', rpName: 'Anti', webOrigin: WEB, cookieSecure: false },
}).listen(3101);

let n = 0;
async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  const file = join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

const pageErrors: string[] = [];
async function newUser(ctx: BrowserContext) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(90_000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return page;
}

async function join_(page: Page, handle: string, name: string) {
  const code = generateInviteCode();
  await q('select create_invite(null, $1)', [code]);
  await page.goto(`${WEB}/join`);
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(formatInviteCode(code));
  await page.getByRole('button', { name: 'Check code' }).click();
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByText('Save your recovery code').waitFor();
  await page.getByLabel('I saved it somewhere safe').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('What is on your mind?').waitFor();
  await page.getByRole('button', { name: 'Got it' }).waitFor();
  await page.getByRole('button', { name: 'Got it' }).click();
}

/** A poster-like image to upload: big type on a flat ground. */
async function makeImage(ctx: BrowserContext, file: string, bg: string, fg: string, big: string, small: string) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 800 });
  await p.setContent(`<body style="margin:0"><div style="width:1200px;height:800px;background:${bg};position:relative;overflow:hidden;
    font-family:Impact,sans-serif;color:${fg}">
    <div style="position:absolute;left:640px;top:120px;width:420px;height:420px;border-radius:50%;background:#e5432a"></div>
    <div style="position:absolute;left:70px;top:110px;font-size:190px;line-height:.85;text-transform:uppercase;max-width:700px">${big}</div>
    <div style="position:absolute;left:76px;bottom:70px;font:700 34px monospace;letter-spacing:4px">${small}</div>
  </div></body>`);
  writeFileSync(file, await p.screenshot());
  await p.close();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const view = { viewport: { width: 1280, height: 860 }, colorScheme: SCHEME };
  const a = await browser.newContext(view);
  const b = await browser.newContext(view);

  const maya = await newUser(a);
  await join_(maya, 'maya', 'Maya Lind');
  await maya.request.patch(`${WEB}/api/me`, { data: { bio: 'Draws things, then makes them. Kathmandu, mostly.' } });
  await maya.getByPlaceholder('What is on your mind?').fill('First week here. The quiet is loud.');
  await maya.getByRole('button', { name: 'Post', exact: true }).click();
  await maya.locator('.posts').getByText('First week here').waitFor();

  const theo = await newUser(b);
  await join_(theo, 'theo', 'Theo Park');

  // ── 1. an empty portfolio, seen by its owner: the plain profile plus the invitation
  await maya.goto(`${WEB}/u/maya`);
  await maya.getByRole('button', { name: 'Start your portfolio' }).waitFor();
  await shot(maya, 'own-empty', false);

  // ── 2. editing in place, through the real editor
  await maya.getByRole('button', { name: 'Start your portfolio' }).click();
  await maya.getByLabel('Headline').fill('Industrial designer');
  await maya.getByLabel('Where').fill('Kathmandu');
  await maya.getByLabel('Open to work').check();
  await maya.locator('.pf-sec textarea').fill(
    'I design small objects that get used every day: lamps, tools, the things on a kitchen table. '
    + 'I start with a pencil and end with a prototype I can hold.\n\nBefore design I studied mechanical engineering, which is why my sketches have tolerances written in the margins.');
  const skills = maya.locator('.pf-sec', { hasText: 'Skills' }).getByLabel('Add a tag');
  await skills.fill('Sketching, Rendering, 3D modelling, Rapid prototyping, Product photography');
  await skills.press('Enter');
  const tools = maya.locator('.pf-sec', { hasText: 'Tools' }).getByLabel('Add a tag');
  await tools.fill('Fusion 360, SolidWorks, KeyShot, Procreate, Blender');
  await tools.press('Enter');

  const exp = maya.locator('.pf-sec', { hasText: 'Experience' });
  await exp.getByRole('button', { name: '+ Add experience' }).click();
  let fs = exp.locator('.pf-edit-entry').nth(0);
  await fs.getByLabel('Title').fill('Product design intern');
  await fs.getByLabel('Place').fill('Jaquar Lighting');
  await fs.getByLabel('From').fill('2025');
  await fs.getByLabel('To').fill('2025');
  await fs.getByLabel('One line').fill('Decorative lighting: concept sketches to tooled samples.');
  await exp.getByRole('button', { name: '+ Add experience' }).click();
  fs = exp.locator('.pf-edit-entry').nth(1);
  await fs.getByLabel('Title').fill('Freelance');
  await fs.getByLabel('Place').fill('Own studio');
  await fs.getByLabel('From').fill('2023');
  await fs.getByLabel('To').fill('');
  await fs.getByLabel('One line').fill('Small runs for small shops.');

  const edu = maya.locator('.pf-sec', { hasText: 'Education' });
  await edu.getByRole('button', { name: '+ Add education' }).click();
  fs = edu.locator('.pf-edit-entry').nth(0);
  await fs.getByLabel('Title').fill('B.Des, product design');
  await fs.getByLabel('Place').fill('MIT Institute of Design, Pune');
  await fs.getByLabel('From').fill('2023');
  await fs.getByLabel('To').fill('2027');
  await edu.getByRole('button', { name: '+ Add education' }).click();
  fs = edu.locator('.pf-edit-entry').nth(1);
  await fs.getByLabel('Title').fill('B.Sc. mechanical engineering');
  await fs.getByLabel('Place').fill('Pulchowk Campus');
  await fs.getByLabel('From').fill('2018');
  await fs.getByLabel('To').fill('2022');

  await maya.getByRole('button', { name: '+ Add link' }).click();
  await maya.getByLabel('Label').fill('Behance');
  await maya.getByLabel('Address (https)').fill('https://www.behance.net/mayalind');
  await shot(maya, 'own-editing');

  await maya.getByRole('button', { name: 'Save', exact: true }).click();
  await maya.getByText('Open to work').waitFor();
  await maya.getByRole('button', { name: 'Edit portfolio' }).waitFor();
  // ── 3. the saved portfolio, as the owner sees it
  await shot(maya, 'own-filled');

  // ── 4. the same portfolio, seen by another member (no edit button); the picks tab
  await theo.goto(`${WEB}/u/maya`);
  await theo.getByText('Industrial designer').waitFor();
  if (await theo.getByRole('button', { name: 'Edit portfolio' }).count()) throw new Error('visitor sees the edit button');
  await shot(theo, 'visitor');
  await theo.getByRole('tab', { name: 'Picks' }).click();
  await theo.getByText('No picks yet.', { exact: true }).waitFor();
  await shot(theo, 'visitor-picks-tab', false);

  // ── 5. a member who has not started one: just the profile, no invitation for visitors
  await maya.goto(`${WEB}/u/theo`);
  await maya.getByText('@theo').first().waitFor();
  if (await maya.getByText('Start your portfolio').count()) throw new Error('visitor sees the start box');
  await shot(maya, 'visitor-empty', false);

  // ── 6. a project: the editor, with two uploaded images in the two layouts
  const img1 = join(OUT, '_render.png');
  const img2 = join(OUT, '_sketch.png');
  await makeImage(a, img1, '#131313', '#f2efe8', 'VELOCE', 'MASSAGE GUN · DFMA · 2026');
  await makeImage(a, img2, '#f4f1ea', '#1a1a1a', 'SKETCH 04', 'HANDLE ANGLE STUDIES');
  await maya.goto(`${WEB}/u/maya`);
  await maya.getByRole('link', { name: '+ Add project' }).click();
  await maya.getByLabel('Title').fill('Veloce');
  await maya.getByLabel('Year').fill('2026');
  await maya.getByLabel('Role').fill('Industrial designer');
  await maya.getByLabel('Team').fill('Group of two');
  await maya.getByLabel('Duration').fill('3 weeks');
  const toolsIn = maya.getByLabel('Add a tool');
  await toolsIn.fill('Fusion 360, KeyShot');
  await toolsIn.press('Enter');
  await maya.getByLabel(/^Summary/).fill('A massage gun for people who hate massage guns: quiet, small, and shaped like a tool rather than a weapon.');
  await maya.getByLabel(/^Write-up/).fill('The brief was design for manufacturing and assembly: every part had to come out of a mould and go together in under a minute.\n\nWe started with thirty quick sketches, kept three, and built the handle angle in foam before touching CAD.');
  await maya.locator('input[type=file]').setInputFiles([img1, img2]);
  await maya.waitForFunction(() => document.querySelectorAll('.pj-att.done').length === 2);
  const second = maya.locator('.pj-att').nth(1);
  await second.getByText('Text on the left').click();
  await second.getByLabel('Panel heading').fill('Concept');
  await second.getByLabel('Panel text').fill('Thirty sketches in an afternoon. The handle angle came from holding a hammer, not a drill.');
  await second.getByLabel('Caption (optional)').fill('Handle angle studies');
  await shot(maya, 'project-editor');
  await maya.getByRole('button', { name: 'Add project' }).click();
  await maya.getByRole('heading', { name: 'Veloce' }).waitFor();
  // ── 7. the project page, as its owner
  await shot(maya, 'project-own');
  // a second, draft project, so the index and the draft tag show
  await maya.request.post(`${WEB}/api/me/projects`, { data: { title: 'Folding lamp', year: 2025, role: 'Solo', draft: true, summary: 'Still being written.' } });
  await maya.goto(`${WEB}/u/maya`);
  await maya.getByText('Folding lamp').waitFor();
  await shot(maya, 'own-contents');

  // ── 8. the visitor sees the project but not the draft
  await theo.goto(`${WEB}/u/maya`);
  await theo.getByText('Veloce').waitFor();
  if (await theo.getByText('Folding lamp').count()) throw new Error('visitor sees a draft');
  await theo.getByRole('link', { name: /Veloce/ }).click();
  await theo.getByRole('heading', { name: 'Veloce' }).waitFor();
  if (await theo.getByRole('link', { name: 'Edit project' }).count()) throw new Error('visitor sees the edit link');
  await shot(theo, 'project-visitor');

  // ── 9. phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: SCHEME });
  await phone.addCookies(await b.cookies());
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => pageErrors.push(`${ph.url()}: ${e.message}`));
  await ph.goto(`${WEB}/u/maya`);
  await ph.getByText('Industrial designer', { exact: true }).waitFor();
  await shot(ph, 'phone-visitor');
  await ph.getByRole('link', { name: /Veloce/ }).click();
  await ph.getByRole('heading', { name: 'Veloce' }).waitFor();
  await shot(ph, 'phone-project');
  await phone.close();

  // reload the owner's page: it comes back from the server as saved
  await maya.goto(`${WEB}/u/maya`);
  await maya.getByText('Industrial designer', { exact: true }).waitFor();
  const yearsShown = await maya.locator('.pf-years').allInnerTexts();
  console.log('entries shown:', yearsShown.join(' | '));
  if (yearsShown[0] !== '2023 – now') throw new Error(`experience not sorted newest first: ${yearsShown.join(' | ')}`);

  if (pageErrors.length) throw new Error(`page errors:\n${pageErrors.join('\n')}`);
  console.log('ok');
} finally {
  await browser.close();
  server.stop();
  await t.close();
}
