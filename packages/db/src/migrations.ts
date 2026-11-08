import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_FOLDER, readFunctionsSql } from './paths';

/** Applies the Drizzle migrations and sql/functions.sql. Idempotent: safe on every deploy/boot. */
export async function runMigrations(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
    await client.unsafe(readFunctionsSql());
  } finally {
    await client.end();
  }
}
