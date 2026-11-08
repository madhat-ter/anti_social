/**
 * What building this site has cost: a PDF report computed from the Claude Code transcripts of
 * this project (every assistant turn records its token usage and model), plus hosting.
 *
 *   bun scripts/cost.ts [transcripts dir]      → writes COST.pdf at the repo root
 *
 * Default dir: ~/.claude/projects/E--work-anti-site (this repo's project folder). Scans every
 * .jsonl under it (subagent transcripts live in subfolders), dedupes by message id, and prices
 * the tokens at Anthropic's published API list prices (table below). The PDF is printed from
 * HTML by the installed Chrome, through playwright-core (already a dev dependency).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

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
const dir = process.argv[2] ?? join(homedir(), '.claude', 'projects', 'E--work-anti-site');
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
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const now = new Date();

// ── the document
const css = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.45 Archivo, "Helvetica Neue", Arial, sans-serif; color: #000; margin: 0; }
  h1 { font-size: 30pt; line-height: .95; margin: 0 0 4mm; text-transform: uppercase; letter-spacing: -.01em; font-weight: 900; }
  h1 .dot { color: #e8412c; }
  h2 { font-size: 15pt; margin: 9mm 0 3mm; text-transform: uppercase; font-weight: 900; display: flex; align-items: center; gap: 3mm; }
  h2::after { content: ''; flex: 1; height: 2pt; background: #000; }
  .lede { font-size: 11.5pt; max-width: 150mm; margin: 0 0 3mm; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 5mm 0 2mm; }
  .kpi { border: 1.5pt solid #000; padding: 3mm 3.5mm; }
  .kpi b { display: block; font-size: 20pt; line-height: 1; font-weight: 900; }
  .kpi span { display: block; font-size: 9pt; color: #444; margin-top: 1.5mm; }
  .kpi.total { background: #000; color: #fff; }
  .kpi.total span { color: #ccc; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 2mm 0; }
  th, td { padding: 1.6mm 2mm; border-bottom: .6pt solid #000; text-align: left; vertical-align: top; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1.5pt solid #000; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 900; border-top: 1.5pt solid #000; border-bottom: 0; }
  .note { font-size: 9pt; color: #333; }
  .note li { margin: 0 0 1.2mm; }
  .foot { margin-top: 8mm; font-size: 8.5pt; color: #555; border-top: .6pt solid #000; padding-top: 2mm; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 8.5pt; white-space: nowrap; }
`;

const modelRows = [...byModel].sort((a, b) => b[1].cost - a[1].cost).map(([model, t]) => `
  <tr><td><code>${esc(model)}</code></td><td class="n">${t.turns}</td><td class="n">${M(t.in)}</td><td class="n">${M(t.out)}</td>
      <td class="n">${M(t.read)}</td><td class="n">${M(t.write5m)}</td><td class="n">${M(t.write1h)}</td><td class="n">${$(t.cost)}</td></tr>`).join('');

const sessionRows = sessions.map(([s, v]) => `
  <tr><td><code>${s.slice(0, 8)}</code></td><td>${when(v.first)}</td><td class="n">${hours(v.first, v.last).toFixed(1)} h</td>
      <td class="n">${v.asks}</td><td class="n">${v.turns}</td><td class="n">${$(v.cost)}</td></tr>`).join('');

const usedKeys = new Set([...byModel.keys()].map((m) => Object.keys(PRICES).find((k) => m.startsWith(k))));
const used = Object.entries(PRICES).filter(([k]) => usedKeys.has(k));
const priceRows = used.map(([k, p]) => `
  <tr><td><code>${k}</code></td><td class="n">${p.in.toFixed(2)}</td><td class="n">${p.out.toFixed(2)}</td><td class="n">${p.read.toFixed(2)}</td><td class="n">${p.write5m.toFixed(2)}</td><td class="n">${p.write1h.toFixed(2)}</td></tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>What anti has cost</title><style>${css}</style></head><body>
<h1>What anti has cost<span class="dot">.</span></h1>
<p class="lede">Every expense behind the site so far: the model usage that built it, and the hosting it runs on.
Computed on ${day(now.toISOString())} from the ${sessions.length} Claude Code sessions of this project (${day(firstAt)} to ${day(lastAt)}).</p>

<div class="kpis">
  <div class="kpi total"><b>${$(total)}</b><span>model usage at API list price</span></div>
  <div class="kpi"><b>$0</b><span>hosting, domain, storage, payments</span></div>
  <div class="kpi"><b>${sessions.length}</b><span>sessions, ${activeHours.toFixed(0)} hours of work</span></div>
  <div class="kpi"><b>${asks}</b><span>messages typed by the owner</span></div>
</div>

<h2>Model usage</h2>
<table>
  <thead><tr><th>Model</th><th class="n">Turns</th><th class="n">Input (M)</th><th class="n">Output (M)</th><th class="n">Cache read (M)</th><th class="n">Cache write 5 min (M)</th><th class="n">Cache write 1 h (M)</th><th class="n">Cost</th></tr></thead>
  <tbody>${modelRows}
  <tr class="total"><td>Total</td><td class="n">${sum('turns')}</td><td class="n">${M(sum('in'))}</td><td class="n">${M(sum('out'))}</td><td class="n">${M(sum('read'))}</td><td class="n">${M(sum('write5m'))}</td><td class="n">${M(sum('write1h'))}</td><td class="n">${$(total)}</td></tr>
  </tbody>
</table>
<ul class="note">
  <li>A turn is one model response. Tokens are in millions. Almost all input arrives as cache reads: the conversation is re-sent on every turn, and the cache makes that cheap.</li>
  <li>The cost is what these tokens would be billed at Anthropic's API list prices. On a Claude subscription (Pro or Max) the money actually paid is the subscription fee; this figure is the value used against it.</li>
  <li>Cache writes with no recorded lifetime are priced as 5-minute writes, the cheaper rate.${unpriced.size ? ` Models with no price in the table were left out: ${[...unpriced].join(', ')}.` : ''}</li>
</ul>

<h2>Prices used</h2>
<table>
  <thead><tr><th>Model</th><th class="n">Input $/M</th><th class="n">Output $/M</th><th class="n">Cache read $/M</th><th class="n">Cache write 5 min $/M</th><th class="n">Cache write 1 h $/M</th></tr></thead>
  <tbody>${priceRows}</tbody>
</table>

<h2>Hosting and everything else</h2>
<table>
  <thead><tr><th>Item</th><th>Plan</th><th class="n">Cost so far</th><th>Note</th></tr></thead>
  <tbody>
    <tr><td>Web app</td><td>Vercel Hobby</td><td class="n">$0</td><td>anti-social-opal.vercel.app</td></tr>
    <tr><td>API</td><td>Render free web service</td><td class="n">$0</td><td>sleeps after 15 minutes idle; a failed deploy leaves it down until the next one</td></tr>
    <tr><td>Database</td><td>Render free Postgres</td><td class="n">$0</td><td>1 GB; expires 30 days after creation (created 8 Nov 2026); images are stored in it</td></tr>
    <tr><td>Domain</td><td>none</td><td class="n">$0</td><td>a real launch needs one and a fresh database (passkeys are bound to the host)</td></tr>
    <tr><td>Payments</td><td>fake Stripe</td><td class="n">$0</td><td>nobody has been charged; Stripe fees start with live keys</td></tr>
    <tr><td>Fonts, icons, libraries</td><td>open source</td><td class="n">$0</td><td>Google Fonts are copied into the build, so visitors never contact Google</td></tr>
    <tr class="total"><td>Total</td><td></td><td class="n">$0</td><td></td></tr>
  </tbody>
</table>

<h2>Per session</h2>
<table>
  <thead><tr><th>Session</th><th>Started</th><th class="n">Length</th><th class="n">Owner messages</th><th class="n">Model turns</th><th class="n">Cost</th></tr></thead>
  <tbody>${sessionRows}
  <tr class="total"><td>Total</td><td></td><td class="n">${activeHours.toFixed(1)} h</td><td class="n">${asks}</td><td class="n">${sum('turns')}</td><td class="n">${$(total)}</td></tr>
  </tbody>
</table>
<p class="note">Length is the time between a session's first and last message, so it includes pauses. Subagent work is counted in the session that started it.</p>

<p class="foot">Generated by <code>bun scripts/cost.ts</code> from <code>${esc(dir)}</code>. Re-run it any time to refresh this document.</p>
</body></html>`;

const out = join(import.meta.dir, '..', 'COST.pdf');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}
console.log(`Total at list price: ${$(total)} over ${sessions.length} sessions. Wrote ${out}.`);
