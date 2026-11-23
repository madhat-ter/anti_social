/**
 * The API inside another Node.js server, with its database as files (cPanel host, see
 * docs/deploy-cpanel.md). `deploy/cpanel/server.mjs` sends every /api/… request here and the rest
 * to Next.js, so the whole site is one process: one app in cPanel, one address, one database owner.
 *
 * Differences from index.ts (Bun on Render): no listen() of its own, PGlite instead of a database
 * server, a lock file so two copies never open the database together, and a one-time import.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLocalDb } from '@anti/db';
import { loadConfig, loadPaymentProvider } from './config';
import { createApp } from './app';
import { startScheduler } from './lib/jobs';
import { loadPushSender } from './lib/push';
import { loadStorage } from './lib/storage';
import { bootstrapInvites, bootstrapOps, bootstrapPinReset } from './lib/bootstrap';
import { importFileIfPresent } from './lib/transfer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === 'EPERM'; }
};

/**
 * PGlite must never be opened by two processes: the files would be damaged. The lock file holds
 * "<pid> <build>". The newest copy wins: when the host starts a new one while an old one is still
 * running, the old one is asked to stop (SIGTERM: it closes the database and exits) and the new
 * one waits for the files (up to a minute). Seen on LiteSpeed (2026-11-23): Restart and Stop App
 * start a new process but never end the old one, whose timers keep it alive for ever. An old copy
 * never signals a newer one: it only ever finds the lock free or held by something older.
 */
export async function lock(file: string, build: string): Promise<() => void> {
  let asked = false;
  for (let i = 0; i < 120; i++) {
    try {
      writeFileSync(file, `${process.pid} ${build}`, { flag: 'wx' });
      return () => {
        try { if (Number(readFileSync(file, 'utf8').split(' ')[0]) === process.pid) rmSync(file, { force: true }); } catch { /* gone */ }
      };
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e;
      const [pidText = '', ...rest] = readFileSync(file, 'utf8').trim().split(' ');
      const pid = Number(pidText);
      const theirs = rest.join(' ');
      if (!pid || pid === process.pid || !alive(pid)) { rmSync(file, { force: true }); continue; }
      if (!asked) {
        console.log(`db lock held by pid ${pid} (${theirs || 'an older build'}); asking it to stop`);
        try { process.kill(pid, 'SIGTERM'); } catch (err) { console.error('could not signal it:', String(err)); }
        asked = true;
      }
      await sleep(500);
    }
  }
  throw new Error(`another copy of the API still holds ${file}`);
}

const KEEP_BACKUPS = 7;

/**
 * A copy of the database files once a day (and a few minutes after each start if today's is
 * missing), the newest 7 kept, in `<data>/backups`. cPanel's own backups then hold these too.
 */
function startBackups(dir: string, dump: () => Promise<Uint8Array>): () => void {
  const today = () => `pg-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  const take = async () => {
    try {
      mkdirSync(dir, { recursive: true });
      const name = today();
      if (readdirSync(dir).includes(name)) return;
      const t0 = Date.now();
      const bytes = await dump();
      writeFileSync(join(dir, `${name}.part`), bytes);
      renameSync(join(dir, `${name}.part`), join(dir, name));
      const old = readdirSync(dir).filter((f) => /^pg-\d{4}-\d\d-\d\d\.tar\.gz$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
      for (const f of old) rmSync(join(dir, f), { force: true });
      console.log(`backup: ${name}, ${Math.round(bytes.length / 1024)} KB in ${Date.now() - t0} ms`);
    } catch (e) {
      console.error('backup failed:', e);
    }
  };
  const first = setTimeout(take, 3 * 60_000);
  const daily = setInterval(take, 60 * 60_000); // hourly check; writes at most one per day
  first.unref?.();
  daily.unref?.();
  return () => { clearTimeout(first); clearInterval(daily); };
}

export type EmbeddedApi ={ handle(request: Request): Promise<Response>; close(): Promise<void> };

export async function startEmbeddedApi(env: Record<string, string | undefined> = process.env): Promise<EmbeddedApi> {
  const dataDir = env.ANTI_DATA_DIR;
  if (!dataDir) throw new Error('ANTI_DATA_DIR is not set (the folder for the database files)');
  mkdirSync(dataDir, { recursive: true });
  const cfg = loadConfig(env);
  const unlock = await lock(join(dataDir, 'db.lock'), (env.ANTI_BUILD ?? 'dev').replace(/\s+/g, '_'));
  let closeDb: (() => Promise<void>) | undefined;
  try {
    const t0 = Date.now();
    const opened = await openLocalDb(join(dataDir, 'pg'));
    closeDb = opened.close;
    const { db } = opened;
    console.log(`database open in ${Date.now() - t0} ms`);
    // a bad file must not keep the site from starting: it stays put (nothing was changed) for a look
    await importFileIfPresent(db, join(dataDir, 'import.ndjson.gz')).catch((e) => console.error('import failed, nothing loaded:', e));
    if (env.BOOTSTRAP_INVITES) await bootstrapInvites(db, Number(env.BOOTSTRAP_INVITES));
    if (env.OPS_HANDLES) await bootstrapOps(db, env.OPS_HANDLES);
    if (env.PIN_RESET_HANDLE) await bootstrapPinReset(db, env.PIN_RESET_HANDLE);

    const storage = loadStorage(db, env);
    const payments = loadPaymentProvider(cfg);
    const push = loadPushSender();
    const app = createApp({ db, cfg, storage, payments, push });
    const stopJobs = env.JOBS === 'off' ? () => {} : startScheduler(db, { storage, payments, push });
    const stopBackups = startBackups(join(dataDir, 'backups'), opened.backup);
    if (payments.kind === 'fake') console.log('FAKE payments: nobody is charged');
    if (!push.publicKey) console.log('web push disabled (no VAPID keys)');

    let closed = false;
    return {
      handle: (request) => app.handle(request),
      async close() {
        if (closed) return;
        closed = true;
        stopJobs();
        stopBackups();
        await opened.close();
        unlock();
      },
    };
  } catch (e) {
    await closeDb?.().catch(() => {});
    unlock();
    throw e;
  }
}
