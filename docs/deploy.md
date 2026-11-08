# Deploying anti and launching

Target layout from RFC-0001 §6: **web** on Vercel, **API** on Fly.io (or Railway), **Postgres** on Neon.
Nothing here has been run against real infrastructure yet; treat it as the checklist for the first deploy.
No domain yet? [deploy-free.md](deploy-free.md) puts a test copy live on free plans (Vercel + Render + Neon).

## 0. Decide before anything else

| Decision | Why it matters |
|---|---|
| **Domain** (e.g. `anti.example`) | It becomes the WebAuthn RP ID. Changing it later means every member re-registers their passkey. Serve the web app on that domain (or a subdomain of it). |
| **Prices** | Placeholders are seeded: stay fee $5, reinstatement $10 (USD). Change rows in `pricing` (amounts in minor units). |
| **Lurker thresholds** | `settings` table (RFC §15.4). Defaults: 8 seen days / 2 contributions / 30-day window. |

## 1. Database (Neon)

1. Create a Postgres 17 database. Copy the pooled connection string.
2. From your machine: `DATABASE_URL=<neon url> bun run db:migrate` (applies Drizzle migrations and `packages/db/sql/functions.sql`; safe to re-run on every deploy).

## 2. API (Fly.io)

Environment (secrets):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (turns on the config guards: https origin, secure cookies, real RP ID, no fake payments) |
| `DATABASE_URL` | Neon URL. Remove `DATABASE_POOL_MAX=1` (that is only for the local PGlite server). |
| `RP_ID` | your domain, e.g. `anti.example` |
| `WEB_ORIGIN` | `https://anti.example` |
| `TRUST_PROXY` | `true` on Fly (client IP from `Fly-Client-IP` for rate limits) |
| `PAYMENTS` | `stripe` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | from the Stripe dashboard; webhook endpoint `https://<api host>/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.expired` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `bun run ops:vapid-keys` once; keep them stable (changing them breaks existing push subscriptions) |
| `UPLOAD_DIR` | a mounted volume path (see "Known gaps") |

Run command: `bun apps/api/src/index.ts`. The scheduler starts in-process (lifecycle hourly, payments hourly, push every 10 s, cleanup daily). Every job takes a per-job advisory lock, so running several instances is safe.

## 3. Web (Vercel)

- Root directory `apps/web`, build `next build`.
- `API_URL=https://<api host>`: the web app proxies `/api/*` to it, so session cookies stay first-party.

## 4. Smoke test

1. `https://anti.example` loads; `/api/health` returns `{"ok":true}`.
2. Mint one invite (below), join on a phone and on a laptop, add a second passkey from Settings.
3. Post with an image, reply from the other account, check the notification and the push.
4. Run a Stripe **test-mode** stay fee checkout end to end before switching keys to live.

## 5. Launch with 10 founder invites (RFC §16 M6)

```sh
DATABASE_URL=<prod> bun run ops:mint-invites -- --count 10   # prints codes; they expire in 7 days
DATABASE_URL=<prod> bun run ops -- grant <your handle>        # after you join: you become ops
```

Send the codes out-of-band. Founder invites have no inviter.

## Operating

```sh
bun run ops -- flags                        # moderation queue (5 reports hide a post)
bun run ops -- resolve <postId> restored    # or: removed
bun run ops -- ban <handle>                 # frees the seat, revokes sessions, pauses the inviter's invites 30 days
bun run ops:run-job -- lifecycle            # run a job now (lifecycle | payments | push | cleanup)
```

Ops members get an in-app (and push) notification when a post is hidden. The same actions exist as `/ops/*` HTTP endpoints for an ops account; members get 404 there.

## Known gaps before launch

- **Image storage**: images are on local disk (`UPLOAD_DIR`). On Fly, mount a volume and run a single API machine, or implement the R2 `Storage` (interface in `apps/api/src/lib/storage.ts`) before scaling out.
- **Content-Security-Policy**: not set yet (Next.js inline scripts need nonces). Other security headers are on.
- **Real-Postgres race tests**: `packages/db/test/race.test.ts` runs on PGlite in CI; run it once against a throwaway real Postgres with `TEST_DATABASE_URL=... bun test` (it wipes that database).
- **Backups**: enable Neon point-in-time restore.
