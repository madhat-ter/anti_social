# anti-site

An invite-only, 100-seat, Twitter-like social app. Passkey-only auth (WebAuthn): no email, no password. People join with an invite code, pick an immutable handle, register a passkey, and are shown a one-time recovery code. When all seats are taken, new members are waitlisted.

Architecture and product rules: [docs/rfc/0001-architecture.md](docs/rfc/0001-architecture.md).

## Prerequisites

- [Bun](https://bun.sh) 1.4+
- Nothing else for local dev: `bun run dev` starts a PGlite-backed Postgres server on :5432 (data in `./.pglite`). For real Postgres 17 / `docker compose`, stop that and change `DATABASE_URL`.

## Setup

```sh
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
bun install
bun run dev                   # DB on :5432, API on :3001, web on :3000 (leave running)
# in a second terminal, first time only:
bun run db:migrate            # applies drizzle migrations and sql/functions.sql
bun run ops:mint-invites -- --count 10   # prints 10 seed invite codes (no inviter)
```

The API runs the lifecycle job on boot and hourly (set `JOBS=off` to disable). To run a job by hand: `bun run ops:run-job -- lifecycle` (or `cleanup`).

To wipe local data: stop `bun run dev`, delete `.pglite/`, start again and re-run the two first-time commands.

Open http://localhost:3000/join and use one of the minted codes.

Passkeys work on `localhost` in Chrome, Safari and Edge with `RP_ID=localhost` and `WEB_ORIGIN=http://localhost:3000` (the defaults in `.env.example`). `RP_ID` cannot change after launch without every user re-registering.

The browser calls `/api/*` on the web origin; Next.js rewrites it to `API_URL` so session cookies are first-party.

## Tests

```sh
bun run typecheck
bun run test
```

Tests need no database server: they run against in-process PGlite with the real schema and PL/pgSQL functions. API end-to-end tests drive WebAuthn with a software authenticator (`apps/api/test/fake-authenticator.ts`). Expect about 45 seconds for the full suite.

## Layout

```
apps/api         Elysia API (auth, /me, invites, CLI in src/cli)
apps/web         Next.js app (join, login, recover, home, settings)
packages/db      Drizzle schema, migrations, PL/pgSQL rules (sql/functions.sql), PGlite test helper
packages/shared  Rules constants, handle and invite-code helpers
docs/rfc         Design docs
```

## Status

- **Milestone 1 (done):** invites, passkey registration/login/recovery, waitlist and seat lifecycle (in SQL), account settings, passkey and invite management, account deletion.
- **Milestone 2 (done):** global feed, posts with up to 4 images (EXIF stripped, WebP), threaded replies, likes, edit window, soft delete, member directory and profiles, full-text search, in-app notifications. Images are stored on local disk (`.uploads/`); Cloudflare R2 comes with deployment.
- **Milestone 3 (done):** in-process scheduler (hourly `run_lifecycle`: inactivity archival, lurker detection/grace/resolution, waitlist decay and promotion; daily cleanup of expired sessions, challenges and orphaned uploads), guarded by per-job advisory locks so multiple API instances are safe. Lurker banner with countdown and progress on every page; waitlist, archived (with reason), rejoin-queue and held-seat screens. Payment buttons are placeholders until Milestone 4.

## UI walkthrough screenshots

`scripts/screenshots.ts` drives your installed Chrome with a virtual passkey through the whole flow (join → post with image → reply/like from a second member → notifications, profile, members, search, settings, phone width) and writes `.screenshots/NN-*.png`. Run it against a throwaway stack (separate DB/ports) so it never touches your data; see the script header.

`scripts/screenshots-m3.ts` covers the lifecycle screens (waitlist, lurker banner, archival, rejoin, held seat). It runs the API itself on an in-memory database, so it only needs the web app pointed at it: in `apps/web`, `$env:API_URL='http://localhost:3101'; bunx next dev -p 3100`, then `bun scripts/screenshots-m3.ts`. Output: `.screenshots/m3/`.

## Notes

- `postgres` (postgres.js) is pinned to v3: Drizzle 0.45 does not run transactions correctly on v4. `packages/db/test/postgres-js.test.ts` guards this.
- The PGlite dev server is single-connection underneath; keep `DATABASE_POOL_MAX=1` with it.
