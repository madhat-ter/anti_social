# Free test deploy (no domain yet)

A live copy for testing with friends, before buying a domain. Everything is on a free plan and nothing secret is
typed by hand: Render creates the database and wires its address into the API itself.

| Piece | Host | Free plan limits that matter |
|---|---|---|
| Web app | **Vercel** (Hobby) | Address is `https://<project>.vercel.app` |
| API | **Render** (free web service, Docker) | Sleeps after 15 min without traffic; the first visit after that takes ~1 min. Scheduled jobs only run while it is awake. |
| Database | **Render Postgres** (free, created by the Blueprint) | 1 GB; **expires 30 days after creation**. Images are stored here too (`STORAGE=db`), because the free web service has no disk. |

The live test copy (2026-11-08): web **https://anti-social-opal.vercel.app**, API https://anti-api-7ouk.onrender.com
(Render Blueprint `anti`, region Singapore; Vercel project `anti-social`).

What is different from a real launch ([deploy.md](deploy.md)):

- **Payments are fake** (`ALLOW_FAKE_PAYMENTS=true`). The stay fee "checkout" is a page with a Pay button; nobody is charged.
- **Passkeys are tied to the `*.vercel.app` address.** When you move to your own domain, start on a fresh database;
  every tester registers a new passkey.
- **Push notifications are off** unless VAPID keys are added (optional).

## Setting it up from scratch

Order matters: the API needs the web address, and the web app needs the API address.

1. **Vercel**: sign up with GitHub, *Add New → Project*, import the repo. Root Directory `apps/web` (Next.js is
   detected). Deploy (the first deploy asks you to confirm your email with a code). Note the production domain under
   *Settings → Domains*, e.g. `anti-social-opal.vercel.app`. Only that address works for sign-in: passkeys are bound
   to one host, so the long per-deploy preview URLs will not.
2. **render.yaml**: set `RP_ID` (the domain) and `WEB_ORIGIN` (`https://` + the domain) to that address, commit, push.
3. **Render**: sign up with GitHub (give it access to the repo only), *New → Blueprint*, pick the repo. It reads
   `render.yaml`, shows "Create database anti-db" and "Create web service anti-api"; *Deploy Blueprint*. The build takes
   a few minutes; the log ends with `migrations applied` and `api listening on :10000 (FAKE payments ...)`.
   Note the service address (e.g. `https://anti-api-xxxx.onrender.com`); `/health` answers `{"ok":true}`.
4. **Vercel again**: *Settings → Environment Variables*, add `API_URL` = the Render address (no trailing slash),
   then *Redeploy*. (`turbo.json` lists `API_URL` as a build input, so the redeploy really rebuilds.)
   `https://<domain>/api/health` should now answer `{"ok":true}`.

## Letting people in

- **First invite codes**: with `BOOTSTRAP_INVITES=3`, the API prints three founder codes to its log the first time
  it starts on an empty site (Render → the service → *Logs*, search `founder`). Codes are stored hashed, so the log is
  the only place they appear.
- **The first admin**: after you join, add `OPS_HANDLES=<your handle>` in Render → the service → *Environment*,
  then *Save and deploy*. It only acts while the site has no admin, so leaving it set is harmless.
- **After that, everything is on the site**: the **Admin** page (menu, admins only) creates more invite codes, reviews
  reports, bans and unbans, makes other admins, changes handles and sets the seat cap. See RFC §10.2.
- **Showing someone around without an invite**: Admin → *Visitor passes* makes a one-hour, read-only pass (RFC §10.8).
  Send the code or the `/visit/<code>` link; it works once, in one browser, and the hour starts when they enter it.
  Nothing to configure: the table arrives with the migration on the next deploy.
- **Contact details** (RFC §10.7) are encrypted with `CONTACT_KEY`. `render.yaml` asks Render to generate it; if the
  existing service does not have it (see below), add it in Render → the service → *Environment*: key `CONTACT_KEY`,
  then **Generate** for the value, *Save and deploy*. Nobody types or sees the key. Without it the site runs and simply
  does not ask for contact details. Never change or delete it later: details saved with the old key could not be read.

## Things that bit us

- Render's Blueprint did **not** copy a newly added `render.yaml` env var onto the existing service; add it in the
  service's *Environment* tab instead (*Save and deploy* is enough when only env vars change).
- Vercel first reused a cached build that still pointed `/api` at `localhost:3001` (error `DNS_HOSTNAME_RESOLVED_PRIVATE`):
  fixed by declaring `API_URL` in `turbo.json`.
- **"The site is down" (web loads, nothing else does).** Twice on 2026-11-08/09 the API stopped answering while the
  web app was fine. Direct requests to the Render address hung; through the web app, `/api/health` got a 502 with the
  header `X-Render-Routing: no-deploy`. That header means the service has **no live deploy**: the last automatic deploy
  failed, and on the free plan the old instance is already stopped, so nothing serves until a deploy succeeds. Check
  with `curl -sI https://<web>/api/health` (look at `X-Render-Routing`). Fix: Render → the service → *Manual Deploy →
  Deploy latest commit*, or push any commit; the site was back about 2½ minutes after the push both times. Render →
  the service → *Events* shows the failed deploy and its reason; nothing in the code had changed between the good and
  the failed deploys, so the failure was on Render's side (free builds and boots can fail for lack of memory or time).
  Since 2026-11-12 `.github/workflows/uptime-watch.yml` does this fix by itself: every 15 minutes it checks
  `/api/health`, and after two bad checks it pushes an empty "Redeploy (uptime-watch)" commit to `main`. After three
  such commits in a row it stops and fails (GitHub emails the owner), because then the code is the likely cause.
  The real cause, found 2026-11-12 in the logs ("api stopping: SIGTERM after N min" lines): the free plan puts the API
  to sleep after 15 minutes without visitors, and now and then Render fails to wake it, answering `no-deploy`.
  GitHub's 15-minute schedule is too unreliable to prevent that (it ran once in 4½ hours), so the API now visits its
  own `RENDER_EXTERNAL_URL/health` every 10 minutes and never sleeps (`KEEP_AWAKE=off` turns that off). Running all
  month uses about 720 of the workspace's 750 free instance hours, so keep it the only free web service there.

## Optional: push notifications

On your machine run `bun run ops:vapid-keys`, then add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
(`mailto:` + any email) in Render → the service → *Environment*. Keep them stable: changing them breaks existing
subscriptions.

## Moving to a real domain later

Buy the domain, then follow [deploy.md](deploy.md) on a **fresh** database: new `RP_ID`/`WEB_ORIGIN`, Stripe keys
instead of `ALLOW_FAKE_PAYMENTS`, and a disk volume or R2 for images instead of `STORAGE=db`. The free Render
database expires after 30 days anyway, so plan the move (or a paid database) before then.
