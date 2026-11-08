# anti-site

An invite-only, 100-seat, Twitter-like social app. Passkey-only auth (WebAuthn): no email, no password. People join with an invite code, pick a handle (only an admin can change it later), register a passkey, and are shown a one-time recovery code. Then everyone fills in a short setup once: a few words about themselves, a gender (it only shapes their drawn face) and a birthday (13 or older). When all seats are taken, new members are waitlisted.

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
bun run ops -- grant <handle>            # after joining: make yourself ops (moderation)
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
- **Milestone 3 (done):** in-process scheduler (hourly `run_lifecycle`: inactivity archival, lurker detection/grace/resolution, waitlist decay and promotion; daily cleanup of expired sessions, challenges and orphaned uploads), guarded by per-job advisory locks so multiple API instances are safe. Lurker banner with countdown and progress on every page; waitlist, archived (with reason), rejoin-queue and held-seat screens. 
- **Milestone 4 (done):** prices (placeholders: stay fee $5, reinstatement $10, USD; edit the `pricing` table), Stripe Checkout for both products, signed idempotent webhook, automatic refund when a payment can no longer apply (seat offer lapsed, account archived or deleted), hourly retry of failed refunds, payment history in Settings. **Payments run against a built-in fake Stripe by default** (see below).
- **Milestone 5 (done):** events: create/edit/cancel (host only; cancel and time/place changes notify everyone who RSVP'd), RSVP with capacity and a FIFO waitlist that promotes automatically, location visible only to the host and people going when marked private, attendance confirmation by the host from start to 14 days after (counts as a contribution for attendees and, with at least one confirmed attendee, for the host), upcoming/past lists. Cost is informational (price note + external payment link).
- **Milestone 6 (done):** reporting (5 distinct reports hide a post; ops reviews via `bun run ops -- flags` / `resolve` or `/ops/*`), ops bans and founder invites, Postgres-backed rate limits (invite checks, auth, likes, reports, uploads, checkouts, RSVPs), Web Push for replies/seat/event changes (service worker + Settings toggle; off until VAPID keys are set), concurrent seat race tests, production config guards and security headers, deployment and launch guide in [docs/deploy.md](docs/deploy.md).

- **Portfolio (done):** the profile is a Behance-style portfolio: CV card, numbered projects with project pages, cover and look, headline in the member list. RFC §10.1.
- **Admins (done):** an Admin page for admins only (role `ops`): founder invite codes, the report queue, every member with Ban / Unban / Make admin / Change handle, and the room's settings (seat cap, invites per member, invite expiry). Admins can remove any post or project, carry an "admin" tag, and are exempt from the activity rules. RFC §10.2.

- **Setup (done):** compulsory after joining, for everyone: About you (50–300 words, it is the portfolio's About), gender (Woman / Man / Non-binary / Prefer not to say; faces are drawn from handle + gender) and birthday (under 13 closes the account). Birthdays show as a "birthday today" tag (month and day only, opt-out). A "Finish your profile" checklist nudges toward a headline, skills, a project, a first post and a pick. RFC §10.3; `/dev/faces` shows sample faces per gender.

- **Collabs (done):** ongoing projects and activities members do together. Interest tags (members pick up to 10); a Collabs page with "For you" (matching interests) and "All"; open or ask-to-join with a note; invites to people who share the interests; co-hosts; a public updates thread with photos (kept out of the feed, counts toward the posting rule); meetups (team only or open to anyone); finishing gives every member a draft portfolio project. Events gained interests, "what to bring", ask-to-come, invites and an updates thread. Collabs can be reported like posts. RFC §10.5; `scripts/screenshots-collabs.ts` walks through it.

A free test copy runs on Vercel + Render (no domain, fake payments); see [docs/deploy-free.md](docs/deploy-free.md). A real launch (domain, Stripe live keys, image storage) follows [docs/deploy.md](docs/deploy.md).

## Payments (fake Stripe)

With no `STRIPE_SECRET_KEY` set, the API uses a fake Stripe: "Pay" buttons open a local test checkout at `/dev/checkout`. Paying there makes the API send itself a signed `checkout.session.completed` webhook, so the same code runs as with real Stripe; "Let it expire" simulates a timed-out checkout. To switch to real Stripe, set `PAYMENTS=stripe`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (see `.env.example`); the fake refuses to start when `NODE_ENV=production` unless `ALLOW_FAKE_PAYMENTS=true` (test deploys only).

## UI walkthrough screenshots

`scripts/screenshots.ts` drives your installed Chrome with a virtual passkey through the whole flow (join → post with image → reply/like from a second member → notifications, profile, members, search, settings, phone width) and writes `.screenshots/NN-*.png`. Run it against a throwaway stack (separate DB/ports) so it never touches your data; see the script header.

`scripts/screenshots-m3.ts` covers the lifecycle screens (waitlist, lurker banner, archival, rejoin, held seat). It runs the API itself on an in-memory database, so it only needs the web app pointed at it: in `apps/web`, `$env:API_URL='http://localhost:3101'; bunx next dev -p 3100`, then `bun scripts/screenshots-m3.ts`. Output: `.screenshots/m3/`. `scripts/screenshots-m4.ts` and `screenshots-m5.ts` do the same for payments and events (`.screenshots/m4/`, `m5/`). If another dev server is running, give the screenshot one its own build dir: `NEXT_DIST_DIR=.next-shots`.

## Notes

- `postgres` (postgres.js) is pinned to v3: Drizzle 0.45 does not run transactions correctly on v4. `packages/db/test/postgres-js.test.ts` guards this.
- The PGlite dev server is single-connection underneath; keep `DATABASE_POOL_MAX=1` with it.
