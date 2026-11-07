import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import type { Storage } from './storage';

/** RFC-0001 §12. Every job body is idempotent, so running one late, early or twice is harmless. */
export interface Job {
  name: string;
  everyMs: number;
  run: (tx: Db, deps: { storage: Storage }) => Promise<Record<string, number> | void>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORPHAN_UPLOAD_HOURS = 24;

export const JOBS: Job[] = [
  {
    name: 'lifecycle',
    everyMs: HOUR,
    run: async (tx) => {
      await tx.execute(sql`select run_lifecycle()`);
    },
  },
  {
    name: 'cleanup',
    everyMs: DAY,
    run: async (tx, { storage }) => {
      const sessions = await rows<{ n: number }>(tx, sql`
        with d as (delete from sessions where expires_at <= now() returning 1) select count(*)::int as n from d`);
      const challenges = await rows<{ n: number }>(tx, sql`
        with d as (delete from auth_challenges where expires_at <= now() returning 1) select count(*)::int as n from d`);
      const orphans = await rows<{ r2_key: string }>(tx, sql`
        delete from post_images
         where post_id is null and created_at < now() - make_interval(hours => ${ORPHAN_UPLOAD_HOURS})
        returning r2_key`);
      // Blobs are removed after the rows; a failed blob delete leaves an unreferenced file, never a dangling row.
      for (const o of orphans) await storage.delete(o.r2_key).catch((e) => console.error('orphan delete failed', o.r2_key, e));
      return { sessions: sessions[0]?.n ?? 0, challenges: challenges[0]?.n ?? 0, uploads: orphans.length };
    },
  },
];

/**
 * Runs one job inside a transaction holding a transaction-scoped advisory lock keyed by the job
 * name. If another API instance holds it, this one skips. The lock is released on commit/rollback,
 * so a crashed run never leaves it held.
 */
export async function runJob(db: Db, job: Job, deps: { storage: Storage }) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const got = await scalar<boolean>(t, sql`select pg_try_advisory_xact_lock(hashtext(${'anti:job:' + job.name}))`);
    if (!got) return { status: 'skipped' as const };
    const result = await job.run(t, deps);
    return { status: 'ran' as const, result: result ?? {} };
  });
}

/** Starts the in-process scheduler: each job once on boot, then every `everyMs`. Returns stop(). */
export function startScheduler(db: Db, deps: { storage: Storage }, jobs: Job[] = JOBS) {
  const running = new Set<string>();
  const tick = async (job: Job) => {
    if (running.has(job.name)) return; // previous run still going on this instance
    running.add(job.name);
    const t0 = Date.now();
    try {
      const r = await runJob(db, job, deps);
      if (r.status === 'ran') console.log(`[job] ${job.name} ran in ${Date.now() - t0}ms`, r.result);
    } catch (e) {
      console.error(`[job] ${job.name} failed`, e);
    } finally {
      running.delete(job.name);
    }
  };
  const timers = jobs.map((job) => {
    void tick(job);
    return setInterval(() => void tick(job), job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
