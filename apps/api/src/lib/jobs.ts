import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import type { Storage } from './storage';
import type { PaymentProvider } from './payments';
import { expireStaleCheckouts, processRefunds } from './billing';
import { fanOutPush, NoPushSender, type PushSender } from './push';
import { sweepConsultations } from './consultations';

export type JobDeps = { storage: Storage; payments: PaymentProvider; push?: PushSender };

/** RFC-0001 §12. Every job body is idempotent, so running one late, early or twice is harmless. */
export interface Job {
  name: string;
  everyMs: number;
  run: (tx: Db, deps: JobDeps) => Promise<Record<string, number> | void>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORPHAN_UPLOAD_HOURS = 24;
/** headline, skills, a published project, a first post, a pick, interests (GET /me/checklist) */
const CHECKLIST_ITEMS = 6;

export const JOBS: Job[] = [
  {
    name: 'lifecycle',
    everyMs: HOUR,
    run: async (tx) => {
      await tx.execute(sql`select run_lifecycle()`);
    },
  },
  {
    name: 'payments',
    everyMs: HOUR,
    run: async (tx, { payments }) => {
      const expired = await expireStaleCheckouts(tx);
      const r = await processRefunds(tx, payments);
      return { expired, ...r };
    },
  },
  {
    // "Finish your profile" (RFC §10.3): one reminder a day until all five are done. The newest
    // replaces the last unread one so they never pile up; finishing removes it. Hiding the
    // checklist window does not stop it. The first comes a day after setup.
    name: 'checklist',
    everyMs: HOUR,
    run: async (tx) => {
      const [r] = await rows<{ sent: number; cleared: number }>(tx, sql`
        with c as (
          select u.id, u.setup_done_at, (
              exists (select 1 from portfolios p where p.user_id = u.id and p.headline <> '')::int
            + exists (select 1 from portfolios p where p.user_id = u.id and jsonb_array_length(p.skills) > 0)::int
            + exists (select 1 from projects pr where pr.user_id = u.id and pr.draft = false)::int
            + exists (select 1 from posts po where po.author_id = u.id and po.deleted_at is null)::int
            + exists (select 1 from suggestions s where s.author_id = u.id and s.deleted_at is null)::int
            + exists (select 1 from user_interests ui where ui.user_id = u.id)::int
          ) as done
          from users u
          where u.state in ('active', 'flagged_lurker') and u.setup_done_at is not null
        ),
        due as (
          select c.id, c.done from c
           where c.done < ${CHECKLIST_ITEMS}::int and c.setup_done_at <= now() - interval '1 day'
             and not exists (select 1 from notifications n where n.user_id = c.id and n.kind = 'checklist_reminder'
                              and n.created_at > now() - interval '23 hours')
        ),
        cleared as (
          delete from notifications n using c
           where n.user_id = c.id and n.kind = 'checklist_reminder'
             and (c.done = ${CHECKLIST_ITEMS}::int or (n.read_at is null and c.id in (select id from due)))
          returning c.done
        ),
        sent as (
          insert into notifications (user_id, kind, payload)
          select id, 'checklist_reminder', jsonb_build_object('done', done, 'total', ${CHECKLIST_ITEMS}::int) from due
          returning 1
        )
        select (select count(*)::int from sent) as sent,
               (select count(*)::int from cleared where done = ${CHECKLIST_ITEMS}::int) as cleared`);
      return { sent: r?.sent ?? 0, cleared: r?.cleared ?? 0 };
    },
  },
  {
    // Consultations (RFC §10.6): expire unanswered requests and unagreed prices, wipe old contacts.
    name: 'consultations',
    everyMs: HOUR,
    run: async (tx) => sweepConsultations(tx),
  },
  {
    // Web Push fan-out of new notifications (RFC §12: near real time).
    name: 'push',
    everyMs: 10_000,
    run: async (tx, { push }) => fanOutPush(tx, push ?? new NoPushSender()),
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
      const limits = await rows<{ n: number }>(tx, sql`
        with d as (delete from rate_limits where window_start < now() - interval '2 days' returning 1) select count(*)::int as n from d`);
      // visitor passes (RFC §10.8) stay listed for admins for 30 days; every pass is long over by then
      const passes = await rows<{ n: number }>(tx, sql`
        with d as (delete from visitor_passes where created_at < now() - interval '30 days' returning 1) select count(*)::int as n from d`);
      return { sessions: sessions[0]?.n ?? 0, challenges: challenges[0]?.n ?? 0, uploads: orphans.length, rateLimits: limits[0]?.n ?? 0, visitorPasses: passes[0]?.n ?? 0 };
    },
  },
];

/**
 * Runs one job inside a transaction holding a transaction-scoped advisory lock keyed by the job
 * name. If another API instance holds it, this one skips. The lock is released on commit/rollback,
 * so a crashed run never leaves it held.
 */
export async function runJob(db: Db, job: Job, deps: JobDeps) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const got = await scalar<boolean>(t, sql`select pg_try_advisory_xact_lock(hashtext(${'anti:job:' + job.name}))`);
    if (!got) return { status: 'skipped' as const };
    const result = await job.run(t, deps);
    return { status: 'ran' as const, result: result ?? {} };
  });
}

/** Starts the in-process scheduler: each job once on boot, then every `everyMs`. Returns stop(). */
export function startScheduler(db: Db, deps: JobDeps, jobs: Job[] = JOBS) {
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
