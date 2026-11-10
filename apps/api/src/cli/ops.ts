// Ops console (RFC §11: ops is backend-only). Same service code as the /ops/* endpoints.
//   bun run ops -- grant <handle>            make a member ops (revoke: ungrant)
//   bun run ops -- flags                     list the moderation queue
//   bun run ops -- resolve <postId> restored|removed
//   bun run ops -- resolve-project <projectId> restored|removed
//   bun run ops -- ban <handle>
//   bun run ops -- consult-asks               who is waiting for consulting approval (§10.18)
//   bun run ops -- consult-approve <handle> yes|no
import { createDb } from '@anti/db';
import { ApiError } from '../lib/errors';
import { banUser, flagQueue, resolveFlags, resolveProjectFlags, setOps } from '../lib/moderation';
import { consultQueue, decideConsulting } from '../lib/consultations';
import { loadStorage } from '../lib/storage';

const [cmd, a1, a2] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const { db, close } = createDb(url);
const usage = () => {
  console.error('usage: ops.ts grant|ungrant <handle> | flags | resolve <postId> restored|removed | resolve-project <projectId> restored|removed | ban <handle> | consult-asks | consult-approve <handle> yes|no');
  process.exit(1);
};
try {
  if ((cmd === 'grant' || cmd === 'ungrant') && a1) console.log(await setOps(db, a1, cmd === 'grant'));
  else if (cmd === 'flags') {
    const q = await flagQueue(db);
    if (!q.length) console.log('No open reports.');
    for (const f of q) {
      console.log(`${f.hidden ? '[HIDDEN] ' : ''}${f.kind} ${f.postId ?? f.projectId}  @${f.author ?? 'deleted'}  ${f.flags} report(s) since ${f.firstFlaggedAt}`);
      console.log(`    "${f.body.slice(0, 120).replace(/\s+/g, ' ')}"`);
      for (const r of f.reasons) console.log(`    - ${r}`);
    }
  } else if (cmd === 'resolve' && a1 && (a2 === 'restored' || a2 === 'removed')) {
    console.log(await resolveFlags(db, loadStorage(db), a1, a2));
  } else if (cmd === 'resolve-project' && a1 && (a2 === 'restored' || a2 === 'removed')) {
    console.log(await resolveProjectFlags(db, loadStorage(db), a1, a2));
  } else if (cmd === 'ban' && a1) console.log(await banUser(db, a1, null));
  else if (cmd === 'consult-asks') {
    const q = await consultQueue(db);
    if (!q.length) console.log('Nobody is waiting for consulting approval.');
    for (const c of q) {
      console.log(`@${c.handle}  ${c.minutes} min  ${c.pricing}${c.priceNote ? ` (${c.priceNote})` : ''}  asked ${c.askedAt}${c.active ? '' : '  [offer paused]'}`);
      if (c.description) console.log(`    "${c.description.slice(0, 160).replace(/\s+/g, ' ')}"`);
    }
  } else if (cmd === 'consult-approve' && a1 && (a2 === 'yes' || a2 === 'no')) {
    console.log(await decideConsulting(db, a1, a2 === 'yes', null));
  } else usage();
} catch (e) {
  if (e instanceof ApiError) { console.error(`${e.code}: ${e.detail ?? ''}`); process.exitCode = 1; }
  else throw e;
} finally {
  await close();
}
