import { loadConfig, loadPaymentProvider } from './config';
import { createDb, runMigrations } from '@anti/db';
import { createApp } from './app';
import { startScheduler } from './lib/jobs';
import { loadPushSender } from './lib/push';
import { loadStorage } from './lib/storage';

const cfg = loadConfig();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
// Hosts where nobody runs `bun run db:migrate` by hand (Render, etc.): migrate before serving.
if (process.env.MIGRATE_ON_BOOT === 'true') {
  await runMigrations(url);
  console.log('migrations applied');
}
const { db } = createDb(url);
// API_PORT locally; PORT is what Render/Fly/Railway hand the process.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const storage = loadStorage(db);
const payments = loadPaymentProvider(cfg);
const push = loadPushSender();

createApp({ db, cfg, storage, payments, push }).listen(port);
console.log(`api listening on :${port}` + (payments.kind === 'fake' ? ' (FAKE payments: checkout at /dev/checkout)' : ''));

if (process.env.JOBS === 'off') console.log('scheduled jobs disabled (JOBS=off)');
else startScheduler(db, { storage, payments, push });
if (!push.publicKey) console.log('web push disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; bun run ops:vapid-keys)');
