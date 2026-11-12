# Working on anti

Read this first, then `docs/rfc/0001-architecture.md`. The RFC is the source of truth for every
product rule; section 10 records each feature and the decisions the owner made about it.

## What this is

An invite-only, 100-seat community site. Bun monorepo:

- `apps/api` — Elysia API on Postgres (PGlite locally and in tests). Tests: `apps/api/test/*.test.ts`.
- `apps/web` — Next.js 16 app (read `apps/web/AGENTS.md`: this Next.js has breaking changes).
- `packages/db` — Drizzle schema and SQL migrations (`packages/db/drizzle/00NN_*.sql`, run on boot).
- `packages/shared` — pure rules and constants shared by API and web (`rules.ts`, `feed.ts`).
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

Nothing in the code waits on anyone. One Collab (RFC §10.21) is built: events, activities and
projects live under `/collab`; the old `/events…` and `/collabs…` addresses forward permanently.

One thing waits on the **live test site** and needs an admin, not a commit:
the §10.18 migration paused every offer that was already live, so they are sitting in
**Admin → Consulting** until someone approves each one.

Monologues (§10.22) keep their recordings in the database for now, like images. When the owner
makes a Cloudflare R2 bucket, set `STORAGE=r2` and `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` on Render (never in chat); old files keep being read from the
database. Also worth checking on the live site: that an uploaded song over ~4 MB gets through
Vercel's proxy (a 5-minute recording made on the site is about 2.4 MB).

(Pet avatars were finished on 2026-11-10; the record and the reference doodles are in
`docs/tasks/pet-avatars.md` and `docs/tasks/pet-avatars/`.)

## Product rules that are easy to break

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
- **Collab is one place** (§10.21): three kinds, one Start, one "More options" fold, one join
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
  file (`.file-leaf-out` / `.file-leaf-in`); keep the flip when changing the drawer.
  The share link `/f/<handle>` is the only page of a member's content open to the outside: off by
  default, switched on and off only in the File itself (Share; the Settings switch was removed on
  the owner's word), and a member's gift card shows there only with its maker's `public_ok`.
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
  for a visit. Default for everyone and visitors; "Newest first" is the member's choice in Settings.
  Never let likes, replies or clicks into it.
- **Posts look like what they are** (§10.12 posts vs replies, §10.15 framed cards shaped by
  `postShape`: photo / short / text).
- **Mentions are typed, never a button** (§10.16): @ in any post box opens the member list;
  `@handle` links only when it matched a seated member; one notification per person per post;
  edits notify only newly added people; a mention is not a contribution.
- **Visitors are not users** (§10.8). New "your own things" read endpoints go in
  `CLOSED_TO_VISITORS` (`apps/api/src/lib/visitors.ts`); new write buttons read `useReadOnly()`.
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

## The live test site

- Web: https://anti-social-opal.vercel.app (Vercel, root `apps/web`); API on Render's free plan
  (`render.yaml`, Singapore), Render Postgres. Setup: `docs/deploy-free.md`; real launch: `docs/deploy.md`.
- Every push redeploys both. On Render's free plan that is a short outage, so don't push
  docs-only commits just to push.
- "Site down" check: `curl -sI https://anti-social-opal.vercel.app/api/health`. A 502 with
  `X-Render-Routing: no-deploy` means the last Render deploy failed; push an empty commit
  (`git commit --allow-empty`) or press Manual Deploy on Render.
- Never ask the owner to paste secrets into chat.
