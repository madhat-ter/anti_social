import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { rows, scalar, type Db } from '../src/client';

let n = 0;

export async function mintInvite(db: Db, creator: string | null = null): Promise<string> {
  const code = `TESTCODE${String(++n).padStart(8, '0')}`;
  await db.execute(sql`select create_invite(${creator}::uuid, ${code})`);
  return code;
}

/** Simulates a full registration: user row + redeem, in one transaction. Returns resulting state. */
export async function join(db: Db, code: string, handle = `user${++n}`): Promise<{ id: string; state: string }> {
  const id = randomUUID();
  const state = await db.transaction(async (tx) => {
    await tx.execute(sql`insert into users(id, handle, display_name, state, recovery_code_hash)
                         values (${id}, ${handle}, ${handle}, 'waitlisted', 'x')`);
    return scalar<string>(tx as unknown as Db, sql`select redeem_invite(${code}, ${id}::uuid)`);
  });
  return { id, state: state! };
}

/** Founder invite + join, i.e. a fresh user who takes a seat if one is free. */
export async function newMember(db: Db) {
  return join(db, await mintInvite(db));
}

export async function stateOf(db: Db, id: string): Promise<string> {
  return (await scalar<string>(db, sql`select state from users where id = ${id}`))!;
}

export async function seatsUsed(db: Db): Promise<number> {
  return (await scalar<number>(db, sql`select seats_used()`))!;
}

export async function waitlistOf(db: Db) {
  return rows<{ user_id: string; priority: number; offered_at: string | null }>(
    db, sql`select user_id, priority, offered_at from waitlist order by priority, enqueued_at`);
}

export async function lifecycle(db: Db) {
  await db.execute(sql`select run_lifecycle()`);
}

/** Move a user's timeline back: activated N days ago, last seen M days ago. */
export async function age(db: Db, id: string, o: { activatedDaysAgo?: number; lastSeenDaysAgo?: number }) {
  if (o.activatedDaysAgo !== undefined)
    await db.execute(sql`update users set activated_at = now() - make_interval(days => ${o.activatedDaysAgo}) where id = ${id}`);
  if (o.lastSeenDaysAgo !== undefined)
    await db.execute(sql`update users set last_seen_at = now() - make_interval(days => ${o.lastSeenDaysAgo}) where id = ${id}`);
}

export async function seenOnDays(db: Db, id: string, daysAgo: number[]) {
  for (const d of daysAgo)
    await db.execute(sql`insert into user_seen_days(user_id, day) values (${id}, current_date - ${d}::int) on conflict do nothing`);
}

export async function contribute(db: Db, id: string, count: number, daysAgo = 0) {
  for (let i = 0; i < count; i++)
    await db.execute(sql`insert into contributions(user_id, kind, ref_id, at)
                         values (${id}, 'post', ${randomUUID()}, now() - make_interval(days => ${daysAgo}))`);
}
