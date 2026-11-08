# Free test deploy (no domain yet)

A live copy for testing with friends, before buying a domain. Everything here is on a free plan:

| Piece | Host | Free plan limits that matter |
|---|---|---|
| Web app | **Vercel** (Hobby) | Address is `https://<project>.vercel.app` |
| API | **Render** (Free web service) | Sleeps after 15 min without traffic; the first visit after that takes ~1 min. Scheduled jobs only run while it is awake. |
| Database | **Neon** (Free) | 0.5 GB. Images are stored here too (`STORAGE=db`) because Render's free plan has no disk. |

What is different from a real launch ([deploy.md](deploy.md)):

- **Payments are fake** (`ALLOW_FAKE_PAYMENTS=true`). The stay fee "checkout" is a page with a Pay button; nobody is charged.
- **Passkeys are tied to the `*.vercel.app` address.** When you move to your own domain, every tester registers a new passkey (start the real launch on a fresh database).
- **Push notifications are off** unless you add VAPID keys (optional, step 3).

Order matters: the API needs the web address, and the web app needs the API address.

## 1. Database: Neon

1. Sign up at neon.tech, create a project (Postgres 17, region close to you).
2. On the project dashboard, **Connect** → turn **Connection pooling OFF** → copy the connection string.
   It looks like `postgresql://...@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require` (no `-pooler` in the host).
   Use the direct one: the scheduled jobs use session locks that the pooler does not keep.

## 2. Web app: Vercel (first, to get the address)

1. Sign up at vercel.com with GitHub, **Add New → Project**, import `madhat-ter/anti_social`.
2. **Project Name**: pick it carefully, it becomes the address, e.g. `anti-test` → `https://anti-test.vercel.app`.
3. **Root Directory**: `apps/web`. Framework: Next.js (detected).
4. Environment variable: `API_URL` = `https://anti-api.onrender.com` (a placeholder for now; fixed in step 4).
5. Deploy. Note the **production** address shown on the project page (`https://<name>.vercel.app`).
   Only that address works for sign-in; the long per-deploy preview URLs will not (passkeys are bound to one host).

## 3. API: Render

1. Sign up at render.com with GitHub, **New → Blueprint**, pick `madhat-ter/anti_social`. It reads `render.yaml`.
2. It asks for three values:
   - `DATABASE_URL`: the Neon string from step 1
   - `RP_ID`: the Vercel host without `https://`, e.g. `anti-test.vercel.app`
   - `WEB_ORIGIN`: the full address, e.g. `https://anti-test.vercel.app`
3. Apply. The first build takes a few minutes. The log should end with `migrations applied` and `api listening on :10000 (FAKE payments ...)`.
4. Note the service address, e.g. `https://anti-api.onrender.com` (open `/health` on it: `{"ok":true}`).
5. Optional, push notifications: on your machine run `bun run ops:vapid-keys`, then add `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` + any email) in the Render service's **Environment** tab.

## 4. Connect them

In Vercel → the project → **Settings → Environment Variables**, set `API_URL` to the Render address from step 3
(no trailing slash), then **Deployments → ⋯ → Redeploy**.

## 5. Let people in

Invites are minted from your machine against the Neon database (PowerShell, from the repo root):

```powershell
$env:DATABASE_URL = '<the Neon string>'
bun apps/api/src/cli/mint-invites.ts --count 5      # prints codes; they expire in 7 days
```

Join with one code yourself at `https://<name>.vercel.app`, then make yourself ops:

```powershell
bun apps/api/src/cli/ops.ts grant <your handle>
Remove-Item env:DATABASE_URL                          # so later local commands use your dev database again
```

## Smoke test

1. Open the site (if the API was asleep, the first load is slow).
2. Join with an invite on a phone and on a laptop; add a second passkey from Settings.
3. Post with an image, reply from the other account, check the notification.
4. Open your profile → Edit portfolio, add a project with images.
5. Try the stay-fee checkout: the fake page appears; Pay completes it.

## Moving to a real domain later

Buy the domain, then follow [deploy.md](deploy.md) on a **fresh** database: new `RP_ID`/`WEB_ORIGIN`,
Stripe keys instead of `ALLOW_FAKE_PAYMENTS`, and either a disk volume or R2 for images instead of `STORAGE=db`.
