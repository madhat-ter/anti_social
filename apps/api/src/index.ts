import { loadConfig } from './config';
import { createDb } from '@anti/db';
import { createApp } from './app';

const cfg = loadConfig();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const { db } = createDb(url);
const port = Number(process.env.API_PORT ?? 3001);

createApp({ db, cfg }).listen(port);
console.log(`api listening on :${port}`);
