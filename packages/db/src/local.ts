import * as schema from './schema';
import type { Db } from './client';
import { MIGRATIONS_FOLDER, readFunctionsSql } from './paths';

/**
 * Postgres kept as files in `dataDir`, running inside the API process (PGlite). This is the
 * database on the cPanel host, which offers MySQL only (owner's call, 2026-11-23: no MySQL rewrite).
 * Exactly one process may open `dataDir` at a time; the caller holds a lock for that.
 * Migrations and the SQL functions are applied on every open, like MIGRATE_ON_BOOT on Render.
 */
export async function openLocalDb(dataDir: string): Promise<{ db: Db; close: () => Promise<void>; backup: () => Promise<Uint8Array> }> {
  // Loaded here, not at the top, so the Bun/Render API never loads the WASM Postgres.
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = await PGlite.create(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await client.exec(readFunctionsSql());
  return {
    db: db as unknown as Db,
    close: () => client.close(),
    /** the whole data folder as a .tar.gz, consistent (PGlite pauses writes while it copies) */
    backup: async () => new Uint8Array(await (await client.dumpDataDir('gzip')).arrayBuffer()),
  };
}
