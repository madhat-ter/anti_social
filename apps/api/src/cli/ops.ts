// Ops console (RFC §11: ops is backend-only). Same service code as the /ops/* endpoints.
//   bun run ops -- grant <handle>            make a member ops (revoke: ungrant)
//   bun run ops -- flags                     list the moderation queue
//   bun run ops -- resolve <postId> restored|removed
//   bun run ops -- ban <handle>
import { createDb } from '@anti/db';
import { ApiError } from '../lib/errors';
import { banUser, flagQueue, resolveFlags, setOps } from '../lib/moderation';
import { LocalDiskStorage, resolveUploadDir } from '../lib/storage';

const [cmd, a1, a2] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const { db, close } = createDb(url);
const usage = () => {
  console.error('usage: ops.ts grant|ungrant <handle> | flags | resolve <postId> restored|removed | ban <handle>');
  process.exit(1);
};
try {
  if ((cmd === 'grant' || cmd === 'ungrant') && a1) console.log(await setOps(db, a1, cmd === 'grant'));
  else if (cmd === 'flags') {
    const q = await flagQueue(db);
    if (!q.length) console.log('No open reports.');
    for (const f of q) {
      console.log(`${f.hidden ? '[HIDDEN] ' : ''}${f.postId}  @${f.author ?? 'deleted'}  ${f.flags} report(s) since ${f.firstFlaggedAt}`);
      console.log(`    "${f.body.slice(0, 120).replace(/\s+/g, ' ')}"`);
      for (const r of f.reasons) console.log(`    - ${r}`);
    }
  } else if (cmd === 'resolve' && a1 && (a2 === 'restored' || a2 === 'removed')) {
    console.log(await resolveFlags(db, new LocalDiskStorage(resolveUploadDir()), a1, a2));
  } else if (cmd === 'ban' && a1) console.log(await banUser(db, a1, null));
  else usage();
} catch (e) {
  if (e instanceof ApiError) { console.error(`${e.code}: ${e.detail ?? ''}`); process.exitCode = 1; }
  else throw e;
} finally {
  await close();
}
