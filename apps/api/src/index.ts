import { loadConfig, loadPaymentProvider } from './config';
import { createDb } from '@anti/db';
import { createApp } from './app';
import { startScheduler } from './lib/jobs';
import { LocalDiskStorage, resolveUploadDir } from './lib/storage';

const cfg = loadConfig();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const { db } = createDb(url);
const port = Number(process.env.API_PORT ?? 3001);
const storage = new LocalDiskStorage(resolveUploadDir());
const payments = loadPaymentProvider(cfg);

createApp({ db, cfg, storage, payments }).listen(port);
console.log(`api listening on :${port}` + (payments.kind === 'fake' ? ' (FAKE payments: checkout at /dev/checkout)' : ''));

if (process.env.JOBS === 'off') console.log('scheduled jobs disabled (JOBS=off)');
else startScheduler(db, { storage, payments });
