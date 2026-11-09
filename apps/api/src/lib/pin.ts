/**
 * RFC §10.13: signing in with a handle and a 6-digit PIN. A million PINs is few, so guessing is
 * what this file is about: five wrong in a row and the account rests (15 minutes, doubling each
 * time), ten wrong in a day and it waits for the member's recovery code or an admin's reset code.
 * PINs are stored as argon2id hashes. Every wrong handle and wrong PIN look the same to the caller.
 */
import { sql } from 'drizzle-orm';
import { rows, type Db } from '@anti/db';
import { PIN_RULES, pinProblem } from '@anti/shared';
import { ApiError } from './errors';
import { generatePinResetCode, generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode, verifyRecoveryCode } from './crypto';

export const hashPin = (pin: string) => Bun.password.hash(pin, { algorithm: 'argon2id' });
const verifyPin = (pin: string, hash: string) => Bun.password.verify(pin, hash);

/** Spent on unknown handles too, so a wrong handle takes as long as a wrong PIN. */
let dummy: Promise<string> | undefined;
const burn = async (pin: string) => { dummy ??= hashPin('000000'); await verifyPin(pin, await dummy).catch(() => false); };

export const mismatch = () => new ApiError(401, 'pin_invalid', 'That handle and PIN don’t match.');
const resting = (until: Date) => new ApiError(423, 'pin_resting', `This account is resting until ${until.toISOString()}.`);
const blocked = () => new ApiError(423, 'pin_blocked', 'Too many wrong PINs today. Use your recovery code, or ask an admin for a reset code.');

/** Throws unless the PIN is allowed (six digits, not obvious, not the member's birthday). */
export function checkNewPin(pin: string, birthday?: string | null) {
  const p = pinProblem(pin, birthday);
  if (p) throw new ApiError(400, 'pin_weak', p);
}

type PinRow = {
  id: string; state: string; pin_hash: string | null; pin_fails: number; pin_locks: number;
  pin_locked_until: Date | null; pin_blocked_at: Date | null; fails_today: number;
};

/**
 * A sign-in attempt. Returns the user id and state on the right PIN; throws `pin_invalid`,
 * `pin_resting` (with the time) or `pin_blocked` otherwise. The count is kept per account, under
 * a row lock, so parallel guesses cannot slip past it.
 */
export async function pinSignIn(db: Db, handle: string, pin: string): Promise<{ id: string; state: string }> {
  const outcome = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [u] = await rows<PinRow>(t, sql`
      select id, state, pin_hash, pin_fails, pin_locks, pin_locked_until, pin_blocked_at,
             case when pin_fail_day = current_date then pin_fails_day else 0 end as fails_today
        from users where lower(handle) = lower(${handle.trim().replace(/^@/, '')}) for update`);
    if (!u || !u.pin_hash || u.state === 'deleted') { await burn(pin); return { kind: 'mismatch' as const }; }
    if (u.pin_blocked_at) return { kind: 'blocked' as const };
    if (u.pin_locked_until && new Date(u.pin_locked_until).getTime() > Date.now()) {
      return { kind: 'resting' as const, until: new Date(u.pin_locked_until) };
    }
    if (await verifyPin(pin, u.pin_hash)) {
      await t.execute(sql`update users set pin_fails = 0, pin_locks = 0, pin_locked_until = null where id = ${u.id}::uuid`);
      return { kind: 'ok' as const, id: u.id, state: u.state };
    }
    const today = Number(u.fails_today) + 1;
    if (today >= PIN_RULES.dayLimit) {
      await t.execute(sql`
        update users set pin_fails = 0, pin_fail_day = current_date, pin_fails_day = ${today}, pin_blocked_at = now()
         where id = ${u.id}::uuid`);
      await t.execute(sql`insert into notifications(user_id, kind, payload) values (${u.id}::uuid, 'pin_blocked', '{}')`);
      return { kind: 'blocked' as const };
    }
    const fails = Number(u.pin_fails) + 1;
    if (fails >= PIN_RULES.triesBeforeRest) {
      const minutes = PIN_RULES.restMinutes * 2 ** Math.min(Number(u.pin_locks), 8);
      const [r] = await rows<{ until: Date }>(t, sql`
        update users set pin_fails = 0, pin_locks = pin_locks + 1, pin_fail_day = current_date, pin_fails_day = ${today},
               pin_locked_until = now() + make_interval(mins => ${minutes}::int)
         where id = ${u.id}::uuid returning pin_locked_until as until`);
      await t.execute(sql`
        insert into notifications(user_id, kind, payload)
        values (${u.id}::uuid, 'pin_locked', jsonb_build_object('until', ${new Date(r!.until).toISOString()}::text))`);
      return { kind: 'resting' as const, until: new Date(r!.until) };
    }
    await t.execute(sql`update users set pin_fails = ${fails}, pin_fail_day = current_date, pin_fails_day = ${today} where id = ${u.id}::uuid`);
    return { kind: 'mismatch' as const };
  });
  // thrown after the transaction, so the count is kept
  if (outcome.kind === 'mismatch') throw mismatch();
  if (outcome.kind === 'resting') throw resting(outcome.until);
  if (outcome.kind === 'blocked') throw blocked();
  if (outcome.state === 'banned') throw new ApiError(403, 'account_unavailable', 'This account is unavailable.');
  return { id: outcome.id, state: outcome.state };
}

/** Sets a PIN and clears every lock on it. */
async function storePin(db: Db, userId: string, pin: string) {
  await db.execute(sql`
    update users set pin_hash = ${await hashPin(pin)}, pin_fails = 0, pin_locks = 0, pin_locked_until = null,
           pin_fails_day = 0, pin_blocked_at = null
     where id = ${userId}::uuid`);
}

/**
 * Settings → Change PIN (or choosing one, for members who joined with a passkey). With a PIN
 * already set, the current one is required. Every other device is signed out.
 */
export async function changePin(db: Db, userId: string, tokenHash: string, pin: string, current: string | undefined) {
  const [u] = await rows<{ pin_hash: string | null; birthday: string | null }>(db, sql`
    select pin_hash, birthday::text as birthday from users where id = ${userId}::uuid`);
  if (!u) throw new ApiError(404, 'not_found');
  if (u.pin_hash) {
    if (!current || !(await verifyPin(current, u.pin_hash))) {
      throw new ApiError(401, 'pin_invalid', 'That is not your current PIN.');
    }
  }
  checkNewPin(pin, u.birthday);
  await storePin(db, userId, pin);
  await db.execute(sql`delete from sessions where user_id = ${userId}::uuid and token_hash <> ${tokenHash}`);
  return { ok: true as const };
}

/**
 * "Forgot your PIN?": the handle plus either the recovery code (28 symbols) or an admin's reset
 * code (8). Either one unlocks the account, sets the new PIN and signs out every device. The
 * recovery code also removes passkeys (the device may be lost) and is replaced: the new one is
 * returned once.
 */
export async function resetPin(db: Db, handle: string, rawCode: string, pin: string): Promise<{ id: string; state: string; recoveryCode: string | null }> {
  const fail = () => new ApiError(401, 'reset_failed', 'That handle and code don’t match.');
  const code = normalizeRecoveryCode(rawCode);
  const [u] = await rows<{ id: string; state: string; recovery_code_hash: string; birthday: string | null }>(db, sql`
    select id, state, recovery_code_hash, birthday::text as birthday from users
     where lower(handle) = lower(${handle.trim().replace(/^@/, '')})`);
  if (!u || u.state === 'deleted' || u.state === 'banned') { await burn(code); throw fail(); }

  if (code.length === PIN_RULES.resetCodeLength) {
    const open = await rows<{ id: string; code_hash: string }>(db, sql`
      select id, code_hash from pin_resets
       where user_id = ${u.id}::uuid and used_at is null and expires_at > now()
       order by created_at desc limit 3`);
    let hit: string | null = null;
    for (const r of open) if (await verifyRecoveryCode(code, r.code_hash)) { hit = r.id; break; }
    if (!hit) { await burn(code); throw fail(); }
    checkNewPin(pin, u.birthday);
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      const used = await rows<{ id: string }>(t, sql`update pin_resets set used_at = now() where id = ${hit}::uuid and used_at is null returning id`);
      if (!used.length) throw fail(); // used a moment ago in another tab
      await storePin(t, u.id, pin);
      await tx.execute(sql`delete from sessions where user_id = ${u.id}::uuid`);
    });
    return { id: u.id, state: u.state, recoveryCode: null };
  }

  if (!(await verifyRecoveryCode(code, u.recovery_code_hash))) throw fail();
  checkNewPin(pin, u.birthday);
  const fresh = generateRecoveryCode();
  const freshHash = await hashRecoveryCode(fresh.normalized);
  await db.transaction(async (tx) => {
    await storePin(tx as unknown as Db, u.id, pin);
    await tx.execute(sql`update users set recovery_code_hash = ${freshHash} where id = ${u.id}::uuid`);
    await tx.execute(sql`delete from passkeys where user_id = ${u.id}::uuid`);
    await tx.execute(sql`delete from sessions where user_id = ${u.id}::uuid`);
  });
  return { id: u.id, state: u.state, recoveryCode: fresh.display };
}

/**
 * Admin → Members → Reset PIN: a one-hour code to give the member in person or by phone. Not for
 * yourself (a stolen admin session must not be able to take its own account quietly). Earlier
 * unused codes stop working; the member is told; the row is the log.
 */
export async function createPinReset(db: Db, adminId: string, handle: string) {
  const [u] = await rows<{ id: string; state: string }>(db, sql`
    select id, state from users where lower(handle) = lower(${handle.replace(/^@/, '')})`);
  if (!u || u.state === 'deleted') throw new ApiError(404, 'not_found');
  if (u.id === adminId) throw new ApiError(403, 'pin_reset_self', 'Another admin has to reset your PIN.');
  const code = generatePinResetCode(PIN_RULES.resetCodeLength);
  const hash = await hashRecoveryCode(code.normalized);
  const [r] = await rows<{ expires_at: Date }>(db, sql`
    with gone as (update pin_resets set expires_at = now() where user_id = ${u.id}::uuid and used_at is null and expires_at > now())
    insert into pin_resets (user_id, code_hash, created_by, expires_at)
    values (${u.id}::uuid, ${hash}, ${adminId}::uuid, now() + make_interval(hours => ${PIN_RULES.resetCodeHours}::int))
    returning expires_at`);
  await db.execute(sql`
    insert into notifications(user_id, kind, payload) values (${u.id}::uuid, 'pin_reset_code', jsonb_build_object('actorId', ${adminId}::text))`);
  return { code: code.display, expiresAt: new Date(r!.expires_at).toISOString() };
}
