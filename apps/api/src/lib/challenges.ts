import { and, eq, gt } from 'drizzle-orm';
import { authChallenges, type Db } from '@anti/db';
import { ApiError } from './errors';

export type ChallengePurpose = 'register' | 'login' | 'add_passkey' | 'recover';

const TTL_MS = 5 * 60_000;

export async function saveChallenge(
  db: Db,
  c: { challenge: string; purpose: ChallengePurpose; userId?: string; data?: unknown },
): Promise<string> {
  const [row] = await db
    .insert(authChallenges)
    .values({ ...c, expiresAt: new Date(Date.now() + TTL_MS) })
    .returning({ id: authChallenges.id });
  return row!.id;
}

/** Single-use: deletes the challenge and returns it, or throws if missing/expired/wrong purpose. */
export async function takeChallenge(db: Db, id: string, purpose: ChallengePurpose) {
  const [row] = await db
    .delete(authChallenges)
    .where(and(eq(authChallenges.id, id), eq(authChallenges.purpose, purpose), gt(authChallenges.expiresAt, new Date())))
    .returning();
  if (!row) throw new ApiError(400, 'challenge_invalid', 'The sign-in attempt expired. Try again.');
  return row;
}
