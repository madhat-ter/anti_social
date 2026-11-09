/**
 * Visitor passes (RFC §10.8): an admin makes a pass; whoever enters its code gets one hour of
 * looking around with no account. A visitor is not a user: no row in `users`, no seat, no passkey.
 * They exist as a `visitor_passes` row and an `anti_visitor` cookie. Reads work because the auth
 * layer hands handlers a stand-in user that looks seated; writes never reach a handler (app.ts
 * turns every non-GET request on a visitor cookie away before routing).
 */
import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';
import { VISITOR_CODE_DAYS, VISITOR_MINUTES, formatInviteCode, isWellFormedVisitorCode, normalizeInviteCode } from '@anti/shared';
import { generateVisitorCode, randomToken, sha256Hex } from './crypto';
import { ApiError, rethrowDb } from './errors';
import type { SessionUser, VisitorPass } from './sessions';

export const VISITOR_COOKIE = 'anti_visitor';
/** a cookie outlives the hour by a little so the API, not the browser, decides when it ends */
export const VISITOR_COOKIE_MAX_AGE_S = VISITOR_MINUTES * 60 + 300;
/** the nil UUID: matches no row, so "liked by me", "mine", "my vote" are all false */
export const VISITOR_USER_ID = '00000000-0000-0000-0000-000000000000';
export const VISITOR_HANDLE = 'visitor';
/** a fixed, plainly made-up adult birthday: never shown, only makes 18+ content visible */
export const VISITOR_BIRTHDAY = '1900-01-01';

/**
 * Requests a visitor may not make even though they only read: their own things (they have none),
 * the inbox, payments and push. Everything else a seated member can GET, they can. Admin pages
 * are not listed: to a visitor, as to a member, they do not exist (404 from requireOps).
 */
const CLOSED_TO_VISITORS = /^\/(me\/|notifications|consultations|payments|push\/subscriptions)/;
export const closedToVisitors = (path: string) => CLOSED_TO_VISITORS.test(path);

/** Paths that must keep working with a stale or missing visitor cookie: entering a code, signing in, joining. */
const OPEN_PATHS = /^\/(visit|auth\/|invites\/check|health$|push\/config$)/;
export const openPath = (path: string) => OPEN_PATHS.test(path);

type Row = {
  id: string; label: string; created_at: Date; code_expires_at: Date; opened_at: Date | null; expires_at: Date | null; revoked_at: Date | null;
  created_by: string | null;
};
const COLS = sql`id, label, created_at, code_expires_at, opened_at, expires_at, revoked_at, created_by`;

/** The stand-in user handed to read handlers. Seated and set up, so `requireSeated` passes; nothing else is true of it. */
export function visitorUser(): SessionUser {
  const now = new Date();
  return {
    id: VISITOR_USER_ID, handle: VISITOR_HANDLE, displayName: 'Visitor', bio: '', avatarKey: null, role: 'member', state: 'active',
    invitedBy: null, recoveryCodeHash: '', activatedAt: now, lastSeenAt: null, lastSeenOn: null, lurkerFlaggedAt: null,
    lurkerExemptUntil: null, invitePenaltyUntil: null, stripeCustomerId: null, createdAt: now, gender: null,
    // an adult, so consultation offers (RFC §10.6, 18+) show too: they are part of the place
    birthday: VISITOR_BIRTHDAY,
    birthdayPublic: false, setupDoneAt: now, checklistDismissedAt: now, contactPhoneEnc: null, contactEmailEnc: null,
    contactUpdatedAt: null, verifiedAt: null, verifiedBy: null, feedSeenThrough: null,
    pinHash: null, pinFails: 0, pinLocks: 0, pinLockedUntil: null, pinFailDay: null, pinFailsDay: 0, pinBlockedAt: null,
  };
}

/** What GET /me says to a visitor: the member shape the app already knows, plus `visitor`. */
export function visitorProfile(pass: VisitorPass) {
  const u = visitorUser();
  return {
    id: u.id, handle: u.handle, displayName: u.displayName, bio: '', state: 'active' as const, role: 'member' as const,
    invitedBy: null, activatedAt: null, lastSeenAt: null, lurkerExemptUntil: null, waitlist: null, lurker: null, archived: null,
    setupNeeded: false, gender: null, birthday: VISITOR_BIRTHDAY, birthdayPublic: false, contactEnabled: false, contact: null, verifiedAt: null,
    interests: [] as string[],
    pinSet: true,
    visitor: { expiresAt: pass.expiresAt.toISOString() },
  };
}

/** The pass behind a browser's visitor cookie, while its hour runs and it is not revoked. */
export async function resolveVisitor(db: Db, token: string): Promise<VisitorPass | null> {
  const [r] = await rows<{ id: string; expires_at: Date }>(db, sql`
    select id, expires_at from visitor_passes
     where token_hash = ${sha256Hex(token)} and revoked_at is null and expires_at > now()`);
  return r ? { id: r.id, expiresAt: new Date(r.expires_at) } : null;
}

/** Entering a code: starts the hour, returns the cookie token and when it ends. */
export async function openPass(db: Db, rawCode: string): Promise<{ token: string; expiresAt: Date }> {
  const code = normalizeInviteCode(rawCode);
  if (!isWellFormedVisitorCode(code)) throw new ApiError(400, 'visitor_pass_invalid', 'That visitor code is not valid, or has expired.');
  const token = randomToken();
  try {
    const [r] = await rows<{ expires_at: Date }>(db, sql`select expires_at from open_visitor_pass(${code}, ${token})`);
    return { token, expiresAt: new Date(r!.expires_at) };
  } catch (e) {
    rethrowDb(e);
  }
}

export type PassStatus = 'unopened' | 'active' | 'ended' | 'expired' | 'revoked';
export type PassInfo = {
  id: string; label: string; status: PassStatus; createdAt: string; codeExpiresAt: string;
  openedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdBy: string | null;
};

const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

function statusOf(r: Row, now = Date.now()): PassStatus {
  if (r.revoked_at) return 'revoked';
  if (!r.opened_at) return ms(r.code_expires_at)! > now ? 'unopened' : 'expired';
  return (ms(r.expires_at) ?? 0) > now ? 'active' : 'ended';
}

function toInfo(r: Row): PassInfo {
  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: r.id, label: r.label, status: statusOf(r),
    createdAt: iso(r.created_at)!, codeExpiresAt: iso(r.code_expires_at)!, openedAt: iso(r.opened_at), expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at), createdBy: r.created_by,
  };
}

/** An admin makes a pass. The code is returned once, formatted; only its hash is kept. */
export async function createPass(db: Db, adminId: string, label: string): Promise<PassInfo & { code: string }> {
  const code = generateVisitorCode();
  const [r] = await rows<Row>(db, sql`select ${COLS} from create_visitor_pass(${adminId}::uuid, ${code}, ${label.trim().slice(0, 80)})`);
  return { ...toInfo(r!), code: formatInviteCode(code) };
}

/** Every pass of the last 30 days (older ones are purged), newest first, with who made it. */
export async function listPasses(db: Db): Promise<(PassInfo & { createdByHandle: string | null })[]> {
  const found = await rows<Row & { created_by_handle: string | null }>(db, sql`
    select p.id, p.label, p.created_at, p.code_expires_at, p.opened_at, p.expires_at, p.revoked_at, p.created_by, u.handle as created_by_handle
      from visitor_passes p left join users u on u.id = p.created_by
     order by p.created_at desc limit 200`);
  return found.map((r) => ({ ...toInfo(r), createdByHandle: r.created_by_handle }));
}

/** Ends a pass now: an unopened code stops working, an active visitor is out on their next request. */
export async function revokePass(db: Db, id: string, adminId: string): Promise<PassInfo> {
  const [r] = await rows<Row>(db, sql`
    update visitor_passes set revoked_at = coalesce(revoked_at, now()), revoked_by = ${adminId}::uuid
     where id = ${id}::uuid returning ${COLS}`);
  if (!r) throw new ApiError(404, 'not_found');
  return toInfo(r);
}

/** How many passes are live right now (for the admin panel's one-line summary). */
export async function activePassCount(db: Db): Promise<number> {
  return Number(await scalar<number>(db, sql`select count(*)::int from visitor_passes where opened_at is not null and revoked_at is null and expires_at > now()`));
}

export const VISITOR_CODE_LIFETIME_DAYS = VISITOR_CODE_DAYS;
