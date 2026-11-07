import { Elysia, t } from 'elysia';
import { sql } from 'drizzle-orm';
import { scalar } from '@anti/db';
import { normalizeInviteCode, isWellFormedInviteCode } from '@anti/shared';
import type { Deps } from '../deps';

export function checkInvite(db: Deps['db'], raw: string) {
  const code = normalizeInviteCode(raw);
  if (!isWellFormedInviteCode(code)) return Promise.resolve(false);
  return scalar<boolean>(db, sql`select invite_is_valid(${code})`).then((v) => v === true);
}

export const inviteRoutes = (deps: Deps) =>
  new Elysia().post(
    '/invites/check',
    async ({ body }) => {
      const valid = await checkInvite(deps.db, body.code);
      if (!valid) return { valid: false, wouldWaitlist: false };
      const used = Number(await scalar<number>(deps.db, sql`select seats_used()`));
      const cap = Number(await scalar<number>(deps.db, sql`select setting_int('seat_cap')`));
      const queued = Number(await scalar<number>(deps.db, sql`select count(*) from waitlist`));
      return { valid: true, wouldWaitlist: queued > 0 || used >= cap };
    },
    { body: t.Object({ code: t.String({ maxLength: 64 }) }) },
  );
