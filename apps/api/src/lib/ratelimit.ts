import { sql } from 'drizzle-orm';
import { scalar, type Db } from '@anti/db';
import { ApiError } from './errors';

/**
 * Fixed-window counters in Postgres (RFC §13), so limits hold across API instances.
 * Rows are tiny and swept daily by the cleanup job.
 */
export const LIMITS = {
  /** RFC §13: invite-code checks, against enumeration. */
  inviteCheck: { limit: 10, windowSec: 60 },
  /** WebAuthn ceremonies per IP. */
  auth: { limit: 60, windowSec: 60 },
  like: { limit: 300, windowSec: 3600 },
  flag: { limit: 30, windowSec: 86_400 },
  upload: { limit: 60, windowSec: 3600 },
  checkout: { limit: 20, windowSec: 3600 },
  rsvp: { limit: 60, windowSec: 3600 },
} as const;
export type LimitName = keyof typeof LIMITS;

/** Counts one hit for `subject` (user id or IP); throws 429 once the window's limit is passed. */
export async function hit(db: Db, name: LimitName, subject: string): Promise<void> {
  const { limit, windowSec } = LIMITS[name];
  const n = await scalar<number>(db, sql`
    insert into rate_limits(key, window_start, count)
    values (${`${name}:${subject}`}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  if (Number(n) > limit) {
    const unit = windowSec === 60 ? 'minute' : windowSec === 3600 ? 'hour' : 'day';
    throw new ApiError(429, 'rate_limited', `Too many requests. Try again in a ${unit}.`);
  }
}

/** Client IP. Behind a proxy (TRUST_PROXY=true) use its header; otherwise the socket address. */
export function clientIp(request: Request, server: { requestIP(r: Request): { address: string } | null } | null, trustProxy: boolean): string {
  if (trustProxy) {
    const h = request.headers.get('fly-client-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0];
    if (h?.trim()) return h.trim();
  }
  return server?.requestIP(request)?.address ?? 'unknown';
}
