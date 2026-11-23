# The real site on cPanel (tryanti.social)

RFC §10.27 has the why. This is the how. The whole site (web pages, API, database) is **one
Node.js app** in cPanel. The database is Postgres kept as files (PGlite), because the hosting has
MySQL only.

```
~/anti-app/              the Node.js app (cPanel "Application root")
  app.cjs                startup file
  anti/server.mjs        /api/… → API, everything else → Next.js
  anti/web/  anti/api/  anti/drizzle/  anti/sql/  anti/BUILD.txt
~/anti-data/             never inside public_html, never replaced by a deploy
  pg/                    the database files
  backups/pg-YYYY-MM-DD.tar.gz   one a day, newest 7
  import.ndjson.gz       only when moving data in (renamed after it loads)
```

## Making the build

```powershell
bun scripts/build-cpanel.ts --publish   # → .cpanel/anti-cpanel.zip, and the cpanel-site branch
```

It builds on Windows for Linux in a copy of the repo (`.cpanel/src`), so the working tree is not
touched. `anti/BUILD.txt` says which commit it came from. `--publish` makes the built files the
newest commit of the **`cpanel-site`** branch (built files only; Vercel is told not to build it,
Render only follows `main`). cPanel pulls that branch. Why not upload the zip: a browser upload
here is capped at 10 MB, and the owner's connection changes address, which ends cPanel sessions.

## First setup (done once)

1. **DNS**: Spaceship → the domain's name servers are `ns1.nemesys.work` / `ns2.nemesys.work`, so
   cPanel's Zone Editor holds the records (A `tryanti.social` → the server, CNAME `www`).
2. **HTTPS**: cPanel → SSL/TLS Status. AutoSSL issues the free certificate on its own schedule once
   DNS points here. Passkeys and the sign-in cookie need it.
3. **Files**: Git Version Control → Create → Clone URL `https://github.com/madhat-ter/anti_social.git`,
   branch `cpanel-site`, Repository Path `anti-app`.
4. **Setup Node.js App** → Create application:
   - Node.js version 22, Application mode Production
   - Application root `anti-app`, Application URL `tryanti.social` (empty path), startup file `app.cjs`
   - Environment variables:

| Name | Value |
|---|---|
| `WEB_ORIGIN` | `https://tryanti.social` |
| `RP_ID` | `tryanti.social` |
| `TRUST_PROXY` | `true` (LiteSpeed puts the visitor's address last in X-Forwarded-For; server.mjs keeps only that) |
| `ANTI_DATA_DIR` | `/home/<cpanel user>/anti-data` |
| `STORAGE` | `db` (images and recordings in the database, like the test site) |
| `PAYMENTS` / `ALLOW_FAKE_PAYMENTS` | `fake` / `true` (nobody is charged, RFC §10.27) |
| `SELF_URL` | `https://tryanti.social` (keeps the app awake so the jobs run) |
| `CONTACT_KEY` | the **same** value as on Render, pasted by the owner (never in chat) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional, for push; the same as before if any |

   No `npm install` is needed: everything is in the branch.

## Moving the members in (once)

1. On Render → anti-api → Environment: add `ALLOW_EXPORT` = `true` (Save, it redeploys).
2. Signed in as an admin on the test site, open `https://anti-social-opal.vercel.app/api/ops/export`.
   It downloads `anti-export-<date>.ndjson.gz`. Treat it like the database itself.
3. Upload it to `~/anti-data/` and rename it `import.ndjson.gz`.
4. Restart the app in Setup Node.js App. The log says `import: done, users N, …`. It only loads into
   a site with no members, and renames the file so it never runs twice.
5. On Render: remove `ALLOW_EXPORT`. Delete the downloaded file from your computer.

## Updating the site

`bun scripts/build-cpanel.ts --publish`, then in cPanel: Git Version Control → anti-app → Manage →
Pull or Deploy → **Update from Remote**, then **Restart** in Setup Node.js App.
Migrations run on start. `~/anti-data` is never touched by an update.

## When something is wrong

- **The app's log**: `~/anti-data/logs/app.log` (the host's own `~/anti-app/stderr.log` stays
  empty). Lines to look for: `database open`, `anti listening (built …)`,
  `anti stopping: …`, `anti crashed`, `db lock held by pid …`.
- **LiteSpeed never ends the old process** on Restart or Stop App (seen 2026-11-23). The newest
  copy therefore asks whoever holds `~/anti-data/db.lock` to stop (it closes the database and
  exits), then opens it: the log says `db lock held by pid … asking it to stop`. Stop App alone
  leaves the old copy running until the next start.
- **"another copy of the API still holds …/db.lock"**: the old copy didn't stop within a minute.
  Restart again; if it repeats, ask the host to end the `node` processes of this account.
- **Restore a backup**: stop the app, move `~/anti-data/pg` away, make an empty `pg` and extract the
  chosen `backups/pg-….tar.gz` into it, start the app.
