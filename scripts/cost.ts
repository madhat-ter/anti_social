/**
 * What building this site has cost: a spreadsheet computed from the Claude Code transcripts
 * of this project (every assistant turn records its token usage and model), plus hosting.
 *
 *   bun scripts/cost.ts [transcripts dir]          → writes COST.xlsx at the repo root
 *   bun scripts/cost.ts --edit [transcripts dir]   → updates the numbers in the existing COST.xlsx in place
 *
 * Default dir: ~/.claude/projects/E--work-anti-site (this repo's project folder). Scans every
 * .jsonl under it (subagent transcripts live in subfolders), dedupes by message id, and prices
 * the tokens at Anthropic's published API list prices (table below). The workbook is written by
 * exceljs (a dev dependency). The owner wanted a spreadsheet, not a PDF (2026-11-09).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

// $ per million tokens: input, output, cache read, cache write (5-minute = 1.25x input, 1-hour = 2x input).
// Source: Anthropic pricing as cached in the claude-api skill (2026-10-06). Update when prices change.
const PRICES: Record<string, { in: number; out: number; read: number; write5m: number; write1h: number }> = {
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25, write5m: 12.5, write1h: 20 },
  'claude-fable-5': { in: 10, out: 50, read: 0.25, write5m: 12.5, write1h: 20 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2, write5m: 5, write1h: 8 },
  'claude-opus-5': { in: 5, out: 25, read: 0.5, write5m: 6.25, write1h: 10 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2, write5m: 2.5, write1h: 4 },
  'claude-sonnet-5': { in: 2, out: 10, read: 0.2, write5m: 2.5, write1h: 4 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, write5m: 0.125, write1h: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, read: 0.1, write5m: 1.25, write1h: 2 },
};
const priceFor = (model: string) => {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return key ? PRICES[key]! : null;
};

type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};
type Tally = { turns: number; in: number; out: number; read: number; write5m: number; write1h: number; cost: number };
const tally = (): Tally => ({ turns: 0, in: 0, out: 0, read: 0, write5m: 0, write1h: 0, cost: 0 });

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith('.jsonl')) yield p;
  }
}

// ── read every transcript
const args = process.argv.slice(2);
/** `--edit`: update the numbers in the existing COST.xlsx and leave everything else in it alone (owner's call, 2026-11-09) */
const EDIT = args.includes('--edit');
const dir = args.find((a) => !a.startsWith('--')) ?? join(homedir(), '.claude', 'projects', 'E--work-anti-site');
const byModel = new Map<string, Tally>();
const bySession = new Map<string, { first: string; last: string; cost: number; turns: number; asks: number }>();
const seen = new Set<string>();
const unpriced = new Set<string>();
let firstAt = '', lastAt = '';

for (const f of files(dir)) {
  const session = f.replace(dir, '').replace(/^[\\/]/, '').replace(/\.jsonl$/, '').split(/[\\/]/)[0]!; // subagents count toward their session
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    if (ts) { if (!firstAt || ts < firstAt) firstAt = ts; if (ts > lastAt) lastAt = ts; }
    const s = bySession.get(session) ?? { first: ts, last: ts, cost: 0, turns: 0, asks: 0 };
    if (ts && (ts < s.first || !s.first)) s.first = ts;
    if (ts > s.last) s.last = ts;
    bySession.set(session, s);
    if (rec.type === 'user' && !(rec as { isMeta?: boolean }).isMeta) {
      const m = rec.message as { content?: unknown } | undefined;
      if (typeof m?.content === 'string') s.asks++; // a human turn is a plain string (tool results arrive as arrays)
    }
    if (rec.type !== 'assistant') continue;
    const msg = rec.message as { id?: string; model?: string; usage?: Usage } | undefined;
    if (!msg?.usage || !msg.model) continue;
    const id = msg.id ?? `${f}:${ts}`;
    if (seen.has(id)) continue; // one line per content block, the same usage on each
    seen.add(id);
    const p = priceFor(msg.model);
    if (!p) { if (msg.model.startsWith('claude')) unpriced.add(msg.model); continue; } // placeholders like "<synthetic>" carry no usage
    const u = msg.usage;
    const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    const w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const w5x = w5 + w1 === 0 ? (u.cache_creation_input_tokens ?? 0) : w5; // no TTL recorded: the cheaper rate
    const t = byModel.get(msg.model) ?? tally();
    t.turns++;
    t.in += u.input_tokens ?? 0; t.out += u.output_tokens ?? 0; t.read += u.cache_read_input_tokens ?? 0;
    t.write5m += w5x; t.write1h += w1;
    const cost = ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.read + w5x * p.write5m + w1 * p.write1h) / 1e6;
    t.cost += cost;
    byModel.set(msg.model, t);
    s.cost += cost; s.turns++;
  }
}

// ── numbers
const total = [...byModel.values()].reduce((a, t) => a + t.cost, 0);
const sum = (k: keyof Tally) => [...byModel.values()].reduce((a, t) => a + (t[k] as number), 0);
const asks = [...bySession.values()].reduce((a, s) => a + s.asks, 0);
const M = (n: number) => (n / 1e6).toFixed(2);
const $ = (n: number) => '$' + n.toFixed(2);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const hours = (a: string, b: string) => ((new Date(b).getTime() - new Date(a).getTime()) / 3.6e6);
const sessions = [...bySession].filter(([, v]) => v.turns > 0).sort((a, b) => a[1].first.localeCompare(b[1].first));
const activeHours = sessions.reduce((a, [, v]) => a + hours(v.first, v.last), 0);
const now = new Date();

// the spreadsheet: a Summary sheet, then one sheet per table
const wb = new ExcelJS.Workbook();
wb.creator = 'scripts/cost.ts';
wb.created = now;
const head = (ws: ExcelJS.Worksheet) => {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};
const bold = (row: ExcelJS.Row) => { row.font = { bold: true }; row.border = { top: { style: 'medium' } }; };
const USD = '"$"#,##0.00';
const MTOK = '#,##0.00';

const summary = wb.addWorksheet('Summary');
summary.columns = [{ header: 'What', key: 'k', width: 44 }, { header: 'Value', key: 'v', width: 22 }];
head(summary);
summary.addRows([
  { k: 'Model usage at API list price', v: total },
  { k: 'Hosting, domain, storage, payments', v: 0 },
  { k: 'Total so far', v: total },
  { k: 'Claude Code sessions', v: sessions.length },
  { k: 'Hours of work (first to last message per session)', v: Number(activeHours.toFixed(1)) },
  { k: 'Messages typed by the owner', v: asks },
  { k: 'Model turns', v: sum('turns') },
  { k: 'First session', v: day(firstAt) },
  { k: 'Last activity', v: day(lastAt) },
  { k: 'Computed on', v: day(now.toISOString()) },
]);
for (const r of [2, 3, 4]) summary.getCell(`B${r}`).numFmt = USD;
bold(summary.getRow(4));
summary.addRow({});
summary.addRow({ k: 'The cost is what the tokens would be billed at Anthropic API list prices. On a Claude subscription the money actually paid is the subscription fee; this is the value used against it.' });
summary.addRow({ k: 'Cache writes with no recorded lifetime are priced as 5-minute writes, the cheaper rate.' + (unpriced.size ? ` Left out (no price): ${[...unpriced].join(', ')}.` : '') });

const models = wb.addWorksheet('Model usage');
models.columns = [
  { header: 'Model', key: 'model', width: 26 }, { header: 'Turns', key: 'turns', width: 9 },
  { header: 'Input (M tokens)', key: 'in', width: 16 }, { header: 'Output (M tokens)', key: 'out', width: 17 },
  { header: 'Cache read (M tokens)', key: 'read', width: 21 }, { header: 'Cache write 5 min (M tokens)', key: 'w5', width: 27 },
  { header: 'Cache write 1 h (M tokens)', key: 'w1', width: 25 }, { header: 'Cost', key: 'cost', width: 12 },
];
head(models);
for (const [model, t] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
  models.addRow({ model, turns: t.turns, in: t.in / 1e6, out: t.out / 1e6, read: t.read / 1e6, w5: t.write5m / 1e6, w1: t.write1h / 1e6, cost: t.cost });
}
const mEnd = models.rowCount;
const mt = models.addRow({ model: 'Total' });
for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) mt.getCell(c).value = { formula: `SUM(${c}2:${c}${mEnd})` };
bold(mt);
for (const c of ['in', 'out', 'read', 'w5', 'w1']) models.getColumn(c).numFmt = MTOK;
models.getColumn('cost').numFmt = USD;

const prices = wb.addWorksheet('Prices used');
prices.columns = [
  { header: 'Model', key: 'k', width: 22 }, { header: 'Input $/M', key: 'in', width: 11 }, { header: 'Output $/M', key: 'out', width: 11 },
  { header: 'Cache read $/M', key: 'read', width: 15 }, { header: 'Cache write 5 min $/M', key: 'w5', width: 21 }, { header: 'Cache write 1 h $/M', key: 'w1', width: 19 },
];
head(prices);
const usedKeys = new Set([...byModel.keys()].map((m) => Object.keys(PRICES).find((k) => m.startsWith(k))));
for (const [k, p] of Object.entries(PRICES).filter(([k]) => usedKeys.has(k))) prices.addRow({ k, in: p.in, out: p.out, read: p.read, w5: p.write5m, w1: p.write1h });

const hosting = wb.addWorksheet('Hosting');
hosting.columns = [{ header: 'Item', key: 'i', width: 22 }, { header: 'Plan', key: 'p', width: 24 }, { header: 'Cost so far', key: 'c', width: 12 }, { header: 'Note', key: 'n', width: 80 }];
head(hosting);
hosting.addRows([
  { i: 'Web app', p: 'Vercel Hobby', c: 0, n: 'anti-social-opal.vercel.app' },
  { i: 'API', p: 'Render free web service', c: 0, n: 'sleeps after 15 minutes idle; a failed deploy leaves it down until the next one' },
  { i: 'Database', p: 'Render free Postgres', c: 0, n: '1 GB; expires 30 days after creation (created 8 Nov 2026); images are stored in it' },
  { i: 'Domain', p: 'none', c: 0, n: 'a real launch needs one and a fresh database (passkeys are bound to the host)' },
  { i: 'Payments', p: 'fake Stripe', c: 0, n: 'nobody has been charged; Stripe fees start with live keys' },
  { i: 'Fonts, icons, libraries', p: 'free / open source', c: 0, n: 'Bangla: Li Golesta Borno (Lipighor, permission requested); the rest are open source' },
]);
const hEnd = hosting.rowCount;
const ht = hosting.addRow({ i: 'Total' });
ht.getCell('C').value = { formula: `SUM(C2:C${hEnd})` };
bold(ht);
hosting.getColumn('c').numFmt = USD;

const sess = wb.addWorksheet('Per session');
sess.columns = [
  { header: 'Session', key: 's', width: 12 }, { header: 'Started', key: 'start', width: 20 }, { header: 'Length (hours)', key: 'h', width: 15 },
  { header: 'Owner messages', key: 'asks', width: 16 }, { header: 'Model turns', key: 'turns', width: 13 }, { header: 'Cost', key: 'cost', width: 12 },
];
head(sess);
for (const [s, v] of sessions) sess.addRow({ s: s.slice(0, 8), start: when(v.first), h: Number(hours(v.first, v.last).toFixed(1)), asks: v.asks, turns: v.turns, cost: v.cost });
const sEnd = sess.rowCount;
const st = sess.addRow({ s: 'Total' });
for (const c of ['C', 'D', 'E', 'F']) st.getCell(c).value = { formula: `SUM(${c}2:${c}${sEnd})` };
bold(st);
sess.getColumn('cost').numFmt = USD;
sess.addRow({});
sess.addRow({ s: 'Length is the time between a session\'s first and last message, so it includes pauses. Subagent work counts in the session that started it.' });

const out = join(import.meta.dir, '..', 'COST.xlsx');
if (EDIT && existsSync(out)) await editInPlace(out);
else await wb.xlsx.writeFile(out);
console.log(`Total at list price: ${$(total)} over ${sessions.length} sessions. ${EDIT ? 'Updated' : 'Wrote'} ${out}.`);

/**
 * Edit mode: open the workbook as it is (with whatever was changed in Excel) and touch only the
 * figures: the Summary values, the per-model and per-session rows (found by the name in column A;
 * new ones go in above "Total"), the Total formulas, and any price row that is missing.
 */
async function editInPlace(path: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const sheet = (name: string) => { const ws = book.getWorksheet(name); if (!ws) throw new Error(`COST.xlsx has no "${name}" sheet`); return ws; };
  const rowOf = (ws: ExcelJS.Worksheet, a: string) => { let r = 0; ws.eachRow((row, i) => { if (!r && String(row.getCell(1).value ?? '').trim() === a) r = i; }); return r; };
  /** the row for `key` (inserted above Total when new, copying the style of the row above) */
  const keyed = (ws: ExcelJS.Worksheet, key: string) => {
    const at = rowOf(ws, key);
    if (at) return ws.getRow(at);
    const totalAt = rowOf(ws, 'Total');
    ws.insertRow(totalAt, [key], 'i');
    return ws.getRow(totalAt);
  };
  const sums = (ws: ExcelJS.Worksheet, cols: string[]) => {
    const totalAt = rowOf(ws, 'Total');
    for (const c of cols) ws.getCell(`${c}${totalAt}`).value = { formula: `SUM(${c}2:${c}${totalAt - 1})` } as ExcelJS.CellFormulaValue;
  };

  const s = sheet('Summary');
  const put = (label: string, v: number | string) => { const r = rowOf(s, label); if (r) s.getCell(`B${r}`).value = v; };
  put('Model usage at API list price', total);
  put('Total so far', total);
  put('Claude Code sessions', sessions.length);
  put('Hours of work (first to last message per session)', Number(activeHours.toFixed(1)));
  put('Messages typed by the owner', asks);
  put('Model turns', sum('turns'));
  put('First session', day(firstAt));
  put('Last activity', day(lastAt));
  put('Computed on', day(now.toISOString()));

  const m = sheet('Model usage');
  for (const [model, t] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
    const row = keyed(m, model);
    row.getCell(2).value = t.turns; row.getCell(3).value = t.in / 1e6; row.getCell(4).value = t.out / 1e6;
    row.getCell(5).value = t.read / 1e6; row.getCell(6).value = t.write5m / 1e6; row.getCell(7).value = t.write1h / 1e6; row.getCell(8).value = t.cost;
  }
  sums(m, ['B', 'C', 'D', 'E', 'F', 'G', 'H']);

  const pr = sheet('Prices used');
  const used = new Set([...byModel.keys()].map((k) => Object.keys(PRICES).find((p) => k.startsWith(p))));
  for (const [k, p] of Object.entries(PRICES).filter(([k]) => used.has(k))) {
    if (!rowOf(pr, k)) pr.addRow([k, p.in, p.out, p.read, p.write5m, p.write1h]);
  }

  const ps = sheet('Per session');
  for (const [id, v] of sessions) {
    const row = keyed(ps, id.slice(0, 8));
    row.getCell(2).value = when(v.first); row.getCell(3).value = Number(hours(v.first, v.last).toFixed(1));
    row.getCell(4).value = v.asks; row.getCell(5).value = v.turns; row.getCell(6).value = v.cost;
  }
  sums(ps, ['C', 'D', 'E', 'F']);

  await book.xlsx.writeFile(path);
}