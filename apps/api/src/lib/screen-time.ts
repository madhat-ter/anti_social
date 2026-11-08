/**
 * Screen time (RFC §10.10). A member gets half an hour of looking at the site, then an hour away.
 * The page sends a heartbeat with the seconds it was visible; this adds them up, locks the member
 * out when the half hour is spent, and opens a fresh half hour when the rest is over, or when the
 * member has simply been away for an hour. Visitors have their own hour (RFC §10.8) and no row here.
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
  /** ISO; while in the future the member is locked out */
  lockedUntil: string | null;
  /** ISO; identifies the current half hour (the app keys "already nudged" on it) */
  windowStartedAt: string | null;
};

type Row = typeof screenTime.$inferSelect;

function present(r: Row | null): ScreenState {
  return {
    usedSeconds: r?.usedS ?? 0,
    limitSeconds: LIMIT_S,
    restSeconds: REST_S,
    lockedUntil: r?.lockedUntil && r.lockedUntil.getTime() > Date.now() ? r.lockedUntil.toISOString() : null,
    windowStartedAt: r?.windowStartedAt ? r.windowStartedAt.toISOString() : null,
  };
}

/** A spent rest, or an hour away, opens a fresh half hour. */
async function settle(db: Db, r: Row | null): Promise<Row | null> {
  if (!r) return null;
  const now = Date.now();
  const restOver = !!r.lockedUntil && r.lockedUntil.getTime() <= now;
  const awayLong = !r.lockedUntil && now - r.updatedAt.getTime() >= REST_S * 1000;
  if (!restOver && !awayLong) return r;
  const [fresh] = await db.update(screenTime)
    .set({ usedS: 0, lockedUntil: null, windowStartedAt: null, updatedAt: new Date() })
    .where(eq(screenTime.userId, r.userId))
    .returning();
  return fresh ?? null;
}

export async function screenState(db: Db, userId: string): Promise<ScreenState> {
  const [r] = await db.select().from(screenTime).where(eq(screenTime.userId, userId)).limit(1);
  return present(await settle(db, r ?? null));
}

/** The page was visible for `seconds` since the last beat. Returns the state afterwards. */
export async function screenBeat(db: Db, userId: string, seconds: number): Promise<ScreenState> {
  const add = Math.max(0, Math.min(BEAT_MAX_S, Math.round(seconds)));
  const [existing] = await db.select().from(screenTime).where(eq(screenTime.userId, userId)).limit(1);
  const r = await settle(db, existing ?? null);
  if (r?.lockedUntil && r.lockedUntil.getTime() > Date.now()) return present(r); // locked: nothing counts
  const now = new Date();
  const [after] = await db.insert(screenTime)
    .values({ userId, usedS: add, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: screenTime.userId,
      set: {
        usedS: sql`least(${LIMIT_S}, ${screenTime.usedS} + ${add})`,
        windowStartedAt: sql`coalesce(${screenTime.windowStartedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      },
    })
    .returning();
  if (after && after.usedS >= LIMIT_S && !after.lockedUntil) {
    const [locked] = await db.update(screenTime)
      .set({ lockedUntil: new Date(now.getTime() + REST_S * 1000), updatedAt: now })
      .where(eq(screenTime.userId, userId))
      .returning();
    return present(locked ?? after);
  }
  return present(after ?? null);
}

/** Paths a locked-out member may still call: the lock screen itself, signing out, the timer. */
const OPEN_WHILE_LOCKED = /^\/(me$|me\/screen-time|auth\/logout|health$)/;
export const openWhileLocked = (path: string) => OPEN_WHILE_LOCKED.test(path);
