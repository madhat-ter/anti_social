/**
 * The API for the cPanel host (docs/deploy-cpanel.md), run by `deploy/cpanel/keeper.mjs`: the one
 * process that owns the database files. The web copies LiteSpeed starts (`server.mjs`) pass every
 * /api/… request to it over a local socket.
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
import { loadPushSender, type PushSender } from './lib/push';
import { loadStorage } from './lib/storage';
import { bootstrapInvites, bootstrapOps, bootstrapPinReset } from './lib/bootstrap';
import { importFileIfPresent } from './lib/transfer';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === 'EPERM'; }
};

/** Who opened the database: written into the lock file. */
export type Identity = { build: string; settings: string; started: number };
export type Holder = Identity & { pid: number };

const buildTime = (build: string) => (build.match(/\d{4}-\d\d-\d\dT[\d:.]+Z/) ?? [''])[0];

/**
 * Whether `me` should replace `holder`: a newer build, or the same build with other settings
 * (cPanel → Save) started later. Never the other way round, so an old copy that is still around
 * can't take the database back from a newer one, and two copies of the same kind never fight.
 * A lock in an older format (no identity) is always replaced.
 */
export function outranks(me: Identity, holder: Partial<Identity> | null): boolean {
  if (!holder?.build) return true;
  const a = buildTime(me.build);
  const b = buildTime(holder.build);
  if (a !== b) return a > b;
  return me.settings !== holder.settings && me.started > (holder.started ?? 0);
}

/** The lock file's holder, or null when there is none or it is no longer running. */
export function readHolder(file: string): (Partial<Identity> & { pid: number }) | null {
  let text: string;
  try { text = readFileSync(file, 'utf8').trim(); } catch { return null; }
  let h: Partial<Holder>;
  try { h = JSON.parse(text); } catch { h = { pid: Number(text.split(' ')[0]) }; } // older format: "<pid> <build>"
  return h.pid && alive(h.pid) ? (h as Partial<Identity> & { pid: number }) : null;
}

export class Outranked extends Error {}

/**
 * PGlite must never be opened by two processes: the files would be damaged. The lock file says who
 * holds it (pid, build, settings, start time). A newer copy (`outranks`) asks the holder to stop
 * (SIGTERM: it closes the database and exits) and waits for the files, up to a minute; anything
 * else gets `Outranked` and leaves the database alone. On LiteSpeed (2026-11-23) old processes are
 * never ended by the host, and it starts extra ones under load: hence one keeper (keeper.mjs).
 */
export async function lock(file: string, me: Identity): Promise<() => void> {
  let asked = false;
  for (let i = 0; i < 120; i++) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, ...me }), { flag: 'wx' });
      return () => {
        try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ }
      };
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e;
      const holder = readHolder(file);
      if (!holder || holder.pid === process.pid) { rmSync(file, { force: true }); continue; }
      if (!asked) {
        if (!outranks(me, holder)) throw new Outranked(`the database is held by pid ${holder.pid}, which is as new as this copy`);
        console.log(`db lock held by pid ${holder.pid} (${holder.build ?? 'an older build'}); asking it to stop`);
        try { process.kill(holder.pid, 'SIGTERM'); } catch (err) { console.error('could not signal it:', String(err)); }
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
  const me: Identity = { build: env.ANTI_BUILD ?? 'dev', settings: env.ANTI_SETTINGS ?? '', started: Number(env.ANTI_STARTED) || Date.now() };
  const unlock = await lock(join(dataDir, 'db.lock'), me);
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
    // RFC §10.30: with no VAPID_* settings, the data folder's own key pair (made once, never pasted)
    const ownKeys = !(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
    let push: PushSender;
    try { push = loadPushSender(env, dataDir); } catch (e) {
      console.error('web push keys could not be read or made, push stays off:', e);
      push = loadPushSender({});
    }
    const app = createApp({ db, cfg, storage, payments, push });
    const stopJobs = env.JOBS === 'off' ? () => {} : startScheduler(db, { storage, payments, push });
    const stopBackups = startBackups(join(dataDir, 'backups'), opened.backup);
    if (payments.kind === 'fake') console.log('FAKE payments: nobody is charged');
    console.log(push.publicKey ? `web push on (${ownKeys ? 'keys in the data folder, vapid.json' : 'keys from the settings'})` : 'web push disabled (no VAPID keys)');

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
