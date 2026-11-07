import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import type { Db } from './client';
import { MIGRATIONS_FOLDER, readFunctionsSql } from './paths';

/** In-process Postgres with the full schema + SQL functions. No server needed. */
export async function createTestDb(opts: { seatCap?: number } = {}) {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await client.exec(readFunctionsSql());
  if (opts.seatCap !== undefined) {
    await db.execute(sql`update settings set value = ${JSON.stringify(opts.seatCap)}::jsonb where key = 'seat_cap'`);
  }
  return { db: db as unknown as Db, client, close: () => client.close() };
}
