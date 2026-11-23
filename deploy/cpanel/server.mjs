/**
 * A web copy of the site, for cPanel hosting (docs/deploy-cpanel.md). LiteSpeed starts as many of
 * these as it likes and ends them when it likes. None of them touch the database:
 *
 *   /api/…          → the keeper (keeper.mjs), over a local socket, with "/api" taken off
 *   everything else → Next.js (the standalone build in web/)
 *
 * If there is no keeper, or it is older than this copy (build or settings), this copy starts one.
 * Plain JavaScript: it runs as is, nothing compiles it.
 */
import { spawn } from 'node:child_process';
import { request as httpRequest, createServer } from 'node:http';
import { connect } from 'node:net';
import { closeSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BUILD, LOCK_FILE, SOCKET, STARTING_FILE, here, settingsHash, setupLog } from './common.mjs';

setupLog('web');
const webDir = join(here, 'web/apps/web');
const MAX_BODY_BYTES = 30 * 1024 * 1024; // same cap as the Bun API (index.ts)
const started = Date.now();
const me = { build: BUILD, settings: settingsHash(), started };
const { outranks, readHolder } = await import('./api/index.mjs');

// --- the keeper ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answers = () => new Promise((ok) => {
  const s = connect(SOCKET);
  s.once('connect', () => { s.destroy(); ok(true); });
  s.once('error', () => ok(false));
  s.setTimeout(2000, () => { s.destroy(); ok(false); });
});

/** Starts a keeper unless one is already starting (a marker file, so a burst starts only one). */
function startKeeper(why) {
  const marker = STARTING_FILE;
  try {
    if (Date.now() - statSync(marker).mtimeMs < 45_000) return; // someone else is on it
    rmSync(marker, { force: true });
  } catch { /* no marker */ }
  try { closeSync(openSync(marker, 'wx')); } catch { return; }
  console.log(`starting a keeper: ${why}`);
  const child = spawn(process.execPath, [join(here, 'keeper.mjs')], {
    detached: true, stdio: 'ignore', cwd: here,
    env: { ...process.env, ANTI_STARTED: String(started) },
  });
  child.on('error', (e) => console.error('could not start the keeper:', e));
  child.unref();
}

/** Makes sure a keeper as new as this copy is answering (waits up to 90 s). */
async function ensureKeeper() {
  const holder = readHolder(LOCK_FILE);
  if (!holder) startKeeper('none running');
  else if (outranks(me, holder)) startKeeper(`it is older (${holder.build ?? 'an older build'})`);
  for (let i = 0; i < 180; i++) {
    const h = readHolder(LOCK_FILE);
    if (h && !outranks(me, h) && (await answers())) return true;
    if (!h && i > 0 && i % 20 === 0) startKeeper('still none running');
    await sleep(500);
  }
  return false;
}
let ready = ensureKeeper();

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
 * The visitor's address. LiteSpeed adds it as the LAST X-Forwarded-For entry (checked on the
 * host: socket 127.0.0.1, X-Forwarded-For = the visitor); anything before it is whatever the
 * visitor sent, so it is never believed. The API then reads exactly one clean entry.
 */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const last = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last || req.socket.remoteAddress || 'unknown';
}

function json(res, status, body) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

/** One try at the keeper. Resolves false when it can't be reached (nothing was sent back yet). */
function forward(req, res, headers, body) {
  return new Promise((done) => {
    const path = req.url.slice('/api'.length) || '/';
    const up = httpRequest({ socketPath: SOCKET, method: req.method, path: path.startsWith('/') ? path : `/${path}`, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
      r.on('end', () => done(true));
      r.on('error', () => { res.destroy(); done(true); });
    });
    up.on('error', () => done(false));
    up.setTimeout(120_000, () => up.destroy());
    up.end(body);
  });
}

async function toApi(req, res) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return json(res, 413, { error: 'too_large' });
  const headers = { ...req.headers, 'x-forwarded-for': clientIp(req) };
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
    headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];
  }
  await ready;
  if (await forward(req, res, headers, body)) return;
  // the keeper went away (stopped for a newer one, or the host ended it): find or start one, try once more
  ready = ensureKeeper();
  if ((await ready) && (await forward(req, res, headers, body))) return;
  json(res, 503, { error: 'unavailable' });
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const work = url === '/api' || url.startsWith('/api/') || url.startsWith('/api?') ? toApi(req, res) : nextHandle(req, res);
  Promise.resolve(work).catch((e) => {
    console.error('request failed:', req.method, url.split('?')[0], e);
    json(res, 500, { error: 'internal_error' });
  });
});
server.requestTimeout = 120_000;
server.listen(port, () => console.log(`web listening (${BUILD})`));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => { console.error('web copy crashed:', e); process.exit(1); });
