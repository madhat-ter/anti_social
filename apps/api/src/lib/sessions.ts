import { and, eq, gt, sql } from 'drizzle-orm';
import { screenTime, sessions, users, type Db } from '@anti/db';
import { RULES } from '@anti/shared';
import { randomToken, sha256Hex } from './crypto';

export type SessionUser = typeof users.$inferSelect;
/** RFC §10.8: the pass behind a visitor's hour. */
export type VisitorPass = { id: string; expiresAt: Date };
/**
 * Who is asking. A member: their row and session. A visitor (RFC §10.8): a stand-in `user` that
 * looks seated so every read works unchanged, plus `visitor`; `requireUser` turns them away and
 * nothing that writes ever reaches a handler (app.ts).
 */
export type Auth = {
  user: SessionUser; tokenHash: string; visitor?: VisitorPass;
  /** RFC §10.10: set while the member's half hour is spent and they are locked out */
  lockedUntil?: Date | null;
};

const DAY = 86_400_000;
const sessionMs = RULES.session_days * DAY;

export async function createSession(db: Db, userId: string, client: 'web' | 'mobile'): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    tokenHash: sha256Hex(token),
    userId,
    client,
    expiresAt: new Date(Date.now() + sessionMs),
  });
  return token;
}

/** Resolve a bearer/cookie token; slides expiry forward at most once a day. */
export async function resolveSession(db: Db, token: string): Promise<Auth | null> {
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt, lockedUntil: screenTime.lockedUntil })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(screenTime, eq(screenTime.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < sessionMs - DAY) {
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + sessionMs) }).where(eq(sessions.tokenHash, tokenHash));
  }
  return { user: row.user, tokenHash, lockedUntil: row.lockedUntil ?? null };
}

export async function revokeSession(db: Db, tokenHash: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function touchLastSeen(db: Db, userId: string) {
  await db.execute(sql`select touch_last_seen(${userId}::uuid)`);
}

export const SESSION_MAX_AGE_S = sessionMs / 1000;
