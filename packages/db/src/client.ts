import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

/** Driver-agnostic database handle (postgres-js in prod, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 10 });
  const db = drizzle({ client, schema }) as unknown as Db;
  return { db, close: () => client.end() };
}

/** Rows from db.execute(), normalising driver differences. */
export async function rows<T = Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown;
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

/** First column of the first row, e.g. `select redeem_invite(...)`. */
export async function scalar<T>(db: Db, query: SQL): Promise<T | undefined> {
  const [row] = await rows(db, query);
  return row ? (Object.values(row)[0] as T) : undefined;
}

/**
 * The SQL functions raise exceptions whose message is a stable code (e.g. 'invite_invalid').
 * Drizzle wraps driver errors, so walk the cause chain to find it.
 */
export function dbErrorCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    const msg = (e as { message?: string }).message;
    if (msg && /^[a-z_]+$/.test(msg)) return msg;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** True when the error is a unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
