import { loadConfig, loadPaymentProvider } from './config';
import { createDb, runMigrations } from '@anti/db';
import { createApp } from './app';
import { startScheduler } from './lib/jobs';
import { loadPushSender } from './lib/push';
import { loadStorage } from './lib/storage';
import { bootstrapInvites, bootstrapOps } from './lib/bootstrap';

const cfg = loadConfig();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
// Hosts where nobody runs `bun run db:migrate` by hand (Render, etc.): migrate before serving.
if (process.env.MIGRATE_ON_BOOT === 'true') {
  await runMigrations(url);
  console.log('migrations applied');
}
const { db } = createDb(url);
if (process.env.BOOTSTRAP_INVITES) await bootstrapInvites(db, Number(process.env.BOOTSTRAP_INVITES));
if (process.env.OPS_HANDLES) await bootstrapOps(db, process.env.OPS_HANDLES);
// API_PORT locally; PORT is what Render/Fly/Railway hand the process.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const storage = loadStorage(db);
const payments = loadPaymentProvider(cfg);
const push = loadPushSender();

createApp({ db, cfg, storage, payments, push }).listen(port);
console.log(`api listening on :${port}` + (payments.kind === 'fake' ? ' (FAKE payments: checkout at /dev/checkout)' : ''));

// Say why the process ends, so the host's log shows a stop or a crash instead of just going quiet.
const started = Date.now();
const upFor = () => `${Math.round((Date.now() - started) / 60_000)} min`;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`api stopping: ${sig} after ${upFor()}`);
    process.exit(0);
  });
}
process.on('uncaughtException', (e) => {
  console.error(`api crashed after ${upFor()}:`, e);
  process.exit(1);
});

// Render's free plan puts the API to sleep after 15 min without visitors and sometimes fails to
// wake it ("X-Render-Routing: no-deploy", 2026-11-12: six sleeps in nine hours, the sixth never woke).
// So the API visits its own public address every 10 min and never falls asleep. RENDER_EXTERNAL_URL
// is set by Render only, so this does nothing locally. GitHub's uptime-watch stays as the backup.
const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl && process.env.KEEP_AWAKE !== 'off') {
  setInterval(() => {
    fetch(`${selfUrl}/health`, { signal: AbortSignal.timeout(30_000) }).catch((e) =>
      console.error('keep-awake visit failed:', String(e)),
    );
  }, 10 * 60_000);
  console.log('keep-awake: visiting own /health every 10 min');
}

if (process.env.JOBS === 'off') console.log('scheduled jobs disabled (JOBS=off)');
else startScheduler(db, { storage, payments, push });
if (!push.publicKey) console.log('web push disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; bun run ops:vapid-keys)');
