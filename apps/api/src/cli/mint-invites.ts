import { sql } from 'drizzle-orm';
import { createDb, scalar } from '@anti/db';
import { formatInviteCode } from '@anti/shared';
import { generateInviteCode } from '../lib/crypto';

const i = process.argv.indexOf('--count');
const count = i >= 0 ? Number(process.argv[i + 1]) : 1;
if (!Number.isInteger(count) || count < 1 || count > 1000) {
  console.error('usage: mint-invites.ts --count <1-1000>');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { db, close } = createDb(url);
for (let n = 0; n < count; n++) {
  const code = generateInviteCode();
  const expires = await scalar<Date | string>(db, sql`select create_invite(null, ${code})`);
  console.log(`${formatInviteCode(code)}  expires ${new Date(expires as string | Date).toISOString()}`);
}
await close();
