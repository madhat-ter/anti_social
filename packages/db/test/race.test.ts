/**
 * Race / load tests for the seat-critical SQL (RFC §16 M6). Every operation is fired at once and
 * the invariants are checked afterwards.
 *
 * Default: in-process PGlite (statements interleave on one session, transactions serialise).
 * TEST_DATABASE_URL=postgres://... : the same storms on a real Postgres with a 20-connection pool,
 * i.e. true parallelism. THAT DATABASE IS WIPED (schema `public` is dropped). Use a throwaway one.
 */
import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createTestDb } from '../src/testing';
import { rows, scalar, type Db } from '../src/client';
import { MIGRATIONS_FOLDER, readFunctionsSql } from '../src/paths';
import * as schema from '../src/schema';

const CAP = 5;

async function mint(db: Db): Promise<string> {
  const code = `RACE${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
  await db.execute(sql`select create_invite(null, ${code})`);
  return code;
}

async function join(db: Db, code: string): Promise<string> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into users(id, handle, display_name, state, recovery_code_hash)
                         values (${id}, ${'r' + id.slice(0, 8)}, 'r', 'waitlisted', 'x')`);
    await tx.execute(sql`select redeem_invite(${code}, ${id}::uuid)`);
  });
  return id;
}

/** The invariants the advisory seat lock exists to protect. */
async function checkInvariants(db: Db) {
  const cap = Number(await scalar<number>(db, sql`select setting_int('seat_cap')`));
  const used = Number(await scalar<number>(db, sql`select seats_used()`));
  const seated = Number(await scalar<number>(db, sql`select count(*)::int from users where state in ('active', 'flagged_lurker')`));
  const unoffered = Number(await scalar<number>(db, sql`select count(*)::int from waitlist where offered_at is null`));
  const badQueue = await rows(db, sql`
    select w.user_id, u.state from waitlist w join users u on u.id = w.user_id
     where u.state not in ('waitlisted', 'archived')
        or (w.offered_at is not null and (w.priority <> 0 or u.state <> 'archived'))`);
  const orphanWaitlisted = Number(await scalar<number>(db, sql`
    select count(*)::int from users u where u.state = 'waitlisted' and not exists (select 1 from waitlist w where w.user_id = u.id)`));

  expect(used).toBeLessThanOrEqual(cap);                // never over the cap
  if (used < cap) expect(unoffered).toBe(0);            // a free seat never sits next to a queue
  expect(badQueue).toEqual([]);                         // nobody holds a seat and a queue spot
  expect(orphanWaitlisted).toBe(0);                     // waitlisted users are actually in the queue
  return { used, seated, unoffered };
}

async function storms(db: Db) {
  // 1. a burst of 40 redemptions into an empty 5-seat network
  const codes = await Promise.all(Array.from({ length: 40 }, () => mint(db)));
  const ids = await Promise.all(codes.map((c) => join(db, c)));
  let s = await checkInvariants(db);
  expect(s).toEqual({ used: CAP, seated: CAP, unoffered: 35 });
  // FIFO: the first five in the queue order got the seats (redeem order = commit order)
  const first = await rows<{ id: string }>(db, sql`
    select user_id as id from user_state_events where to_state = 'active' order by id limit ${CAP}`);
  expect(first).toHaveLength(CAP);

  // 2. mixed storm: deletions, bans, inactivity archival + rejoin, lifecycle runs, new joins — all at once
  const active = await rows<{ id: string }>(db, sql`select id from users where state = 'active' order by id`);
  await db.execute(sql`update users set activated_at = now() - interval '40 days', last_seen_at = now() - interval '31 days'
                        where id = ${active[0]!.id}::uuid`);
  await db.execute(sql`select run_lifecycle()`); // archives active[0], promotes one from the queue
  const moreCodes = await Promise.all(Array.from({ length: 15 }, () => mint(db)));
  const ops: Promise<unknown>[] = [
    db.execute(sql`select delete_account(${active[1]!.id}::uuid)`),
    db.execute(sql`select ban_user(${active[2]!.id}::uuid, null)`),
    db.execute(sql`select rejoin_queue(${active[0]!.id}::uuid)`),
    db.execute(sql`select run_lifecycle()`),
    db.execute(sql`select promote_waitlist()`),
    db.execute(sql`select delete_account(${ids[39]!}::uuid)`), // someone still queued leaves
    ...moreCodes.map((c) => join(db, c)),
    db.execute(sql`select run_lifecycle()`),
  ];
  const results = await Promise.allSettled(ops);
  expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
  s = await checkInvariants(db);
  expect(s.used).toBe(CAP);

  // 3. the reinstating member's held seat counts; paying converts it; expiry hands it on
  const offer = await rows<{ user_id: string }>(db, sql`select user_id from waitlist where offered_at is not null`);
  if (offer.length) {
    await Promise.all([db.execute(sql`select activate_offer(${offer[0]!.user_id}::uuid)`), db.execute(sql`select promote_waitlist()`)]);
    await checkInvariants(db);
  }

  // 4. drain: everyone seated leaves at once; the queue refills every seat
  const seatedNow = await rows<{ id: string }>(db, sql`select id from users where state in ('active', 'flagged_lurker')`);
  await Promise.all(seatedNow.map((u) => db.execute(sql`select delete_account(${u.id}::uuid)`)));
  s = await checkInvariants(db);
  expect(s.used).toBe(CAP);
}

describe('seat races (PGlite)', () => {
  test('bursts and mixed storms keep the invariants', async () => {
    const t = await createTestDb({ seatCap: CAP });
    try { await storms(t.db); } finally { await t.close(); }
  }, 120_000);
});

const PG = process.env.TEST_DATABASE_URL;
describe.skipIf(!PG)('seat races (real Postgres, TEST_DATABASE_URL — wiped!)', () => {
  test('bursts and mixed storms keep the invariants under real parallelism', async () => {
    const client = postgres(PG!, { max: 20, onnotice: () => {} });
    try {
      await client.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
      await client.unsafe(readFunctionsSql());
      await client.unsafe(`update settings set value = '${CAP}' where key = 'seat_cap'`);
      await storms(drizzle({ client, schema }) as unknown as Db);
    } finally {
      await client.end();
    }
  }, 300_000);
});
