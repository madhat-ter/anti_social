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
  /** RFC §10.13: PIN sign-ins and PIN resets per IP, on top of each account's own lock */
  pinGuess: { limit: 60, windowSec: 3600 },
  like: { limit: 300, windowSec: 3600 },
  flag: { limit: 30, windowSec: 86_400 },
  upload: { limit: 60, windowSec: 3600 },
  checkout: { limit: 20, windowSec: 3600 },
  rsvp: { limit: 60, windowSec: 3600 },
  /** RFC §10.5: asking to join collabs */
  collabRequest: { limit: 10, windowSec: 86_400 },
  /** RFC §10.6: consultation requests sent */
  consultRequest: { limit: 10, windowSec: 86_400 },
  /** members adding their own interest tags */
  interestAdd: { limit: 5, windowSec: 86_400 },
  /** RFC §10.24: cards sent from the public share page, per IP (there is no account to count) */
  guestCard: { limit: 3, windowSec: 3600 },
  /** RFC 10.25: asking for a seat from the landing page, per IP */
  seatRequest: { limit: 3, windowSec: 3600 },
  /** moving the site: a whole-database download, per admin */
  export: { limit: 5, windowSec: 3600 },
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

/**
 * Client IP, for per-IP limits. Each proxy has one header it writes itself; read only that one,
 * because any other header is the visitor's own word and a new made-up address per request beats
 * every limit (Fly-Client-IP was read on Render once: nothing there sets or strips it).
 * - 'fly': Fly-Client-IP (Fly's edge sets it).
 * - 'xff' (TRUST_PROXY=true): the first X-Forwarded-For entry, which Vercel's proxy writes fresh
 *   with the visitor's address (it does not pass on one the visitor sent).
 * - off: the socket address.
 */
export type TrustProxy = false | 'xff' | 'fly';
export function clientIp(request: Request, server: { requestIP(r: Request): { address: string } | null } | null, trustProxy: TrustProxy | boolean): string {
  if (trustProxy) {
    const h = trustProxy === 'fly' ? request.headers.get('fly-client-ip') : request.headers.get('x-forwarded-for')?.split(',')[0];
    if (h?.trim()) return h.trim();
  }
  return server?.requestIP(request)?.address ?? 'unknown';
}
