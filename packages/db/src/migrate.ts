import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_FOLDER, readFunctionsSql } from './paths';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  await client.unsafe(readFunctionsSql());
  console.log('Migrations and SQL functions applied.');
} finally {
  await client.end();
}
