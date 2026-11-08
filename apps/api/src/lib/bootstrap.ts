import { sql } from 'drizzle-orm';
import { scalar, type Db } from '@anti/db';
import { formatInviteCode } from '@anti/shared';
import { generateInviteCode } from './crypto';
import { setOps } from './moderation';

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

/** OPS_HANDLES=alice,bob makes those members ops on boot; handles that don't exist yet are skipped. */
export async function bootstrapOps(db: Db, handles: string, log: (line: string) => void = console.log) {
  for (const h of handles.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      await setOps(db, h, true);
      log(`ops: @${h}`);
    } catch {
      log(`ops: @${h} has not joined yet`);
    }
  }
}
