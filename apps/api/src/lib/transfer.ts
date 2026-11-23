/**
 * Moving the whole site from one database to another (test site on Render → tryanti.social on
 * cPanel, 2026-11-23). No database address is typed or copied anywhere:
 *
 * 1. On the old site, with ALLOW_EXPORT=true, an admin downloads GET /ops/export: every table,
 *    one row per line, as Postgres itself renders it (row_to_json), gzipped.
 * 2. That file is put in the new site's data folder as `import.ndjson.gz`.
 * 3. The new site, on start, finds it and a database with no members, and loads it.
 *
 * Postgres writes and reads the values itself (json_populate_recordset), so timestamps, arrays,
 * jsonb and bytea (as \x… hex) come back exactly. Members' contact details stay sealed: the new
 * site needs the same CONTACT_KEY to open them.
 */
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { rows, scalar, type Db } from '@anti/db';

/** Not moved: counters that only matter for the hour they were made, and live sign-ins (the
 *  new site has another address, so these cookies could never reach it anyway). */
const SKIP = new Set(['rate_limits', 'sessions']);
const BATCH = 50;

async function tableNames(db: Db): Promise<string[]> {
  const r = await rows<{ table_name: string }>(db, sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  return r.map((x) => x.table_name).filter((t) => !SKIP.has(t));
}

/** Lines of the export: a header, then {"t": table, "r": row} per row. */
export async function* exportLines(db: Db): AsyncGenerator<string> {
  const tables = await tableNames(db);
  yield JSON.stringify({ antiExport: 1, at: new Date().toISOString(), tables }) + '\n';
  for (const t of tables) {
    for (let offset = 0; ; offset += BATCH) {
      const batch = await rows<{ j: unknown }>(db, sql`
        select row_to_json(x) as j from ${sql.identifier(t)} x order by ctid limit ${BATCH} offset ${offset}`);
      for (const { j } of batch) yield JSON.stringify({ t, r: typeof j === 'string' ? JSON.parse(j) : j }) + '\n';
      if (batch.length < BATCH) break;
    }
  }
}

/** The export as a gzipped download. */
export function exportResponse(db: Db): Response {
  const lines = exportLines(db);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const n = await lines.next();
      if (n.done) ctrl.close();
      else ctrl.enqueue(enc.encode(n.value));
    },
  }).pipeThrough(new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="anti-export-${day}.ndjson.gz"`,
      'cache-control': 'no-store',
    },
  });
}

async function columns(db: Db, table: string): Promise<string[]> {
  const r = await rows<{ column_name: string }>(db, sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER'
    order by ordinal_position`);
  return r.map((x) => x.column_name);
}

/** Loads an export into an empty site. Returns rows per table. Throws (and changes nothing) on any error. */
export async function importLines(db: Db, lines: AsyncIterable<string>): Promise<Record<string, number>> {
  const members = Number(await scalar(db, sql`select count(*) from users`));
  if (members > 0) throw new Error(`import refused: this site already has ${members} members`);
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    const d = tx as unknown as Db;
    // Rows arrive table by table, not in foreign-key order: checks and triggers wait until the end.
    await d.execute(sql`set local session_replication_role = replica`);
    const cols = new Map<string, string[]>();
    let header = false;
    let pending: { t: string; r: unknown[] } | null = null;
    const flush = async () => {
      if (!pending || !pending.r.length) return;
      const c = cols.get(pending.t)!;
      const list = sql.join(c.map((x) => sql.identifier(x)), sql`, `);
      await d.execute(sql`
        insert into ${sql.identifier(pending.t)} (${list}) overriding system value
        select ${list} from json_populate_recordset(null::${sql.identifier(pending.t)}, ${JSON.stringify(pending.r)}::json)`);
      counts[pending.t] = (counts[pending.t] ?? 0) + pending.r.length;
      pending.r = [];
    };
    for await (const line of lines) {
      if (!line.trim()) continue;
      const o = JSON.parse(line) as { antiExport?: number; tables?: string[]; t?: string; r?: unknown };
      if (!header) {
        if (o.antiExport !== 1 || !Array.isArray(o.tables)) throw new Error('not an anti export file');
        header = true;
        const here = new Set(await tableNames(d));
        for (const t of o.tables) {
          if (!here.has(t)) throw new Error(`export has table "${t}", which this site doesn't`);
          cols.set(t, await columns(d, t));
          // what the migrations put in (settings, the interest list…) is replaced by the export
          await d.execute(sql`delete from ${sql.identifier(t)}`);
        }
        continue;
      }
      if (!o.t || !cols.has(o.t)) throw new Error(`row for unknown table "${o.t}"`);
      if (pending && pending.t !== o.t) await flush();
      pending ??= { t: o.t, r: [] };
      pending.t = o.t;
      pending.r.push(o.r);
      if (pending.r.length >= BATCH) await flush();
    }
    await flush();
    if (!header) throw new Error('empty export file');
    // identity columns continue after the highest id moved in
    const ids = await rows<{ table_name: string; column_name: string }>(d, sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and is_identity = 'YES'`);
    for (const { table_name, column_name } of ids) {
      await d.execute(sql`
        select setval(pg_get_serial_sequence(${table_name}, ${column_name}),
          coalesce((select max(${sql.identifier(column_name)}) from ${sql.identifier(table_name)}), 0) + 1, false)`);
    }
  });
  return counts;
}

/**
 * The file, or its pieces `<file>.part1`, `.part2`, … (cut byte by byte, for uploads with a size
 * cap), in order. Empty when there is nothing to load.
 */
export function importFiles(file: string): string[] {
  if (existsSync(file)) return [file];
  const dir = dirname(file);
  const base = basename(file);
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names
    .map((n) => ({ n, i: n.startsWith(`${base}.part`) ? Number(n.slice(base.length + 5)) : NaN }))
    .filter((x) => Number.isInteger(x.i) && x.i > 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => join(dir, x.n));
}

/** On start: if the file (or its parts) is there and the site is empty, load it, then rename it so it runs once. */
export async function importFileIfPresent(db: Db, file: string, log: (s: string) => void = console.log): Promise<boolean> {
  const files = importFiles(file);
  if (!files.length) return false;
  const members = Number(await scalar(db, sql`select count(*) from users`));
  if (members > 0) {
    log(`import: ${files.join(', ')} is there but the site already has ${members} members; not loading it`);
    return false;
  }
  log(`import: loading ${files.join(' + ')}`);
  const bytes = Readable.from((async function* () { for (const f of files) yield* createReadStream(f); })());
  const lines = createInterface({ input: bytes.pipe(createGunzip()), crlfDelay: Infinity });
  const counts = await importLines(db, lines);
  const stamp = Date.now();
  for (const f of files) await rename(f, `${f}.done-${stamp}`);
  log(`import: done, ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  return true;
}
