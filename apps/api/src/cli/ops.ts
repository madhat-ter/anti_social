// Ops console (RFC §11: ops is backend-only). Same service code as the /ops/* endpoints.
//   bun run ops -- grant <handle>            make a member ops (revoke: ungrant)
//   bun run ops -- flags                     list the moderation queue
//   bun run ops -- resolve <postId> restored|removed
//   bun run ops -- resolve-project <projectId> restored|removed
//   bun run ops -- ban <handle>
//   bun run ops -- consult-asks               who is waiting for consulting approval (§10.18)
//   bun run ops -- consult-approve <handle> yes|no
//   bun run ops -- wipe <handle...>           dry run: everything a hard wipe would remove
//   bun run ops -- wipe --list                every member, with what they made, to spot demo accounts
//   bun run ops -- wipe <handle...> --yes     delete those accounts and their content for real
import { createDb } from '@anti/db';
import { ApiError } from '../lib/errors';
import { banUser, flagQueue, resolveFlags, resolveProjectFlags, setOps } from '../lib/moderation';
import { consultQueue, decideConsulting } from '../lib/consultations';
import { loadStorage } from '../lib/storage';
import { previewWipe, wipeCandidates, wipeUser } from '../lib/wipe';

const argv = process.argv.slice(2);
const [cmd, a1, a2] = argv;
const flags = new Set(argv.filter((x) => x.startsWith('--')));
const handles = argv.slice(1).filter((x) => !x.startsWith('--'));
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const { db, close } = createDb(url);
const usage = () => {
  console.error('usage: ops.ts grant|ungrant <handle> | flags | resolve <postId> restored|removed | resolve-project <projectId> restored|removed | ban <handle> | consult-asks | consult-approve <handle> yes|no | wipe <handle...> [--yes] [--force-admin]');
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
  } else if (cmd === 'wipe' && (handles.length || flags.has('--list'))) {
    // dry run by default: show exactly what would go, then run again with --yes
    if (flags.has('--list')) {
      const all = await wipeCandidates(db);
      if (!all.length) console.log('No members.');
      console.log('handle              role    state           made on     posts  collabs  events');
      for (const u of all) {
        console.log(`${('@' + u.handle).padEnd(19)} ${u.role.padEnd(7)} ${u.state.padEnd(15)} ${u.created_iso}  ${String(u.posts).padStart(5)}  ${String(u.collabs).padStart(7)}  ${String(u.events).padStart(6)}`);
      }
    }
    for (const h of handles) {
      if (!flags.has('--yes')) {
        const p = await previewWipe(db, h);
        console.log(`@${p.handle}  ${p.role}  ${p.state}  "${p.displayName}"`);
        console.log(`  ${p.posts} post(s) · ${p.hostedCollabs.length} collab(s) hosted · ${p.joinedCollabs - p.hostedCollabs.length} other team(s)`);
        for (const c of p.hostedCollabs) console.log(`    ${c.kind}: "${c.title}"  ${c.id}`);
        console.log(`  ${p.hostedEvents.length} event(s) hosted · ${p.cohostedEvents} co-hosted · ${p.goingToEvents} going`);
        for (const e of p.hostedEvents) console.log(`    event: "${e.title}"  ${e.id}`);
        console.log(`  ${p.pets} pet(s) · ${p.projects} project(s)`);
        if (p.repliesByOthers) console.log(`  ${p.repliesByOthers} repl(ies) by other people will stay, without the post they answered`);
      } else {
        const r = await wipeUser(db, h, { forceAdmin: flags.has('--force-admin') });
        console.log(`wiped @${r.handle}: ${r.posts} post(s), ${r.collabs} collab(s), ${r.events} event(s), and the account`);
      }
    }
    if (!flags.has('--yes')) console.log('\nNothing was changed. Add --yes to delete.');
  } else usage();
} catch (e) {
  if (e instanceof ApiError) { console.error(`${e.code}: ${e.detail ?? ''}`); process.exitCode = 1; }
  else throw e;
} finally {
  await close();
}
