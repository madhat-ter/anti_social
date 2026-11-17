import { sql } from 'drizzle-orm';
import { scalar, type Db } from '@anti/db';
import { formatInviteCode } from '@anti/shared';
import { generateInviteCode } from './crypto';
import { ApiError } from './errors';
import { setOps } from './moderation';
import { createPinReset } from './pin';

/**
 * For hosts without a shell (Render free plan): BOOTSTRAP_INVITES=<n> mints n founder invites
 * on boot, but only while nobody has joined and no founder invite is still open, and prints
 * the codes to the service log (visible only to the account owner). Codes are stored hashed,
 * so the log is the only place they appear. Returns the printed codes.
 */
export async function bootstrapInvites(db: Db, count: number, log: (line: string) => void = console.log): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) return [];
  const users = Number(await scalar(db, sql`select count(*) from users`));
  const open = Number(await scalar(db, sql`
    select count(*) from invites
     where created_by is null and redeemed_at is null and revoked_at is null and expires_at > now()`));
  if (users > 0 || open > 0) return [];
  const codes: string[] = [];
  for (let n = 0; n < Math.min(count, 20); n++) {
    const code = generateInviteCode();
    await scalar(db, sql`select create_invite(null, ${code})`);
    codes.push(formatInviteCode(code));
  }
  log(`founder invites (expire in 7 days): ${codes.join('  ')}`);
  return codes;
}

/**
 * OPS_HANDLES=alice,bob makes those members ops on boot, but only while the site has no admin:
 * it bootstraps the first admin and nothing more. (Otherwise, once an admin renamed themselves,
 * whoever signed up with the freed handle would become admin at the next restart.)
 * Handles that don't exist yet are skipped.
 */
export async function bootstrapOps(db: Db, handles: string, log: (line: string) => void = console.log) {
  const admins = Number(await scalar(db, sql`select count(*) from users where role = 'ops' and state not in ('banned', 'deleted')`));
  if (admins > 0) {
    log('ops: an admin already exists; OPS_HANDLES ignored (add admins from the Admin page)');
    return;
  }
  for (const h of handles.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      await setOps(db, h, true);
      log(`ops: @${h}`);
    } catch {
      log(`ops: @${h} has not joined yet`);
    }
  }
}

/**
 * PIN_RESET_HANDLE=alice prints a one-hour PIN reset code for that member to the service log on
 * boot (§10.13). It is the ops console's `pin-reset` for hosts without a shell: the way back in for
 * the only admin who has lost both the PIN and the recovery code. Whoever can set the variable
 * already holds the database, so it opens nothing new. Codes are stored hashed, so the log is the
 * only place this one appears. A restart inside 24 hours makes no second code unless the first ran
 * out unused. Remove the variable once the member is back in. Never stops the boot.
 */
export async function bootstrapPinReset(db: Db, handle: string, log: (line: string) => void = console.log): Promise<string | null> {
  const h = handle.trim().replace(/^@/, '');
  if (!h) return null;
  try {
    const recent = Number(await scalar(db, sql`
      select count(*) from pin_resets r join users u on u.id = r.user_id
       where lower(u.handle) = lower(${h}) and r.created_by is null
         and r.created_at > now() - interval '24 hours'
         and (r.used_at is not null or r.expires_at > now())`));
    if (recent > 0) {
      log(`pin reset: @${h} already has a code from the last 24 hours (look further up this log, or it was used); none made. Remove PIN_RESET_HANDLE.`);
      return null;
    }
    const r = await createPinReset(db, null, h);
    log(`pin reset: code for @${h}: ${r.code}  (works once, until ${r.expiresAt}; enter it under "Forgot your PIN?", then remove PIN_RESET_HANDLE)`);
    return r.code;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) log(`pin reset: @${h} is not a member here; PIN_RESET_HANDLE ignored`);
    else log(`pin reset: no code made for @${h}: ${String(e)}`);
    return null;
  }
}