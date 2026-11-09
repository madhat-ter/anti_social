/**
 * Screen time (RFC §10.10). A member gets half an hour of looking at the site, then an hour away.
 * The page sends a heartbeat with the seconds it was visible; this adds them up, locks the member
 * out when the half hour is spent, and opens a fresh half hour when the rest is over, or when the
 * member has simply been away for an hour. Admins are exempt: their timer counts on past the half
 * hour and nothing ever locks. Visitors have their own hour (RFC §10.8) and no row here.
 */
import { eq, sql } from 'drizzle-orm';
import { screenTime, type Db } from '@anti/db';
import { RULES } from '@anti/shared';

export const LIMIT_S = RULES.screen_time_limit_s;
export const REST_S = RULES.screen_time_rest_s;
/** one heartbeat can carry at most this many seconds: the page beats every 30 s */
const BEAT_MAX_S = 60;

export type ScreenState = {
  usedSeconds: number;
  limitSeconds: number;
  restSeconds: number;
  /** ISO; while in the future the member is locked out (never set for an admin) */
  lockedUntil: string | null;
  /** ISO; identifies the current half hour (the app keys "already nudged" on it) */
  windowStartedAt: string | null;
  /** an admin: the timer shows, the lock never comes */
  exempt: boolean;
};

type Row = typeof screenTime.$inferSelect;

function present(r: Row | null, exempt: boolean): ScreenState {
  return {
    usedSeconds: r?.usedS ?? 0,
    limitSeconds: LIMIT_S,
    restSeconds: REST_S,
    lockedUntil: !exempt && r?.lockedUntil && r.lockedUntil.getTime() > Date.now() ? r.lockedUntil.toISOString() : null,
    windowStartedAt: r?.windowStartedAt ? r.windowStartedAt.toISOString() : null,
    exempt,
  };
}

/** A spent rest, or an hour away, opens a fresh half hour. An admin's leftover lock (from before they were one) is dropped. */
async function settle(db: Db, r: Row | null, exempt: boolean): Promise<Row | null> {
  if (!r) return null;
  const now = Date.now();
  const restOver = !!r.lockedUntil && (exempt || r.lockedUntil.getTime() <= now);
  const awayLong = !r.lockedUntil && now - r.updatedAt.getTime() >= REST_S * 1000;
  if (!restOver && !awayLong) return r;
  const [fresh] = await db.update(screenTime)
    .set({ usedS: 0, lockedUntil: null, windowStartedAt: null, updatedAt: new Date() })
    .where(eq(screenTime.userId, r.userId))
    .returning();
  return fresh ?? null;
}

export async function screenState(db: Db, userId: string, exempt = false): Promise<ScreenState> {
  const [r] = await db.select().from(screenTime).where(eq(screenTime.userId, userId)).limit(1);
  return present(await settle(db, r ?? null, exempt), exempt);
}

/** The page was visible for `seconds` since the last beat. Returns the state afterwards. */
export async function screenBeat(db: Db, userId: string, seconds: number, exempt = false): Promise<ScreenState> {
  const add = Math.max(0, Math.min(BEAT_MAX_S, Math.round(seconds)));
  const [existing] = await db.select().from(screenTime).where(eq(screenTime.userId, userId)).limit(1);
  const r = await settle(db, existing ?? null, exempt);
  if (r?.lockedUntil && r.lockedUntil.getTime() > Date.now()) return present(r, exempt); // locked: nothing counts
  const now = new Date();
  const [after] = await db.insert(screenTime)
    .values({ userId, usedS: add, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: screenTime.userId,
      set: {
        // a member's count stops at the limit; an admin's keeps going
        usedS: exempt ? sql`${screenTime.usedS} + ${add}` : sql`least(${LIMIT_S}, ${screenTime.usedS} + ${add})`,
        windowStartedAt: sql`coalesce(${screenTime.windowStartedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      },
    })
    .returning();
  if (!exempt && after && after.usedS >= LIMIT_S && !after.lockedUntil) {
    const [locked] = await db.update(screenTime)
      .set({ lockedUntil: new Date(now.getTime() + REST_S * 1000), updatedAt: now })
      .where(eq(screenTime.userId, userId))
      .returning();
    return present(locked ?? after, exempt);
  }
  return present(after ?? null, exempt);
}

/** Paths a locked-out member may still call: the lock screen itself, signing out, the timer. */
const OPEN_WHILE_LOCKED = /^\/(me$|me\/screen-time|auth\/logout|health$)/;
export const openWhileLocked = (path: string) => OPEN_WHILE_LOCKED.test(path);
