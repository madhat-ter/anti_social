import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@anti/db/testing';
import { openLocalDb } from '@anti/db';
import { wasmHash, wasmVerify } from '../src/lib/password';
import { exportLines, importFileIfPresent, importFiles, importLines } from '../src/lib/transfer';
import { lock, Outranked, outranks, readHolder, startEmbeddedApi } from '../src/embedded';
import { createApp } from '../src/app';
import { MemoryStorage } from '../src/lib/storage';
import { FakeStripeProvider } from '../src/lib/payments';
import { Client, cfg, cleanup, ORIGIN, setup, TEST_SETUP } from './client';

/** Hosting on cPanel (docs/deploy-cpanel.md): Node instead of Bun, PGlite files, moving the data. */
afterEach(cleanup);
const temps: string[] = [];
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'anti-cpanel-')); temps.push(d); return d; };

const PIN = '739206';
const rowsOf = async (db: { execute: (q: any) => Promise<unknown> }, q: ReturnType<typeof sql>) => ((await db.execute(q)) as any).rows as any[];

describe('PINs on Node', () => {
  test('a PIN hashed by Bun checks on Node, and one hashed on Node checks on Bun', async () => {
    const fromBun = await Bun.password.hash(PIN, { algorithm: 'argon2id' });
    expect(await wasmVerify(PIN, fromBun)).toBe(true);
    expect(await wasmVerify('000000', fromBun)).toBe(false);
    const fromNode = await wasmHash(PIN);
    expect(fromNode).toMatch(/^\$argon2id\$v=19\$m=65536,t=2,p=1\$/);
    expect(await Bun.password.verify(PIN, fromNode)).toBe(true);
    expect(await Bun.password.verify('000000', fromNode)).toBe(false);
    expect(await wasmVerify(PIN, 'not a hash')).toBe(false);
  }, 30_000);
});

async function filledSite() {
  const w = await setup();
  const join_ = async (handle: string) => {
    const c = w.client();
    const r = await c.post('/auth/join', { code: await w.mint(), handle, displayName: handle, pin: PIN });
    expect(r.status).toBe(200);
    expect((await c.put('/me/setup', TEST_SETUP)).status).toBe(200);
    return c;
  };
  const a = await join_('nova');
  await join_('orbit');
  expect((await a.post('/posts', { body: 'first post on the old site' })).status).toBe(200);
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  await w.t.db.execute(sql`insert into media_blobs (key, content_type, bytes) values ('x.webp', 'image/webp', ${bytes})`);
  return { w, a, bytes };
}

async function collect(gen: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const l of gen) out.push(l);
  return out;
}

describe('moving the site', () => {
  test('everything moves: members sign in with their PIN, posts, media bytes; ids continue', async () => {
    const { w, bytes } = await filledSite();
    const lines = await collect(exportLines(w.t.db));
    expect(JSON.parse(lines[0]!).antiExport).toBe(1);
    expect(lines.some((l) => l.includes('"t":"sessions"'))).toBe(false);

    const b = await createTestDb();
    const counts = await importLines(b.db, (async function* () { yield* lines.map((l) => l.trimEnd()); })());
    expect(counts.users).toBe(2);
    for (const t of ['users', 'posts', 'media_blobs', 'settings', 'invites']) {
      const [x] = await rowsOf(w.t.db, sql`select count(*)::int as n from ${sql.identifier(t)}`);
      const [y] = await rowsOf(b.db, sql`select count(*)::int as n from ${sql.identifier(t)}`);
      expect([t, y.n]).toEqual([t, x.n]);
    }
    const [blob] = await rowsOf(b.db, sql`select bytes from media_blobs where key = 'x.webp'`);
    expect([...new Uint8Array(blob.bytes)]).toEqual([...bytes]);
    const [post] = await rowsOf(b.db, sql`select body, search is not null as indexed from posts`);
    expect(post).toEqual({ body: 'first post on the old site', indexed: true });

    // the moved site works: sign in with the old PIN, post again
    const app = createApp({ db: b.db, cfg, storage: new MemoryStorage(), payments: new FakeStripeProvider(ORIGIN) });
    const c = new Client(app);
    expect((await c.post('/auth/pin/login', { handle: 'nova', pin: PIN })).status).toBe(200);
    expect((await c.post('/posts', { body: 'first post on the new site' })).status).toBe(200);
    // identity columns continue after the moved rows
    const [seq] = await rowsOf(b.db, sql`
      select nextval(pg_get_serial_sequence('user_state_events', 'id')) as next, (select max(id) from user_state_events) as top`);
    expect(Number(seq.next)).toBeGreaterThan(Number(seq.top));

    // never twice, never over a live site
    await expect(importLines(b.db, (async function* () { yield* lines; })())).rejects.toThrow(/already has 2 members/);
    await b.close();
  }, 60_000);

  test('a broken file changes nothing', async () => {
    const { w } = await filledSite();
    const lines = await collect(exportLines(w.t.db));
    const b = await createTestDb();
    const [before] = await rowsOf(b.db, sql`select count(*)::int as n from settings`);
    await expect(importLines(b.db, (async function* () { yield* lines.slice(0, 5); yield '{"t":"nope","r":{}}'; })())).rejects.toThrow();
    const [after] = await rowsOf(b.db, sql`select count(*)::int as n from settings`);
    expect(after.n).toBe(before.n);
    await b.close();
  }, 60_000);

  test('the download is for admins only, and only where ALLOW_EXPORT=true', async () => {
    const { w, a } = await filledSite();
    expect((await a.get('/ops/export')).status).toBe(404); // a member: no such page
    await w.t.db.execute(sql`update users set role = 'ops' where handle = 'nova'`);
    delete process.env.ALLOW_EXPORT;
    expect((await a.get('/ops/export')).status).toBe(404); // switched off
    process.env.ALLOW_EXPORT = 'true';
    try {
      const r = await a.raw('GET', '/ops/export');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-disposition')).toContain('anti-export-');
      const text = gunzipSync(new Uint8Array(await r.arrayBuffer())).toString('utf8');
      expect(text.split('\n').filter((l) => l.includes('"t":"users"')).length).toBe(2);
    } finally {
      delete process.env.ALLOW_EXPORT;
    }
  }, 60_000);
});

describe('one keeper of the database', () => {
  const OLD = 'built 2026-11-23T11:00:00.000Z from aaaaaaa for https://tryanti.social';
  const NEW = 'built 2026-11-23T12:00:00.000Z from bbbbbbb for https://tryanti.social';

  test('who replaces whom: a newer build, or new settings started later; never backwards', () => {
    const keeper = { build: NEW, settings: 's1', started: 1000 };
    expect(outranks({ build: NEW, settings: 's1', started: 2000 }, keeper)).toBe(false); // same kind: no fight
    expect(outranks({ build: OLD, settings: 's1', started: 9000 }, keeper)).toBe(false); // older build: never
    expect(outranks({ build: NEW, settings: 's2', started: 2000 }, keeper)).toBe(true);  // settings saved later
    expect(outranks({ build: NEW, settings: 's2', started: 500 }, keeper)).toBe(false);  // an old copy with old settings
    expect(outranks({ build: NEW, settings: 's1', started: 1 }, { build: OLD, settings: 's1', started: 9999 })).toBe(true);
    expect(outranks({ build: OLD, settings: 's1', started: 1 }, null)).toBe(true);        // free, or an older lock format
    expect(outranks({ build: OLD, settings: 's1', started: 1 }, { started: 5 })).toBe(true);
  });

  async function holdLock(file: string, content: string) {
    const holder = Bun.spawn(['bun', '-e', `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(content)}.replace('PID', process.pid));
      process.on('SIGTERM', () => { fs.rmSync(${JSON.stringify(file)}, { force: true }); process.exit(0); });
      setInterval(() => {}, 1000);`]);
    for (let i = 0; i < 50 && !existsSync(file); i++) await Bun.sleep(100);
    expect(existsSync(file)).toBe(true);
    return holder;
  }

  test('a newer keeper asks the one holding the database to stop, then takes it', async () => {
    const file = join(tempDir(), 'db.lock');
    const old = await holdLock(file, 'PID built_2026-11-23T12:02:57.902Z_from_5bb5806'); // the format before keepers
    const me = { build: NEW, settings: 's1', started: Date.now() };
    const t0 = Date.now();
    const unlock = await lock(file, me);
    expect(Date.now() - t0).toBeLessThan(30_000);
    await old.exited;
    expect(JSON.parse(await Bun.file(file).text())).toEqual({ pid: process.pid, ...me });
    expect(readHolder(file)?.pid).toBe(process.pid);
    unlock();
    expect(existsSync(file)).toBe(false);
  }, 60_000);

  test('a keeper that is not newer leaves the database alone', async () => {
    const file = join(tempDir(), 'db.lock');
    const current = await holdLock(file, JSON.stringify({ pid: 'PID', build: NEW, settings: 's1', started: 1000 }).replace('"PID"', 'PID'));
    try {
      await expect(lock(file, { build: NEW, settings: 's1', started: 5000 })).rejects.toBeInstanceOf(Outranked);
      expect(readHolder(file)?.pid).toBe(current.pid); // still the holder, never signalled
    } finally {
      current.kill();
      await current.exited;
    }
  }, 60_000);
});

describe('an import cut into pieces', () => {
  test('parts are found in number order and load like the whole file', async () => {
    const { w } = await filledSite();
    const dir = tempDir();
    const { gzipSync } = await import('node:zlib');
    const whole = gzipSync((await collect(exportLines(w.t.db))).join(''));
    // 11 pieces, cut at odd byte offsets, so .part10 and .part11 must come after .part9
    const size = Math.ceil(whole.length / 11);
    for (let i = 0; i < 11; i++) await Bun.write(join(dir, `import.ndjson.gz.part${i + 1}`), whole.subarray(i * size, (i + 1) * size));
    expect(importFiles(join(dir, 'import.ndjson.gz')).map((f) => f.split(/[\\/]/).pop())).toEqual(
      Array.from({ length: 11 }, (_, i) => `import.ndjson.gz.part${i + 1}`));
    const b = await createTestDb();
    expect(await importFileIfPresent(b.db, join(dir, 'import.ndjson.gz'), () => {})).toBe(true);
    const [n] = await rowsOf(b.db, sql`select count(*)::int as n from users`);
    expect(n.n).toBe(2);
    expect(importFiles(join(dir, 'import.ndjson.gz'))).toEqual([]); // renamed: never twice
    await b.close();
  }, 60_000);
});

describe('the database as files', () => {
  test('what is written survives closing and opening again; a backup can be taken', async () => {
    const dir = tempDir();
    const one = await openLocalDb(join(dir, 'pg'));
    await one.db.execute(sql`update settings set value = '42'::jsonb where key = 'seat_cap'`);
    const backup = await one.backup();
    expect(backup.length).toBeGreaterThan(1000);
    await one.close();
    const two = await openLocalDb(join(dir, 'pg'));
    const [row] = await rowsOf(two.db, sql`select value from settings where key = 'seat_cap'`);
    expect(row.value).toBe(42);
    await two.close();
  }, 120_000);

  test('the embedded API answers, loads an import file once, and frees its lock on close', async () => {
    const { w } = await filledSite();
    const dir = tempDir();
    const { gzipSync } = await import('node:zlib');
    await Bun.write(join(dir, 'import.ndjson.gz'), gzipSync((await collect(exportLines(w.t.db))).join('')));
    const env = { ANTI_DATA_DIR: dir, WEB_ORIGIN: ORIGIN, RP_ID: 'localhost', COOKIE_SECURE: 'false', JOBS: 'off' };
    const api = await startEmbeddedApi(env);
    try {
      expect(existsSync(join(dir, 'db.lock'))).toBe(true);
      const h = await api.handle(new Request('http://localhost/health'));
      expect(await h.json()).toEqual({ ok: true });
      const r = await api.handle(new Request('http://localhost/auth/pin/login', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ handle: 'orbit', pin: PIN }),
      }));
      expect(r.status).toBe(200);
      expect(existsSync(join(dir, 'import.ndjson.gz'))).toBe(false); // renamed: it never runs twice
    } finally {
      await api.close();
    }
    expect(existsSync(join(dir, 'db.lock'))).toBe(false);
  }, 120_000);
});
