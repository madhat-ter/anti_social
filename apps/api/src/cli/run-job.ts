// Runs a scheduled job once, e.g. `bun run ops:run-job -- lifecycle`. Same code path as the scheduler.
import { createDb } from '@anti/db';
import { JOBS, runJob } from '../lib/jobs';
import { LocalDiskStorage, resolveUploadDir } from '../lib/storage';
import { loadConfig, loadPaymentProvider } from '../config';
import { loadPushSender } from '../lib/push';

const name = process.argv[2];
const job = JOBS.find((j) => j.name === name);
if (!job) {
  console.error(`usage: run-job.ts <${JOBS.map((j) => j.name).join('|')}>`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const { db, close } = createDb(url);
const payments = loadPaymentProvider(loadConfig());
const r = await runJob(db, job, { storage: new LocalDiskStorage(resolveUploadDir()), payments, push: loadPushSender() });
console.log(name, r);
await close();
