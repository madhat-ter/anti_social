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

## Milestone 1 status

Done: invites, passkey registration/login/recovery, waitlist and seat lifecycle (in SQL), account settings, passkey and invite management, account deletion.

Not done / unverified: no posting or timeline yet; the web UI has not been exercised in a real browser against a live API and Postgres; `src/index.ts` and the mint CLI have not been run against a real Postgres server.
