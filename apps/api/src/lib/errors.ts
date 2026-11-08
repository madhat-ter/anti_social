import { dbErrorCode } from '@anti/db';

/** Thrown from handlers; Elysia calls toResponse() to build the reply. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
  toResponse() {
    return Response.json({ error: this.code, ...(this.detail ? { detail: this.detail } : {}) }, { status: this.status });
  }
}

/** SQL-function exception codes → HTTP. */
const DB_ERRORS: Record<string, [number, string]> = {
  invite_invalid: [400, 'Invite code is invalid, used, or expired.'],
  invite_limit: [409, 'You already have the maximum number of open invites.'],
  invite_penalty: [403, 'Inviting is paused on your account.'],
  invite_not_allowed_state: [403, 'Only members with a seat can invite.'],
  rejoin_not_applicable: [409, 'Only archived accounts can rejoin the queue.'],
  no_open_offer: [409, 'There is no open seat offer.'],
  stay_fee_not_applicable: [409, 'Stay fee does not apply to this account.'],
  payment_not_found: [404, 'Unknown checkout session.'],
  not_banned: [409, 'That member is not banned.'],
  visitor_pass_invalid: [400, 'That visitor code is not valid, or has expired.'],
  visitor_pass_used: [409, 'This pass has already been used.'],
};

/** Re-throw a DB error as an ApiError when it is one of ours; otherwise re-throw as-is. */
export function rethrowDb(err: unknown): never {
  const code = dbErrorCode(err);
  const mapped = code ? DB_ERRORS[code] : undefined;
  if (code && mapped) throw new ApiError(mapped[0], code, mapped[1]);
  throw err;
}
