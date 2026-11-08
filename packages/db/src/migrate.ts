import { runMigrations } from './migrations';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

await runMigrations(url);
console.log('Migrations and SQL functions applied.');
