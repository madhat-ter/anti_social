/**
 * The keeper: the ONE process that owns the database files (PGlite). It runs the API, the timed
 * jobs and the daily backups, and answers the web copies over a local socket (common.mjs SOCKET).
 *
 * LiteSpeed starts web copies (server.mjs) as it likes, several under load, and never ends old
 * ones. A database in files can't be shared between processes, so none of them open it: the first
 * that finds no keeper starts one (detached, so it outlives them). A newer build or changed
 * settings start a new keeper, which asks the old one to stop (embedded.ts `lock`).
 *
 *   node keeper.mjs        environment from the web copy that started it
 */
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { BUILD, SOCKET, STARTING_FILE, settingsHash, setupLog } from './common.mjs';

setupLog('keeper');
process.env.ANTI_BUILD = BUILD;
process.env.ANTI_SETTINGS = settingsHash();
process.env.ANTI_STARTED ??= String(Date.now());
const started = Date.now();
const upFor = () => `${Math.round((Date.now() - started) / 60_000)} min`;

const clearStarting = () => rmSync(STARTING_FILE, { force: true });
const { startEmbeddedApi, Outranked } = await import('./api/index.mjs');
let api;
try {
  api = await startEmbeddedApi(process.env);
} catch (e) {
  clearStarting();
  if (e instanceof Outranked) { console.log(`not needed: ${e.message}`); process.exit(0); }
  console.error('keeper failed to start:', e);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else headers.set(k, v);
    }
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }
    const host = req.headers.host ?? 'localhost';
    const response = await api.handle(new Request(`https://${host}${req.url}`, { method: req.method, headers, body }));
    const out = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    if (!response.body || req.method === 'HEAD') return res.end();
    Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    console.error('api request failed:', req.method, (req.url ?? '').split('?')[0], e);
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal_error"}'); }
    else res.destroy();
  }
});
server.requestTimeout = 120_000;
if (process.platform !== 'win32') rmSync(SOCKET, { force: true }); // a socket file left by a keeper that died
server.listen(SOCKET, () => { clearStarting(); console.log(`keeper ready (${BUILD})`); });

let stopping = false;
async function stop(why, code) {
  if (stopping) return;
  stopping = true;
  console.log(`keeper stopping: ${why} after ${upFor()}`);
  server.close();
  await api.close().catch((e) => console.error('closing the database failed:', e));
  process.exit(code);
}
process.on('SIGTERM', () => void stop('SIGTERM', 0));
process.on('SIGINT', () => void stop('SIGINT', 0));
process.on('SIGHUP', () => {}); // the web copy that started it going away is not a reason to stop
process.on('uncaughtException', (e) => { console.error('keeper crashed:', e); void stop('crash', 1); });
