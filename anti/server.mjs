/**
 * The whole site as one Node.js process, for cPanel hosting (docs/deploy-cpanel.md).
 *
 *   /api/…        → the API (apps/api/src/embedded.ts, bundled into api/index.mjs), with "/api" taken off
 *   everything else → Next.js (the standalone build in web/)
 *
 * cPanel's web server (LiteSpeed) hands this process its requests through the one server it is
 * allowed to listen() with. Plain JavaScript: it runs as is, nothing compiles it.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { inspect } from 'node:util';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, 'web/apps/web');
const MAX_BODY_BYTES = 30 * 1024 * 1024; // same cap as the Bun API (index.ts)
const started = Date.now();
const upFor = () => `${Math.round((Date.now() - started) / 60_000)} min`;

process.env.NODE_ENV = 'production';
process.env.ANTI_DATA_DIR ??= join(process.env.HOME ?? here, 'anti-data');

// The host keeps no log of its own that cPanel shows, so every line also goes to
// ~/anti-data/logs/app.log (2 MB, then it becomes app.log.1). Read it in File Manager.
const logDir = join(process.env.ANTI_DATA_DIR, 'logs');
const logFile = join(logDir, 'app.log');
mkdirSync(logDir, { recursive: true });
const toFile = (level, args) => {
  try {
    if (existsSync(logFile) && statSync(logFile).size > 2_000_000) renameSync(logFile, `${logFile}.1`);
    const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack : inspect(a, { depth: 4 }))).join(' ');
    appendFileSync(logFile, `${new Date().toISOString()} ${level} ${text}\n`);
  } catch { /* never let logging break the site */ }
};
for (const level of ['log', 'error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => { orig(...args); toFile(level === 'log' ? 'info' : level, args); };
}

// --- the API (opens the database; an older build holding it is asked to stop, see embedded.ts) ---
process.env.ANTI_BUILD = readFileSync(join(here, 'BUILD.txt'), 'utf8').trim();
const { startEmbeddedApi } = await import('./api/index.mjs');
const api = await startEmbeddedApi(process.env);

// --- Next.js, started the way its standalone server.js does ---
const { config } = JSON.parse(readFileSync(join(webDir, '.next/required-server-files.json'), 'utf8'));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
process.chdir(webDir);
const next = createRequire(join(webDir, 'package.json'))('next');
const port = Number(process.env.PORT) || 3000;
const nextApp = next({ dev: false, dir: webDir, conf: config, hostname: 'localhost', port, customServer: true });
await nextApp.prepare();
const nextHandle = nextApp.getRequestHandler();

/**
 * The visitor's address. The web server in front adds it as the LAST X-Forwarded-For entry;
 * anything before that is whatever the visitor sent, so it is never believed. The API then
 * reads exactly one clean entry (TRUST_PROXY=true).
 */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last || req.socket.remoteAddress || 'unknown';
}

let ipLogged = !process.env.DEBUG_IP;
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function toApi(req, res) {
  if (!ipLogged) {
    ipLogged = true;
    console.log('ip check:', { xff: req.headers['x-forwarded-for'] ?? null, realIp: req.headers['x-real-ip'] ?? null, socket: req.socket.remoteAddress ?? null });
  }
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return json(res, 413, { error: 'too_large' });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null || k === 'x-forwarded-for' || k.startsWith(':')) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  headers.set('x-forwarded-for', clientIp(req));
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > MAX_BODY_BYTES) return json(res, 413, { error: 'too_large' });
      chunks.push(c);
    }
    body = Buffer.concat(chunks);
  }
  const path = req.url.slice('/api'.length) || '/';
  const host = req.headers.host ?? 'localhost';
  const response = await api.handle(new Request(`https://${host}${path.startsWith('/') ? path : `/${path}`}`, { method: req.method, headers, body }));
  const out = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  if (!response.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const work = url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? toApi(req, res) : nextHandle(req, res);
  Promise.resolve(work).catch((e) => {
    console.error('request failed:', req.method, url.split('?')[0], e);
    if (!res.headersSent) json(res, 500, { error: 'internal_error' });
    else res.destroy();
  });
});
server.requestTimeout = 120_000;
server.listen(port, () => console.log(`anti listening (${readFileSync(join(here, 'BUILD.txt'), 'utf8').trim()})`));

// The host may stop an idle app; a visit to itself now and then keeps the jobs (push, cleanup) running.
const self = process.env.SELF_URL;
if (self) {
  setInterval(() => {
    fetch(`${self.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(20_000) }).catch((e) =>
      console.error('keep-awake visit failed:', String(e)));
  }, 45_000).unref();
}

let stopping = false;
async function stop(why, code) {
  if (stopping) return;
  stopping = true;
  console.log(`anti stopping: ${why} after ${upFor()}`);
  server.close();
  await api.close().catch((e) => console.error('closing the database failed:', e));
  process.exit(code);
}
process.on('SIGTERM', () => void stop('SIGTERM', 0));
process.on('SIGINT', () => void stop('SIGINT', 0));
process.on('SIGHUP', () => void stop('SIGHUP', 0));
process.on('uncaughtException', (e) => { console.error('anti crashed:', e); void stop('crash', 1); });
