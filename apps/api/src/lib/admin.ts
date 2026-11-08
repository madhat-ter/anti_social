/**
 * What a moderator (role 'ops') can do beyond the report queue: see everyone, ban and unban,
 * make or remove admins, change anyone's handle (their own too), and tune the room.
 * Guards live here so the HTTP routes and any future CLI share them.
 */
import { sql } from 'drizzle-orm';
import { isUniqueViolation, rows, scalar, type Db } from '@anti/db';
import { MIN_AGE, validateHandle } from '@anti/shared';
import { ApiError, rethrowDb } from './errors';
import { checkBirthday, closeAccount } from './account';
import type { Storage } from './storage';

const iso = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export type AdminMember = {
  handle: string; displayName: string; state: string; role: 'member' | 'ops'; gender: string | null;
  joinedAt: string; activatedAt: string | null; lastSeenAt: string | null;
  invitedBy: string | null; postCount: number;
  /** whole years; admins only (members never see an age or a year) */
  age: number | null;
};

/** Everyone except deleted accounts: seated first (admins on top), then the queue, archived, banned. */
export async function adminMembers(db: Db): Promise<AdminMember[]> {
  const r = await rows<{
    handle: string; display_name: string; state: string; role: 'member' | 'ops'; gender: string | null; joined: string;
    activated: string | null; seen: string | null; inv: string | null; posts: number; age: number | null;
  }>(db, sql`
    select u.handle, u.display_name, u.state, u.role, u.gender,
      ${iso(sql`u.created_at`)} as joined, ${iso(sql`u.activated_at`)} as activated, ${iso(sql`u.last_seen_at`)} as seen,
      inv.handle as inv,
      (select count(*)::int from posts p where p.author_id = u.id and p.deleted_at is null) as posts,
      case when u.birthday is not null then date_part('year', age(current_date, u.birthday))::int end as age
    from users u left join users inv on inv.id = u.invited_by
    where u.state <> 'deleted'
    order by case u.state when 'active' then 0 when 'flagged_lurker' then 0 when 'waitlisted' then 1 when 'archived' then 2 else 3 end,
             (u.role = 'ops') desc, lower(u.handle)
    limit 2000`);
  return r.map((x) => ({
    handle: x.handle, displayName: x.display_name, state: x.state, role: x.role, gender: x.gender ?? null,
    joinedAt: x.joined, activatedAt: x.activated, lastSeenAt: x.seen, invitedBy: x.inv, postCount: Number(x.posts),
    age: x.age === null ? null : Number(x.age),
  }));
}

type Target = { id: string; handle: string; role: 'member' | 'ops'; state: string };

async function findMember(db: Db, handle: string): Promise<Target> {
  const h = handle.trim().replace(/^@/, '');
  const [u] = await rows<Target>(db, sql`
    select id, handle, role, state from users where lower(handle) = lower(${h}) and state <> 'deleted'`);
  if (!u) throw new ApiError(404, 'not_found', `No member @${h}.`);
  return u;
}

/** Lift a ban: a seat at once if one is free, otherwise the queue. Returns the new state. */
export async function unbanMember(db: Db, handle: string, actorId: string) {
  const u = await findMember(db, handle);
  if (u.state !== 'banned') throw new ApiError(409, 'not_banned', `@${u.handle} is not banned.`);
  try {
    const state = await scalar<string>(db, sql`select unban_user(${u.id}::uuid, ${actorId}::uuid)`);
    return { handle: u.handle, state: state ?? 'active' };
  } catch (e) {
    rethrowDb(e);
  }
}

/**
 * Make someone an admin, or take it away. Only members with a seat can be made admin, and the
 * last admin cannot be removed (someone has to be able to run the room).
 */
export async function setMemberRole(db: Db, handle: string, role: 'member' | 'ops', actorId: string) {
  const u = await findMember(db, handle);
  if (u.role === role) return { handle: u.handle, role };
  if (role === 'ops' && u.state !== 'active' && u.state !== 'flagged_lurker') {
    throw new ApiError(409, 'not_seated', 'Only members with a seat can be admins.');
  }
  await db.transaction(async (txx) => {
    const tx = txx as unknown as Db;
    if (role === 'member') {
      // lock every admin row so two admins can't remove each other at the same moment
      const admins = await rows<{ id: string }>(tx, sql`
        select id from users where role = 'ops' and state not in ('banned', 'deleted') for update`);
      if (!admins.some((a) => a.id !== u.id)) {
        throw new ApiError(409, 'last_admin', 'The site needs at least one admin. Make someone else admin first.');
      }
    }
    await tx.execute(sql`update users set role = ${role}::user_role where id = ${u.id}::uuid`);
    if (role === 'ops' && u.state === 'flagged_lurker') {
      // admins are exempt from the lurker rule: clear a pending flag now rather than at the next hourly run
      await tx.execute(sql`select seat_lock()`);
      await tx.execute(sql`select set_state(${u.id}::uuid, 'active', 'ops_exempt', ${actorId}::uuid)`);
    }
    if (u.id !== actorId) {
      await tx.execute(sql`insert into notifications(user_id, kind, payload)
        values (${u.id}::uuid, ${role === 'ops' ? 'made_admin' : 'admin_removed'}, '{}'::jsonb)`);
    }
  });
  return { handle: u.handle, role };
}

/**
 * Change a member's handle (an admin can change their own). Same rules as signing up: 3–20
 * letters, digits or underscores, not reserved, not taken (case-insensitively). Changing only
 * the letter case of your own handle is allowed. The member is told, unless it is you.
 * The face is drawn from the handle, so it changes too; links to the old /u/<handle> stop working.
 */
export async function renameMember(db: Db, handle: string, next: string, actorId: string) {
  const u = await findMember(db, handle);
  const to = next.trim().replace(/^@/, '');
  const bad = validateHandle(to);
  if (bad) throw new ApiError(400, 'handle_invalid', bad);
  if (to === u.handle) return { from: u.handle, handle: to };
  try {
    await db.transaction(async (txx) => {
      const tx = txx as unknown as Db;
      const clash = await scalar<boolean>(tx, sql`
        select exists (select 1 from users where lower(handle) = lower(${to}) and id <> ${u.id}::uuid)`);
      if (clash) throw new ApiError(409, 'handle_taken', 'That handle is taken.');
      await tx.execute(sql`update users set handle = ${to} where id = ${u.id}::uuid`);
      if (u.id !== actorId) {
        await tx.execute(sql`insert into notifications(user_id, kind, payload)
          values (${u.id}::uuid, 'handle_changed', ${JSON.stringify({ from: u.handle, to })}::jsonb)`);
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'handle_taken', 'That handle is taken.');
    throw e;
  }
  return { from: u.handle, handle: to };
}

/**
 * An admin corrects someone's birthday (members can't change their own; RFC §10.3). Under 13 the
 * account is closed, the same as at setup, but only with confirmUnderage (the page asks first).
 */
export async function setMemberBirthday(
  db: Db, storage: Storage, handle: string, birthday: string, confirmUnderage: boolean, actorId: string,
) {
  const u = await findMember(db, handle);
  const b = checkBirthday(birthday);
  if (b.age >= MIN_AGE) {
    await db.execute(sql`update users set birthday = ${b.iso}::date where id = ${u.id}::uuid`);
    return { handle: u.handle, age: b.age, closed: false as const };
  }
  if (!confirmUnderage) {
    throw new ApiError(409, 'underage', `That makes @${u.handle} ${b.age}. Their account will be closed.`);
  }
  if (u.role === 'ops') {
    const others = Number(await scalar(db, sql`select count(*) from users where role = 'ops' and state not in ('banned', 'deleted') and id <> ${u.id}::uuid`));
    if (others < 1) throw new ApiError(409, 'last_admin', 'The site needs at least one admin. Make someone else admin first.');
  }
  await closeAccount(db, storage, u.id, 'underage', actorId);
  return { handle: u.handle, age: b.age, closed: true as const };
}

// ─── The room's settings ────────────────────────────────────────────────────

/** The settings an admin can change from the site, with their bounds. */
const EDITABLE = {
  seatCap: { key: 'seat_cap', min: 1, max: 1000 },
  invitesPerMember: { key: 'max_open_invites', min: 0, max: 20 },
  inviteExpiryDays: { key: 'invite_expiry_days', min: 1, max: 60 },
} as const;
export type AdminSettings = { seatCap: number; invitesPerMember: number; inviteExpiryDays: number; seatsUsed: number };
export type AdminSettingsInput = Partial<Record<keyof typeof EDITABLE, number>>;

export async function getAdminSettings(db: Db): Promise<AdminSettings> {
  const [r] = await rows<{ cap: number; inv: number; exp: number; used: number }>(db, sql`
    select setting_int('seat_cap') as cap, setting_int('max_open_invites') as inv,
           setting_int('invite_expiry_days') as exp, seats_used() as used`);
  return { seatCap: Number(r!.cap), invitesPerMember: Number(r!.inv), inviteExpiryDays: Number(r!.exp), seatsUsed: Number(r!.used) };
}

/**
 * Raising the seat cap seats people waiting in line right away. Lowering it below the people
 * already seated removes nobody: new people simply wait until the room is under the cap.
 */
export async function updateAdminSettings(db: Db, input: AdminSettingsInput): Promise<AdminSettings> {
  const changes: { key: string; value: number }[] = [];
  for (const [name, spec] of Object.entries(EDITABLE) as [keyof typeof EDITABLE, (typeof EDITABLE)[keyof typeof EDITABLE]][]) {
    const v = input[name];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < spec.min || v > spec.max) {
      throw new ApiError(400, 'setting_invalid', `${name} must be a whole number from ${spec.min} to ${spec.max}.`);
    }
    changes.push({ key: spec.key, value: v });
  }
  if (changes.length) {
    await db.transaction(async (txx) => {
      const tx = txx as unknown as Db;
      for (const c of changes) {
        await tx.execute(sql`update settings set value = ${JSON.stringify(c.value)}::jsonb where key = ${c.key}`);
      }
      if (changes.some((c) => c.key === 'seat_cap')) await tx.execute(sql`select promote_waitlist()`);
    });
  }
  return getAdminSettings(db);
}
