# Working on anti

Read this first, then `docs/rfc/0001-architecture.md`. The RFC is the source of truth for every
product rule; section 10 records each feature and the decisions the owner made about it.

## What this is

An invite-only, 100-seat community site. Bun monorepo:

- `apps/api` — Elysia API on Postgres (PGlite locally and in tests). Tests: `apps/api/test/*.test.ts`.
- `apps/web` — Next.js 16 app (read `apps/web/AGENTS.md`: this Next.js has breaking changes).
- `packages/db` — Drizzle schema and SQL migrations (`packages/db/drizzle/00NN_*.sql`, run on boot).
- `packages/shared` — pure rules and constants shared by API and web (`rules.ts`, `feed.ts`).
- `apps/mobile` — the iOS/Android app, Expo SDK 58 (RFC §10.32; read `apps/mobile/README.md`
  and `apps/mobile/AGENTS.md`). It imports the website's `src/lib` words and rules (`@web/…`) and
  draws faces from `face.generated.tsx`: after any change to `Avatar.tsx`, run
  `bun scripts/sync-mobile-avatar.ts`. Typecheck: `cd apps/mobile; bunx tsc --noEmit`.
- `scripts/screenshots-*.ts` — one Playwright script per feature (see "Screenshots").

Commands: `bun run dev`, `bun run typecheck`, `bun run test` (from the root). Single API test
file: `cd apps/api; bun test test/<name>.test.ts`. Two payment tests (`lifecycle`, `payments`)
can time out under the full suite on a busy machine; they pass on their own.

## How the owner works

- Routine work (code, tests, commit, push to `main`) goes ahead without asking. Pause only for
  things that can't be undone or reach outside: deploys, spending money, deleting members' data.
- For a new feature, the owner wants to be questioned first: short questions, each with a
  recommended answer listed first. Build only after the answers. Record the decisions as a new
  RFC §10.N section.
- After any UI change, show screenshots: a "before" and an "after" of the same scene.
- Plain language in replies. No jargon without explaining it.

## Open tasks

The phone app (RFC §10.32) is built in `apps/mobile` but not in any store: Apple/Google accounts,
publishing, phone push and the universal-link files wait for the owner's word. One Collab (RFC §10.21) is built: events, activities and
projects live under `/collab`; the old `/events…` and `/collabs…` addresses forward permanently.
The two consulting offers the §10.18 migration had paused (@wise_panda, @ogcrazy) were approved on
tryanti.social on 2026-11-23; Admin → Consulting is empty.

Meeting in person is decided (§10.28): ages stay mixed; 13–17s see one safety line on in-person pages.
`CONTACT_KEY` (the same value the old Render API had) is set in the cPanel app's settings since
2026-11-23, so "Ask for a seat" and contact details work on tryanti.social (§10.27). After a cPanel
Save, one Restart may not start a new web copy; check `/api/public/seat-requests` and restart again
if needed.

Monologues (§10.22) keep their recordings in the database (the PGlite files on cPanel), like images.
A 6 MB body reaches the API on tryanti.social (checked 2026-11-23), so the old ~4 MB proxy worry is
gone. Moving files to Cloudflare R2 (`STORAGE=r2`) would put an outside service under the real site,
which §10.27 rules out; only do it if the owner changes that rule.

(Pet avatars were finished on 2026-11-10; the record and the reference doodles are in
`docs/tasks/pet-avatars.md` and `docs/tasks/pet-avatars/`.)

## Product rules that are easy to break

- **The landing page speaks to someone who feels alone** (§10.25). anti is for fewer teenagers
  ending their lives. The 36-word message is the owner's; never write that the reader truly has
  no one (the owner's first draft did, and it was changed on purpose). No jokes about deleting or
  ending things near it. There is no help line under it: the owner had Kaan Pete Roi and 999
  taken off on 2026-11-17 (Kaan Pete Roi did not answer). Don't add one back unless the owner
  asks, and never put a number on the site from memory.
  The landing ends with the three rules: **What is anti? + Questions** (§10.29) were taken off on
  the owner's word on 2026-11-24 ("it looks bad"), on the website and the phone app, and the
  JSON-LD lost its FAQPage with them. Don't put them back unasked. Their words stay in
  `apps/web/src/lib/about.ts` for `/llms.txt` only. Describe anti as what it is (a small community
  for people who feel alone), never with suicide or self-harm search words. Only `/` is indexable; every other page is
  noindex by default (`layout.tsx`). `app/page.tsx` must keep sending the landing written out
  when there's no `anti_session` cookie: a "Loading…" shell is what kept the site out of Google.
  **Ask for a seat** takes a request from someone with no account: only admins see it, the contact
  is sealed (`CONTACT_KEY`), the site sends them nothing, and "Not now" erases it.
- **Fewest taps** (§10.26): an action sits where its thing lives, never in Settings because it is
  "a setting"; one tap does the whole job; confirmations only for what can't be undone. Reply opens
  under the post in any list. The phone's "You" tab is your profile (no sheet; its links are
  `MeLinks` on top of your own profile). The only search is the box on Members (`/search` forwards
  there). Name, bio, face, interests and the birthday tag are edited with **Edit profile**; inviting
  is on Members. The feed's post box has Record (to the recorder) while it is empty. Don't add sections to Settings for things that have a page of their own, and count
  the taps on a phone before adding a screen.
- **Light by default, always.** Dark mode is a choice in Settings only. Never read
  `prefers-color-scheme`. Every colour must be a CSS variable so `:root[data-theme="dark"]`
  covers it (`apps/web/app/globals.css`). (§10.14)
- **Sign-in is handle + 6-digit PIN** (§10.13). Passkeys are optional extras.
- **Consulting is gated twice** (§10.18): the verified badge first, then one admin's approval
  (`users.consult_approved_at`). Approval sticks across pauses; losing the badge wipes it. Never
  make `consult_offers.active` alone mean "bookable" — live is `offerLive()` in
  `apps/api/src/lib/consultations.ts`.
- **The header is the wordmark only**, plus, on phones, the File button and the bell (the owner
  asked for the File button there, §10.24). Ask before adding anything else to `.top`.
- **Collab is one place** (§10.21): three kinds, one joined start block (+ Event / + Activity /
  + Project, §10.26), one "More options" fold, one join
  button, one card. Events are pages inside it (`/collab/event/<id>`); never add Events or Collabs
  back as separate tabs, and keep the old addresses forwarding. An admin's **Remove** — in Admin →
  Collab, or in the collab's / event's ⋯ menu — is a wipe: the thing goes with its team or RSVPs,
  requests, invites, updates and, for a collab, its meetups. A host's own Delete only hides it.
- **Monologues are cassettes** (§10.22): a post carrying a recording (Song / Thought / Yap), 5 min
  max, title + kind required, own work only, sound never editable, delete erases it. The cassette
  *is* the card and the player: tap anywhere on it to play, ▶ in its bottom part, time left in the
  label corner, waveform under the title, a 1×/1.5×/2× sticker; nothing under it but the note and
  Reply/Like. It lives in the feed, the Monologue tab and a profile's shelf; no play counts, no transcripts. Posting goes through `POST /posts` with
  `monologue: {…}` so it stays an ordinary post.
- **The File is a drawer** (§10.24): 12 pages, one card each; pages 0–6 are the member's own
  (0 is "Me", fixed), 7–11 hold only cards someone else made for them, placed by the member alone.
  A card is a headline, 1–20 photos with optional captions, a description. Never a feed item, no
  likes, not a contribution. All four steps are built (§10.24). Tabs flip the page like a real card
  file (`.file-leaf-out` / `.file-leaf-in`); keep the flip when changing the drawer. Opening
  someone else's File plays a quick run through its filled pages and back to "Me" (the opening
  run, owner 2026-11-27); screenshot scripts wait for `.file-quick` to go before shooting.
  The share link `/f/<handle>` is the only page of a member's content open to the outside: off by
  default, switched on and off only in the File itself (Share; the Settings switch was removed on
  the owner's word), and it shows every card the member placed, gift cards included (owner,
  2026-11-27; the maker's `public_ok` tick is no longer asked for or read).
  Anything new served without a session must go through `/public/…` and check `users.file_public`.
  **People outside can make a card** from that page (no account: a typed name, 5 photos at most,
  3 an hour per connection, no cap on the tray). Such a card has `maker_id` null and `guest_name`
  set; wherever it shows it must say "(not a member)". It never appears anywhere until the member
  places it; turned down, or 30 days unplaced, it is erased.
- **Faces are procedural** (`apps/web/src/components/Avatar.tsx`, from handle + gender). Any
  change to its pick lists or roll order redraws every member's face. Ask the owner first; check
  `/dev/faces` after.
- **The feed is not ranked** (§10.11): a "new since" line, an end card, folds. No
  algorithmic ranking, no A/B tests. "By person" view is deliberately not built.
- **The feed is mixed, not ranked** (§10.23): above the line, the newest post on top, then a seeded
  mix (`mixFeed`: newer posts likelier, one person kept apart) that only uses time and author, stable
  for a visit. Default for everyone; "Newest first" is the member's choice in Settings.
  Never let likes, replies or clicks into it.
- **Posts look like what they are** (§10.12 posts vs replies, §10.15 framed cards shaped by
  `postShape`: photo / short / text).
- **Mentions are typed, never a button** (§10.16): @ in any post box opens the member list;
  `@handle` links only when it matched a seated member; one notification per person per post;
  edits notify only newly added people; a mention is not a contribution.
- **Header quotes were removed on purpose.** Don't bring them back unless asked.
- **Bangla font**: Golesta Borno (Lipighor), served from `apps/web/app/fonts/golesta-borno/`
  with its licence file. No credit line or backlink on the site: the owner had it removed from the
  landing footer (2026-11-10) and it stays off. The files are not re-uploaded or shared elsewhere.

## Files to leave alone

- `COST.xlsx` — updated only when the owner asks (`bun scripts/cost.ts --edit` edits the
  figures in place; never regenerate it). It counts Claude Code at API list price, Command Code
  at the cost its transcripts record, and hosting. **Keep it off GitHub** (owner's call, 2026-11-09):
  update it locally but never commit or push it; pushes carry code only. Excel may hold it open
  (`~$COST.xlsx`).
- `reports/`, `research_notes/` — private research notes, kept out of git on purpose. Don't link
  them from tracked docs.
- `.env*` — never commit. The repo is **public**.

## Screenshots

Scripts run the API in-process on an in-memory DB at :3101 against a production build of the
web app at :3100:

```powershell
Remove-Item -Recurse -Force apps/web/.next-shots-prod -ErrorAction SilentlyContinue
cd apps/web; $env:NEXT_DIST_DIR='.next-shots-prod'; $env:API_URL='http://localhost:3101'; bun run build
Start-Process -WindowStyle Hidden bunx 'next','start','-p','3100'
cd ../..; $env:SHOTS='before'; bun scripts/screenshots-feed-types.ts   # or without SHOTS for "after"
```

Output goes to `.screenshots/` (ignored). When done, stop the server: find processes whose
command line matches `start -p 3100` and stop them all. The build may edit
`apps/web/tsconfig.json`; revert that (`git checkout -- apps/web/tsconfig.json`). Members made
by scripts must `PUT /me/setup` and join with `POST /auth/join` and a PIN.

### The latest UI, for the owner

After any UI change, run `bun scripts/screenshots-latest.ts` (same stack as above). It overwrites
`.screenshots/latest/` with the whole UI under fixed names (`01-landing` … `15-feed-dark`) plus
`_when.txt` with the time and commit, so the newest look is always in the same file names. Show
the screens you changed in the reply. A before/after pair for one change still goes in that
feature's own folder (e.g. `.screenshots/feed-types-before/`).

## Windows / PowerShell traps

- `git commit -m "..."` with quotes inside can silently commit nothing. Write the message to a
  file (UTF-8 **without** BOM) and use `git commit -F <file>`. Check `git log --oneline -1` before
  pushing.
- .NET file calls (`[IO.File]::WriteAllText`) resolve relative paths against
  `[Environment]::CurrentDirectory`, not the PowerShell location. Use absolute paths.

## The real site: tryanti.social on cPanel (§10.27)

- Owner's rule: **only cPanel** for the real site. One Node.js app is the whole site
  (`deploy/cpanel/server.mjs`); the database is **PGlite files** in `~/anti-data` (MySQL was
  turned down on purpose). Setup, updates, moving data in: `docs/deploy-cpanel.md`.
- Deploy: `bun scripts/build-cpanel.ts --publish` (pushes the built site to branch `cpanel-site`),
  then cPanel → Git Version Control → Update from Remote, Restart, open the site once.
- `www.` and plain `http://` forward to `https://tryanti.social` (rules in `~/public_html/.htaccess`).
- The API must keep running on **both Bun and Node**: no `Bun.*` outside `lib/password.ts` and the
  lazy R2 client; `apps/api/test/cpanel.test.ts` checks the Node paths.
- Never let two processes open `~/anti-data/pg`. LiteSpeed starts extra web processes under load
  and never ends old ones, so only the **keeper** (`deploy/cpanel/keeper.mjs`) opens it; web
  copies pass `/api/…` to it. Lock rules: `outranks()` in `embedded.ts`.
- The app's log is `~/anti-data/logs/app.log` (readable with cPanel's File Manager API).

## The old test site (retired 2026-11-23)

- **It now forwards every address to tryanti.social** (`next.config.ts`, a redirect only for the
  host `anti-social-opal.vercel.app`, still on Vercel; each push to `main` redeploys it). Its data
  was moved over once.
- **Render is gone** (owner's word, 2026-11-23): the API, its database and the Blueprint were
  deleted; `render.yaml` and the GitHub `uptime-watch` job that kept it awake were removed.
  `docs/deploy-free.md` is kept as history only.
- Never ask the owner to paste secrets into chat.
