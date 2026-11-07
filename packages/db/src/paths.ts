import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));
export const FUNCTIONS_SQL_PATH = fileURLToPath(new URL('../sql/functions.sql', import.meta.url));

export function readFunctionsSql(): string {
  return readFileSync(FUNCTIONS_SQL_PATH, 'utf8');
}
