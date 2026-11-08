/**
 * What building this site has cost in model usage, computed from the Claude Code transcripts
 * of this project (every assistant turn records its token usage and model).
 *
 *   bun scripts/cost.ts [transcripts dir]
 *
 * Default dir: ~/.claude/projects/E--work-anti-site (this repo's project folder). Scans every
 * .jsonl under it (subagent transcripts live in subfolders), dedupes by message id, and prices
 * the tokens at Anthropic's published API list prices (table below). Writes COST.md.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

const dir = process.argv[2] ?? join(homedir(), '.claude', 'projects', 'E--work-anti-site');
const byModel = new Map<string, Tally>();
const bySession = new Map<string, { first: string; last: string; cost: number; turns: number }>();
const seen = new Set<string>();
let unpriced = new Set<string>();
let userTurns = 0;
let firstAt = '', lastAt = '';

for (const f of files(dir)) {
  const session = f.replace(dir, '').replace(/^[\\/]/, '').replace(/\.jsonl$/, '');
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    if (ts) { if (!firstAt || ts < firstAt) firstAt = ts; if (ts > lastAt) lastAt = ts; }
    if (rec.type === 'user' && !(rec as { isMeta?: boolean }).isMeta) {
      const m = rec.message as { content?: unknown } | undefined;
      // a human turn is a plain string (tool results arrive as arrays)
      if (typeof m?.content === 'string') userTurns++;
    }
    if (rec.type !== 'assistant') continue;
    const msg = rec.message as { id?: string; model?: string; usage?: Usage } | undefined;
    if (!msg?.usage || !msg.model) continue;
    const id = msg.id ?? `${f}:${ts}`;
    if (seen.has(id)) continue; // one line per content block, same usage on each
    seen.add(id);
    const p = priceFor(msg.model);
    if (!p) { unpriced.add(msg.model); continue; }
    const u = msg.usage;
    const w5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    const w1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    // older records carry only the total; count it as 5-minute writes (the cheaper assumption is stated in COST.md)
    const writeTotal = u.cache_creation_input_tokens ?? 0;
    const w5x = w5 + w1 === 0 ? writeTotal : w5;
    const t = byModel.get(msg.model) ?? tally();
    t.turns++;
    t.in += u.input_tokens ?? 0; t.out += u.output_tokens ?? 0; t.read += u.cache_read_input_tokens ?? 0;
    t.write5m += w5x; t.write1h += w1;
    const cost = ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.read + w5x * p.write5m + w1 * p.write1h) / 1e6;
    t.cost += cost;
    byModel.set(msg.model, t);
    const s = bySession.get(session) ?? { first: ts, last: ts, cost: 0, turns: 0 };
    if (ts && ts < s.first) s.first = ts;
    if (ts > s.last) s.last = ts;
    s.cost += cost; s.turns++;
    bySession.set(session, s);
  }
}

const total = [...byModel.values()].reduce((a, t) => a + t.cost, 0);
const sum = (k: keyof Tally) => [...byModel.values()].reduce((a, t) => a + (t[k] as number), 0);
const M = (n: number) => (n / 1e6).toFixed(2) + ' M';
const $ = (n: number) => '$' + n.toFixed(2);
const day = (iso: string) => iso.slice(0, 10);

const lines: string[] = [];
lines.push('# What anti has cost so far');
lines.push('');
lines.push(`Computed on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`bun scripts/cost.ts\` from the Claude Code transcripts of this project (${bySession.size} sessions, ${day(firstAt)} to ${day(lastAt)}).`);
lines.push('');
lines.push('## Model usage (the build)');
lines.push('');
lines.push('| Model | Turns | Input | Output | Cache read | Cache write (5 min) | Cache write (1 h) | Cost at list price |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [model, t] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
  lines.push(`| ${model} | ${t.turns} | ${M(t.in)} | ${M(t.out)} | ${M(t.read)} | ${M(t.write5m)} | ${M(t.write1h)} | ${$(t.cost)} |`);
}
lines.push(`| **Total** | ${sum('turns')} | ${M(sum('in'))} | ${M(sum('out'))} | ${M(sum('read'))} | ${M(sum('write5m'))} | ${M(sum('write1h'))} | **${$(total)}** |`);
lines.push('');
lines.push(`Human messages typed across all sessions: ${userTurns}.`);
if (unpriced.size) lines.push(`Models without a price in the table (not counted): ${[...unpriced].join(', ')}.`);
lines.push('');
lines.push('Prices used ($ per million tokens): ' + Object.entries(PRICES).filter(([k]) => [...byModel.keys()].some((m) => m.startsWith(k)))
  .map(([k, p]) => `${k} in ${p.in} / out ${p.out} / cache read ${p.read} / cache write ${p.write5m} (5 min) or ${p.write1h} (1 h)`).join('; ') + '.');
lines.push('');
lines.push('## Per session');
lines.push('');
lines.push('| Session | Started | Turns | Cost |');
lines.push('|---|---|---:|---:|');
for (const [s, v] of [...bySession].sort((a, b) => a[1].first.localeCompare(b[1].first))) {
  lines.push(`| ${s.slice(0, 8)} | ${v.first.slice(0, 16).replace('T', ' ')} | ${v.turns} | ${$(v.cost)} |`);
}
lines.push('');
lines.push('## Everything else');
lines.push('');
lines.push('| Item | Cost so far |');
lines.push('|---|---:|');
lines.push('| Hosting: Vercel Hobby (web) | $0 (free plan) |');
lines.push('| Hosting: Render free web service (API) + free Postgres | $0 (free plan; the database expires 30 days after creation) |');
lines.push('| Domain | $0 (none yet; the site runs on anti-social-opal.vercel.app) |');
lines.push('| Image storage | $0 (images live in the Render database) |');
lines.push('| Payments | $0 (fake Stripe; nobody has been charged) |');
lines.push('| Fonts, icons, libraries | $0 (open source; Google Fonts served from the build) |');
lines.push('');
lines.push('## How to read this');
lines.push('');
lines.push('- The model figure is what the tokens would cost at Anthropic\'s API list prices. On a Claude subscription (Pro or Max) the money actually spent is the subscription fee, and this number is the value consumed against it.');
lines.push('- Cache writes without a recorded TTL are priced as 5-minute writes (the cheaper rate). Sessions run with a 1-hour cache cost more where the transcript did not say which.');
lines.push('- Subagent turns are included (their transcripts live under the same project folder). Turns the transcript did not record usage for are not.');
lines.push('- Re-run `bun scripts/cost.ts` any time; it rewrites this file.');
lines.push('');

writeFileSync(join(import.meta.dir, '..', 'COST.md'), lines.join('\n'));
console.log(lines.slice(0, 12 + byModel.size).join('\n'));
console.log(`\nTotal at list price: ${$(total)} over ${bySession.size} sessions. Wrote COST.md.`);
