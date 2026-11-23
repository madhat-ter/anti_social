/**
 * Shared by server.mjs (the web copies LiteSpeed starts, as many as it likes) and keeper.mjs (the
 * one process that owns the database). See docs/deploy-cpanel.md.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

export const here = dirname(fileURLToPath(import.meta.url));
export const BUILD = readFileSync(join(here, 'BUILD.txt'), 'utf8').trim();

process.env.NODE_ENV = 'production';
process.env.ANTI_DATA_DIR ??= join(process.env.HOME ?? here, 'anti-data');
export const DATA_DIR = process.env.ANTI_DATA_DIR;
export const LOCK_FILE = join(DATA_DIR, 'db.lock');
/** "A keeper is being started": so a burst of web copies starts one. The keeper removes it. */
export const STARTING_FILE = join(DATA_DIR, 'keeper.starting');
/** Where the keeper answers. A Unix socket on the host; a named pipe when tried on Windows. */
export const SOCKET = process.env.ANTI_API_SOCKET
  ?? (process.platform === 'win32'
    ? `\\\\.\\pipe\\anti-api-${createHash('sha256').update(DATA_DIR).digest('hex').slice(0, 12)}`
    : join(DATA_DIR, 'api.sock'));

/**
 * Every line also goes to ~/anti-data/logs/app.log (2 MB, then app.log.1): the host keeps no log
 * that cPanel shows. `who` tells the web copies and the keeper apart.
 */
export function setupLog(who) {
  const logDir = join(DATA_DIR, 'logs');
  const logFile = join(logDir, 'app.log');
  mkdirSync(logDir, { recursive: true });
  const toFile = (level, args) => {
    try {
      if (existsSync(logFile) && statSync(logFile).size > 2_000_000) renameSync(logFile, `${logFile}.1`);
      const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack : inspect(a, { depth: 4 }))).join(' ');
      appendFileSync(logFile, `${new Date().toISOString()} ${who}[${process.pid}] ${level} ${text}\n`);
    } catch { /* never let logging break the site */ }
  };
  for (const level of ['log', 'error', 'warn']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); toFile(level === 'log' ? 'info' : level, args); };
  }
}

/** The settings the API reads. A change to any of them (cPanel → Save) means a new keeper. */
const SETTING = /^(WEB_ORIGIN|RP_ID|RP_NAME|COOKIE_SECURE|TRUST_PROXY|STORAGE|UPLOAD_DIR|PAYMENTS|ALLOW_.*|STRIPE_.*|VAPID_.*|CONTACT_KEY|R2_.*|OPS_HANDLES|PIN_RESET_HANDLE|BOOTSTRAP_INVITES|JOBS|DEBUG_IP)$/;
export function settingsHash(env = process.env) {
  const pairs = Object.keys(env).filter((k) => SETTING.test(k)).sort().map((k) => [k, env[k]]);
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16);
}

/** When the build was made, from "built <ISO time> from …"; '' for anything older or unknown. */
export const buildTime = (build) => (String(build ?? '').match(/\d{4}-\d\d-\d\dT[\d:.]+Z/) ?? [''])[0];
