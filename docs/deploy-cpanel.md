# The real site on cPanel (tryanti.social)

RFC §10.27 has the why. This is the how. The whole site (web pages, API, database) is **one
Node.js app** in cPanel. The database is Postgres kept as files (PGlite), because the hosting has
MySQL only.

```
~/anti-app/              the Node.js app (cPanel "Application root"), a clone of branch cpanel-site
  app.cjs                startup file → anti/server.mjs
  anti/server.mjs        a web copy: pages (Next.js); /api/… passed to the keeper
  anti/keeper.mjs        the keeper: the one process that opens the database
  anti/common.mjs  anti/web/  anti/api/  anti/drizzle/  anti/sql/  anti/BUILD.txt
~/anti-data/             never inside public_html, never replaced by a deploy
  pg/                    the database files
  db.lock                who holds them: pid, build, settings hash, start time
  api.sock               where the keeper answers the web copies
  logs/app.log           everything both print (web[pid] / keeper[pid])
  backups/pg-YYYY-MM-DD.tar.gz   one a day, newest 7
  import.ndjson.gz       only when moving data in (renamed after it loads)
```

## Why a keeper (seen on this host, 2026-11-23)

LiteSpeed runs the app's startup file in as many processes as it likes: it starts extra ones
when several requests arrive together (one page load is enough), and on Restart or Stop App it
starts new ones **without ending the old ones**. A database in files can only be opened by one
process. So the web copies never open it. The first web copy that finds no keeper starts one
(detached, so it outlives web copies); it runs the API, the timed jobs and the backups.

A web copy starts a new keeper when the running one is **older**: an older build, or the same
build with other settings (cPanel → Save) started before this web copy. The new keeper asks the
old one to stop (it closes the database and exits) and takes over. Nothing older ever replaces
something newer, so old web copies that LiteSpeed leaves around just use the newest keeper.
If the host ends the keeper, the next /api request starts another (about 2 s).

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
| `CONTACT_KEY` | the **same** value as on Render, pasted by the owner (never in chat) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional, for push; the same as before if any |

   No `npm install` is needed: everything is in the branch. cPanel keeps these settings as
   `SetEnv` lines in `~/public_html/.htaccess` (LiteSpeed never serves that file).
5. **One address**: at the top of `~/public_html/.htaccess`, above cPanel's managed blocks (added
   2026-11-23; the previous file is kept as `.htaccess.before-anti-redirect`). Sign-in and passkeys
   only work on `https://tryanti.social`, so `www.` and plain `http://` forward there:

   ```apache
   RewriteEngine On
   RewriteCond %{REQUEST_URI} !^/\.well-known/
   RewriteCond %{HTTPS} !=on [OR]
   RewriteCond %{HTTP_HOST} !^tryanti\.social$ [NC]
   RewriteRule ^ https://tryanti.social%{REQUEST_URI} [R=301,L]
   ```

## Moving the members in (once)

1. On Render → anti-api → Environment: add `ALLOW_EXPORT` = `true` (Save, it redeploys).
2. Signed in as an admin on the test site, open `https://anti-social-opal.vercel.app/api/ops/export`.
   It downloads `anti-export-<date>.ndjson.gz`. Treat it like the database itself.
3. Upload it to `~/anti-data/` and rename it `import.ndjson.gz`.
4. Restart the app in Setup Node.js App. The log says `import: done, users N, …`. It only loads into
   a site with no members, and renames the file so it never runs twice.
5. On Render: remove `ALLOW_EXPORT`. Delete the downloaded file from your computer.

## Updating the site

The build keeps the previous build's static files (css/js) beside the new ones (`anti/STATIC.txt`
lists each build's own), because an old web copy LiteSpeed leaves running still links them; on
2026-11-23 every page lost its CSS until the old copy was ended. If restarts stop starting new
copies, the owner ends them as root in WHM → Terminal: `pkill -TERM -u tryanti -f 'lsnode|anti-app/'`.

`bun scripts/build-cpanel.ts --publish` (add `--no-push` to only stage it in `.cpanel/site-repo`), then in cPanel: Git Version Control → anti-app → Manage →
Pull or Deploy → **Update from Remote**, then **Restart** in Setup Node.js App and open the site once:
the first new web copy starts a new keeper, which takes over (log: `starting a keeper: it is
older`, then `asking it to stop`, `keeper ready`). Migrations run when the keeper opens the
database. `~/anti-data` is never touched by an update.

## When something is wrong

- **The app's log**: `~/anti-data/logs/app.log` (the host's own `~/anti-app/stderr.log` stays
  empty). Lines to look for: `keeper ready (built …)`, `web listening`, `starting a keeper: …`,
  `keeper stopping: …`, `keeper crashed`, `db lock held by pid …`, `api request failed`.
- **"another copy of the API still holds …/db.lock"**: an old keeper didn't stop within a minute.
  Restart again; if it repeats, ask the host to end the `node` processes of this account.
- **Stop App** stops LiteSpeed sending visitors, but neither the old web copies nor the keeper
  end (the keeper keeps running the jobs). That is expected.
- **Restore a backup**: stop the app, move `~/anti-data/pg` away, make an empty `pg` and extract the
  chosen `backups/pg-….tar.gz` into it, start the app.
