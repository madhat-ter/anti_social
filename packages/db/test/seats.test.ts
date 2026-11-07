import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../src/testing';
import { dbErrorCode, scalar, type Db } from '../src/client';
import {
  age, contribute, join, lifecycle, mintInvite, newMember, seatsUsed, seenOnDays, stateOf, waitlistOf,
} from './helpers';

const CAP = 3;

async function withDb(fn: (db: Db) => Promise<void>) {
  const t = await createTestDb({ seatCap: CAP });
  try { await fn(t.db); } finally { await t.close(); }
}

async function expectDbError(p: Promise<unknown>, code: string) {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeDefined();
  expect(dbErrorCode(caught)).toBe(code);
}

describe('seat cap and waitlist', () => {
  test('fills seats up to the cap, then waitlists in FIFO order', () => withDb(async (db) => {
    const members = [];
    for (let i = 0; i < CAP; i++) members.push(await newMember(db));
    expect(members.map((m) => m.state)).toEqual(['active', 'active', 'active']);

    const w1 = await newMember(db);
    const w2 = await newMember(db);
    expect([w1.state, w2.state]).toEqual(['waitlisted', 'waitlisted']);
    expect(await seatsUsed(db)).toBe(CAP);

    // a member deletes their account → first in queue is promoted, second still waits
    await db.execute(sql`select delete_account(${members[0]!.id}::uuid)`);
    expect(await stateOf(db, w1.id)).toBe('active');
    expect(await stateOf(db, w2.id)).toBe('waitlisted');
    expect(await seatsUsed(db)).toBe(CAP);
  }));

  test('invalid, reused and expired invites are rejected and roll back the user row', () => withDb(async (db) => {
    await expectDbError(join(db, 'NOPENOPENOPENOPE'), 'invite_invalid');

    const code = await mintInvite(db);
    await join(db, code);
    await expectDbError(join(db, code), 'invite_invalid');

    const expired = await mintInvite(db);
    await db.execute(sql`update invites set expires_at = now() - interval '1 second' where code_hash = invite_hash(${expired})`);
    await expectDbError(join(db, expired), 'invite_invalid');

    expect(await scalar<number>(db, sql`select count(*)::int from users`)).toBe(1);
  }));

  test('invite tree is recorded', () => withDb(async (db) => {
    const a = await newMember(db);
    const b = await join(db, await mintInvite(db, a.id));
    expect(await scalar<string>(db, sql`select invited_by::text from users where id = ${b.id}`)).toBe(a.id);
  }));
});

describe('invite limits', () => {
  test('max 2 open invites per member; non-seated users cannot invite', () => withDb(async (db) => {
    const a = await newMember(db);
    await mintInvite(db, a.id);
    await mintInvite(db, a.id);
    await expectDbError(mintInvite(db, a.id), 'invite_limit');

    for (let i = 0; i < CAP; i++) await newMember(db);
    const waiting = await newMember(db);
    expect(waiting.state).toBe('waitlisted');
    await expectDbError(mintInvite(db, waiting.id), 'invite_not_allowed_state');
  }));
});

describe('inactivity', () => {
  test('30 days unseen → archived, seat goes to the waitlist', () => withDb(async (db) => {
    const a = await newMember(db);
    await newMember(db); await newMember(db);
    const w = await newMember(db);
    expect(w.state).toBe('waitlisted');

    await age(db, a.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 31 });
    await lifecycle(db);

    expect(await stateOf(db, a.id)).toBe('archived');
    expect(await stateOf(db, w.id)).toBe('active');
  }));

  test('seen 29 days ago is not archived', () => withDb(async (db) => {
    const a = await newMember(db);
    await age(db, a.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 29 });
    await lifecycle(db);
    expect(await stateOf(db, a.id)).toBe('active');
  }));
});

describe('lurkers', () => {
  async function lurker(db: Db) {
    const m = await newMember(db);
    await age(db, m.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 0 });
    await seenOnDays(db, m.id, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    return m;
  }

  test('seen often but not contributing → flagged', () => withDb(async (db) => {
    const m = await lurker(db);
    await contribute(db, m.id, 1);
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('flagged_lurker');
  }));

  test('two contributions in the window → not flagged', () => withDb(async (db) => {
    const m = await lurker(db);
    await contribute(db, m.id, 2);
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('active');
  }));

  test('new members are exempt for 21 days', () => withDb(async (db) => {
    const m = await lurker(db);
    await age(db, m.id, { activatedDaysAgo: 10 });
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('active');
  }));

  test('flagged lurker who contributes twice is cleared', () => withDb(async (db) => {
    const m = await lurker(db);
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('flagged_lurker');
    await contribute(db, m.id, 2);
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('active');
  }));

  test('grace expiry → archived', () => withDb(async (db) => {
    const m = await lurker(db);
    await lifecycle(db);
    await db.execute(sql`update users set lurker_flagged_at = now() - interval '8 days' where id = ${m.id}`);
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('archived');
  }));

  test('stay fee clears the flag and exempts for 90 days', () => withDb(async (db) => {
    const m = await lurker(db);
    await lifecycle(db);
    await db.execute(sql`select pay_stay_fee(${m.id}::uuid)`);
    expect(await stateOf(db, m.id)).toBe('active');
    await lifecycle(db);
    expect(await stateOf(db, m.id)).toBe('active');
  }));
});

describe('reinstatement', () => {
  test('archived member queues with priority, gets a seat offer, pays, is active', () => withDb(async (db) => {
    const a = await newMember(db);
    const b = await newMember(db);
    await newMember(db);
    await age(db, a.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 31 });
    await lifecycle(db); // a archived; a seat is free
    const newcomer = await newMember(db); // takes the free seat
    expect(newcomer.state).toBe('active');

    const queued = await newMember(db); // cap full → waitlisted (priority 1)
    await db.execute(sql`select rejoin_queue(${a.id}::uuid)`); // priority 0, jumps ahead
    expect((await waitlistOf(db)).map((w) => w.user_id)).toEqual([a.id, queued.id]);

    await db.execute(sql`select delete_account(${b.id}::uuid)`); // frees one seat → offered to a
    const [offer] = await waitlistOf(db);
    expect(offer!.user_id).toBe(a.id);
    expect(offer!.offered_at).not.toBeNull();
    expect(await stateOf(db, queued.id)).toBe('waitlisted'); // the offer holds the seat
    expect(await seatsUsed(db)).toBe(CAP);

    await db.execute(sql`select activate_offer(${a.id}::uuid)`);
    expect(await stateOf(db, a.id)).toBe('active');
    expect(await seatsUsed(db)).toBe(CAP);
  }));

  test('expired offer releases the seat to the next in line; late payment is refused', () => withDb(async (db) => {
    const a = await newMember(db);
    const b = await newMember(db);
    await newMember(db);
    await age(db, a.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 31 });
    await lifecycle(db);
    await newMember(db); // fills the seat a vacated
    const queued = await newMember(db);
    await db.execute(sql`select rejoin_queue(${a.id}::uuid)`);
    await db.execute(sql`select delete_account(${b.id}::uuid)`); // offer to a

    await db.execute(sql`update waitlist set offer_expires_at = now() - interval '1 second' where user_id = ${a.id}`);
    await lifecycle(db);

    expect(await stateOf(db, a.id)).toBe('archived');
    expect(await stateOf(db, queued.id)).toBe('active');
    await expectDbError(db.execute(sql`select activate_offer(${a.id}::uuid)`), 'no_open_offer');
  }));

  test('only archived users can rejoin', () => withDb(async (db) => {
    const a = await newMember(db);
    await expectDbError(db.execute(sql`select rejoin_queue(${a.id}::uuid)`), 'rejoin_not_applicable');
  }));
});

describe('bans', () => {
  test('ban frees the seat and penalises the inviter', () => withDb(async (db) => {
    const inviter = await newMember(db);
    const bad = await join(db, await mintInvite(db, inviter.id));
    await newMember(db);
    const w = await newMember(db);
    expect(w.state).toBe('waitlisted');

    await db.execute(sql`select ban_user(${bad.id}::uuid, null)`);
    expect(await stateOf(db, bad.id)).toBe('banned');
    expect(await stateOf(db, w.id)).toBe('active');
    await expectDbError(mintInvite(db, inviter.id), 'invite_penalty');
  }));
});

describe('state log', () => {
  test('every transition is recorded', () => withDb(async (db) => {
    const a = await newMember(db);
    await age(db, a.id, { activatedDaysAgo: 40, lastSeenDaysAgo: 31 });
    await lifecycle(db);
    const log = await scalar<string>(db, sql`
      select string_agg(coalesce(from_state::text, '∅') || '→' || to_state::text || ':' || reason, ' | ' order by id)
        from user_state_events where user_id = ${a.id}`);
    expect(log).toBe('∅→waitlisted:invite_redeemed | waitlisted→active:waitlist_promoted | active→archived:inactive');
  }));
});
