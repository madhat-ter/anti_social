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

## Product rules that are easy to break

- **Light by default, always.** Dark mode is a choice in Settings only. Never read
  `prefers-color-scheme`. Every colour must be a CSS variable so `:root[data-theme="dark"]`
  covers it (`apps/web/app/globals.css`). (§10.14)
- **Sign-in is handle + 6-digit PIN** (§10.13). Passkeys are optional extras.
- **The header is the wordmark only**, plus the phone bell and the screen-time pill. Ask before
  adding anything to `.top`.
- **Faces are procedural** (`apps/web/src/components/Avatar.tsx`, from handle + gender). Any
  change to its pick lists or roll order redraws every member's face. Ask the owner first; check
  `/dev/faces` after.
- **The feed is not ranked** (§10.11): newest first, a "new since" line, an end card, folds. No
  algorithmic ranking, no A/B tests. "By person" view is deliberately not built.
- **Posts look like what they are** (§10.12 posts vs replies, §10.15 framed cards shaped by
  `postShape`: photo / short / text).
- **Visitors are not users** (§10.8). New "your own things" read endpoints go in
  `CLOSED_TO_VISITORS` (`apps/api/src/lib/visitors.ts`); new write buttons read `useReadOnly()`.
- **Header quotes were removed on purpose.** Don't bring them back unless asked.
- **Bangla font**: Golesta Borno (Lipighor), with the "Web font: lipighor.com" backlink in the
  landing footer. Keep the backlink. Permission from Lipighor is still pending; if they refuse,
  the font must be removed (fallback: Kalpurush, commit 9b24404).

## Files to leave alone

- `COST.xlsx` — updated only when the owner asks (`bun scripts/cost.ts --edit` edits the
  figures in place; never regenerate it). Excel may hold it open (`~$COST.xlsx`).
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
`.screenshots/latest/` with the whole UI under fixed names (`01-landing` … `14-feed-dark`) plus
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
