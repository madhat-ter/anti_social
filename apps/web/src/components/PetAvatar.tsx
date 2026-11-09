/**
 * RFC §10.17: pet faces, drawn in code from `species:variant` in loose black ink on paper, after
 * the owner's reference doodles (docs/tasks/pet-avatars/): big rounded heads, wobbly outlines,
 * floppy or pointed ears, dot or dash eyes, a filled nose, the odd tongue or sparkle.
 *
 * Each species has a handful of poses taken from the doodles (a dog in profile, a floppy-eared dog
 * face-on, a shaggy dog, a dog standing in shades…), and every pose rolls its own eyes, mouth,
 * marks, proportions, line weight and tilt, so two pets rarely look alike. Same pet → same face,
 * everywhere; no image files. Ink = currentColor, fill = var(--paper), so both themes work.
 */
import type { ReactNode } from 'react';
import type { PetSpecies } from '@/lib/api';

const INK = 'currentColor';
const PAPER = 'var(--paper)';
const TAU = Math.PI * 2;
const n = (v: number) => Math.round(v * 10) / 10;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type R = () => number;
type P = [number, number];
const chance = (r: R, p: number) => r() < p;
const between = (r: R, a: number, b: number) => a + r() * (b - a);
const jit = (r: R, amount: number) => (r() - 0.5) * 2 * amount;
function weighted<T>(r: R, xs: readonly (readonly [T, number])[]): T {
  let t = r() * xs.reduce((s, x) => s + x[1], 0);
  for (const [v, w] of xs) if ((t -= w) < 0) return v;
  return xs[xs.length - 1]![0];
}

/* ─── the pen ────────────────────────────────────────────────────────────── */

/** A smooth hand line through the points (Catmull-Rom as cubic Béziers). */
function curve(pts: P[], closed = false): string {
  const m = pts.length;
  const at = (i: number) => (closed ? pts[(i + m) % m]! : pts[Math.max(0, Math.min(m - 1, i))]!);
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Straight-ish strokes with sharp corners, each slightly bowed, like quick pen lines. */
function sketch(r: R, pts: P[], bend = 0.7, closed = false): string {
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  const m = pts.length;
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const a = pts[i]!, b = pts[(i + 1) % m]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const o = jit(r, bend) * Math.min(1, len / 8);
    d += `Q${n((a[0] + b[0]) / 2 - (dy / len) * o)} ${n((a[1] + b[1]) / 2 + (dx / len) * o)} ${n(b[0])} ${n(b[1])}`;
  }
  return closed ? `${d}Z` : d;
}

const shake = (r: R, pts: P[], a: number): P[] => pts.map(([x, y]) => [x + jit(r, a), y + jit(r, a)]);

/** A point on a squashed circle; t in turns (0 = right, 0.25 = bottom, 0.5 = left, 0.75 = top). */
function spot(cx: number, cy: number, rx: number, ry: number, t: number, sq = 2, k = 1): P {
  const a = t * TAU, c = Math.cos(a), s = Math.sin(a), e = 2 / sq;
  return [cx + rx * k * Math.sign(c) * Math.abs(c) ** e, cy + ry * k * Math.sign(s) * Math.abs(s) ** e];
}

type Bump = { at: number; w: number; amt: number };
const turns = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
const bumpAt = (bs: Bump[], t: number) => bs.reduce((s, b) => s + b.amt * Math.exp(-((turns(t, b.at) / b.w) ** 2)), 0);

/** Points round a wobbly loop; `sq` > 2 squares it off, bumps push out a snout, tail or tuft. */
function ring(r: R, cx: number, cy: number, rx: number, ry: number,
  o: { sq?: number; noise?: number; count?: number; bumps?: Bump[] } = {}): P[] {
  const { sq = 2, noise = 0.035, count = 12, bumps = [] } = o;
  const off = r();
  let ts = Array.from({ length: count }, (_, i) => ((i + off) / count) % 1);
  for (const b of bumps) { ts = ts.filter((t) => turns(t, b.at) > 0.5 / count); ts.push(b.at); }
  ts.sort((a, b) => a - b);
  return ts.map((t) => spot(cx, cy, rx, ry, t, sq, 1 + bumpAt(bumps, t) + jit(r, noise)));
}

/** A paper-filled outline, optionally with a small break in the line (the pen lifted). */
function outline(pts: P[], gap = -1): ReactNode {
  const body = curve(pts, true);
  if (gap < 0) return <path d={body} fill={PAPER} />;
  const m = pts.length, a = pts[gap % m]!, b = pts[(gap + 1) % m]!;
  const lerp = (t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const open = [lerp(0.85), ...Array.from({ length: m }, (_, i) => pts[(gap + 1 + i) % m]!), lerp(0.15)];
  return <><path d={body} fill={PAPER} stroke="none" /><path d={curve(open)} /></>;
}

/** A paper shape whose line stops short (an ear whose inner edge just ends on the face). */
const flap = (pts: P[], fill: string) => <><path d={curve(pts, true)} fill={fill} stroke="none" /><path d={curve(pts)} /></>;

const blob = (r: R, x: number, y: number, rx: number, ry: number, noise = 0.09) =>
  <path d={curve(ring(r, x, y, rx, ry, { noise, count: 7 }), true)} fill={INK} strokeWidth={1} />;

/* ─── faces ──────────────────────────────────────────────────────────────── */

type EyeKind = 'dot' | 'dash' | 'slant' | 'happy' | 'closed' | 'wink' | 'big' | 'shades' | 'shine' | 'flat';

function eyes(kind: EyeKind, at: P[], s = 1, colors: string[] = []): ReactNode {
  return (
    <g>
      {at.map(([x, y], i) => {
        const c = colors[i] ?? INK;
        const k = kind === 'wink' ? (i === 1 ? 'happy' : 'dot') : kind;
        switch (k) {
          case 'dot': return <ellipse key={i} cx={n(x)} cy={n(y)} rx={n(1.9 * s)} ry={n(2.3 * s)} fill={c} stroke="none" />;
          case 'dash': return <path key={i} d={`M${n(x)} ${n(y - 2.2 * s)}L${n(x)} ${n(y + 2.2 * s)}`} stroke={c} />;
          case 'slant': return <path key={i} d={`M${n(x - 0.9 * s)} ${n(y - 2.5 * s)}L${n(x + 0.9 * s)} ${n(y + 2.5 * s)}`} stroke={c} />;
          case 'happy': return <path key={i} d={`M${n(x - 2.6 * s)} ${n(y + 1 * s)}Q${n(x)} ${n(y - 2.8 * s)} ${n(x + 2.6 * s)} ${n(y + 1 * s)}`} stroke={c} />;
          case 'closed': return <path key={i} d={`M${n(x - 2.6 * s)} ${n(y - 0.8 * s)}Q${n(x)} ${n(y + 2.8 * s)} ${n(x + 2.6 * s)} ${n(y - 0.8 * s)}`} stroke={c} />;
          case 'flat': return <path key={i} d={`M${n(x - 2.4 * s)} ${n(y)}L${n(x + 2.4 * s)} ${n(y)}`} stroke={c} />;
          case 'big': return (
            <g key={i}>
              <ellipse cx={n(x)} cy={n(y)} rx={n(3.6 * s)} ry={n(3.2 * s)} fill={PAPER} stroke={c} />
              <circle cx={n(x + 0.6 * s)} cy={n(y + 0.7 * s)} r={n(1.6 * s)} fill={c} stroke="none" />
            </g>
          );
          case 'shades': return (
            <g key={i}>
              <path d={`M${n(x - 4 * s)} ${n(y - 2.2 * s)}Q${n(x)} ${n(y - 3.4 * s)} ${n(x + 4 * s)} ${n(y - 2.2 * s)}Q${n(x + 4.4 * s)} ${n(y + 3 * s)} ${n(x)} ${n(y + 3 * s)}Q${n(x - 4.4 * s)} ${n(y + 3 * s)} ${n(x - 4 * s)} ${n(y - 2.2 * s)}Z`} fill={c} stroke={c} strokeWidth={1.2} />
              <path d={`M${n(x + 1 * s)} ${n(y - 1 * s)}L${n(x + 2.4 * s)} ${n(y + 0.6 * s)}`} stroke={PAPER} strokeWidth={1.2} />
            </g>
          );
          default: return (
            <g key={i}>
              <circle cx={n(x)} cy={n(y)} r={n(2.7 * s)} fill={c} stroke="none" />
              <circle cx={n(x - 0.9 * s)} cy={n(y - 0.9 * s)} r={n(0.9 * s)} fill={PAPER} stroke="none" />
            </g>
          );
        }
      })}
      {kind === 'shades' && at.length === 2 && (
        <path d={`M${n(at[0]![0] + 3.6 * s)} ${n(at[0]![1] - 1.8 * s)}L${n(at[1]![0] - 3.6 * s)} ${n(at[1]![1] - 1.8 * s)}`} strokeWidth={1.6} />
      )}
    </g>
  );
}

type MouthKind = 'w' | 'smile' | 'open' | 'tongue' | 'flat' | 'o' | 'none';

function mouth(kind: MouthKind, x: number, y: number, w: number, tongue = 4): ReactNode {
  const ww = `M${n(x - w)} ${n(y - 0.6)}Q${n(x - w / 2)} ${n(y + w * 0.8)} ${n(x)} ${n(y - 0.2)}Q${n(x + w / 2)} ${n(y + w * 0.8)} ${n(x + w)} ${n(y - 0.6)}`;
  switch (kind) {
    case 'w': return <path d={ww} />;
    case 'smile': return <path d={`M${n(x - w)} ${n(y)}Q${n(x)} ${n(y + w * 0.9)} ${n(x + w)} ${n(y)}`} />;
    case 'open': return <path d={`M${n(x - w)} ${n(y)}Q${n(x)} ${n(y + w * 1.7)} ${n(x + w)} ${n(y)}Z`} fill={INK} />;
    case 'flat': return <path d={`M${n(x - w * 0.6)} ${n(y + 0.5)}L${n(x + w * 0.6)} ${n(y + 0.5)}`} />;
    case 'o': return <ellipse cx={n(x)} cy={n(y + 1.8)} rx={1.8} ry={2.2} fill={PAPER} />;
    case 'tongue': return (
      <g>
        <path d={`M${n(x - 2.1)} ${n(y + 0.5)}L${n(x - 2.3)} ${n(y + tongue)}Q${n(x)} ${n(y + tongue + 3)} ${n(x + 2.3)} ${n(y + tongue)}L${n(x + 2.1)} ${n(y + 0.5)}`} fill={PAPER} />
        <path d={ww} />
      </g>
    );
    default: return null;
  }
}

/** Little four-point sparkles in free corners. */
function sparkles(r: R, spots: P[], count: number): ReactNode {
  const left = [...spots];
  return Array.from({ length: Math.min(count, left.length) }, (_, i) => {
    const [x, y] = left.splice(Math.floor(r() * left.length), 1)[0]!;
    const s = between(r, 2.2, 3.6);
    return chance(r, 0.7)
      ? <path key={`s${i}`} d={`M${n(x)} ${n(y - s)}Q${n(x)} ${n(y)} ${n(x + s)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y + s)}Q${n(x)} ${n(y)} ${n(x - s)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y - s)}Z`} fill={INK} strokeWidth={1} />
      : <path key={`s${i}`} d={`M${n(x - s * 0.7)} ${n(y)}L${n(x + s * 0.7)} ${n(y)}M${n(x)} ${n(y - s * 0.7)}L${n(x)} ${n(y + s * 0.7)}`} strokeWidth={1.8} />;
  });
}

type Drawn = { node: ReactNode; spots: P[]; flip?: boolean };
type Pose = (r: R, W: number) => Drawn;
const CORNERS: P[] = [[8, 8], [56, 8], [8, 56], [56, 56]];

/* ─── dogs ───────────────────────────────────────────────────────────────── */

const DOG_EYES = [['dot', 4], ['shine', 2], ['dash', 1.5], ['happy', 1], ['closed', 1], ['wink', 0.8], ['big', 1], ['shades', 0.6]] as const;
const DOG_MOUTH = [['w', 3], ['smile', 2], ['tongue', 2.5], ['open', 1], ['none', 1.2]] as const;

function collar(r: R, cx: number, y: number, half: number): ReactNode {
  const tag = chance(r, 0.7);
  return (
    <g>
      <path d={curve(shake(r, [[cx - half, y - 1.8], [cx, y + 0.8], [cx + half, y - 1.8]], 0.4))} />
      {tag && <circle cx={n(cx)} cy={n(y + 3.2)} r={2.1} fill={PAPER} />}
    </g>
  );
}

/** A dog's head in profile, nose forward and one ear hanging at the back (doodle 01). */
const dogProfile: Pose = (r) => {
  const cx = 33.5 + jit(r, 1.5), cy = 33 + jit(r, 1.5);
  const rx = between(r, 15, 18.5), ry = between(r, 13.5, 16.5), sq = between(r, 2, 2.5);
  const snout = between(r, 0.08, 0.3), tipT = between(r, 0.44, 0.48);
  const head = ring(r, cx, cy, rx, ry, { sq, count: 14, bumps: [{ at: tipT, w: 0.05 + snout * 0.12, amt: snout }] });
  const [tx, ty] = spot(cx, cy, rx, ry, tipT, sq, 1 + snout);
  const nx = tx + 2.4, ny = ty;
  const ear = weighted(r, [['flop', 4], ['long', 2], ['perk', 1.6]] as const);
  const earFill = chance(r, 0.3) ? INK : PAPER;
  let back: ReactNode = null, front: ReactNode = null;
  if (ear === 'perk') {
    // a tall rounded ear leaning back, not a cat's point
    const h = between(r, 1.25, 1.45), lean = between(r, 0.55, 0.8);
    back = <path d={curve(shake(r, [[cx + rx * 0.12, cy - ry * 0.8], [cx + rx * (lean - 0.1), cy - ry * h], [cx + rx * (lean + 0.08), cy - ry * (h - 0.05)], [cx + rx * 0.72, cy - ry * 0.5]], 0.4), true)} fill={PAPER} />;
  } else {
    const L = ear === 'long' ? between(r, 0.6, 0.9) : between(r, 0.3, 0.6), out = between(r, 1.2, 1.32);
    front = flap(shake(r, [[cx + rx * 0.05, cy - ry * 0.97], [cx + rx * 0.62, cy - ry * 1.1], [cx + rx * out, cy - ry * 0.5],
      [cx + rx * (out + 0.02), cy + ry * L], [cx + rx * 0.84, cy + ry * (L - 0.1)], [cx + rx * 0.66, cy - ry * 0.35]], 0.7), earFill);
  }
  const farEar = chance(r, 0.35)
    ? <path d={curve(shake(r, [[cx - rx * 0.15, cy - ry * 1.0], [cx - rx * 0.72, cy - ry * 0.98], [cx - rx * 0.95, cy - ry * 0.66], [cx - rx * 0.62, cy - ry * 0.6]], 0.5))} />
    : null;
  const ek = weighted(r, [['dash', 3], ['dot', 3], ['one', 1.5], ['happy', 1], ['closed', 1], ['shine', 1.5], ['shades', 0.8]] as const);
  const ex = cx - rx * between(r, 0.12, 0.32), ey = cy - ry * between(r, 0.15, 0.35), gap = between(r, 2.4, 3.4);
  const at: P[] = ek === 'one' || ek === 'shades' ? [[ex, ey]] : [[ex - gap, ey], [ex + gap, ey]];
  const patch = ek !== 'shades' && chance(r, 0.18);
  const spots = chance(r, 0.2) ? Math.floor(between(r, 2, 4)) : 0;
  const mk = weighted(r, [['none', 3], ['smile', 3], ['tongue', 2]] as const);
  return {
    spots: CORNERS,
    node: (
      <>
        {back}
        {outline(head, chance(r, 0.35) ? Math.floor(between(r, 8, 10)) : -1)}
        {farEar}
        {Array.from({ length: spots }, (_, i) => <g key={i}>{blob(r, cx + rx * between(r, 0.1, 0.55), cy + ry * between(r, -0.1, 0.6), between(r, 2, 3.5), between(r, 1.8, 3))}</g>)}
        {patch && blob(r, ex, ey, 6.5, 5.2)}
        {eyes(ek === 'one' ? 'dot' : ek, at, 1, patch ? [PAPER, PAPER] : [])}
        {mk === 'tongue' && <path d={`M${n(nx + 3.6)} ${n(ny + 4.6)}L${n(nx + 3.4)} ${n(ny + 9)}Q${n(nx + 5.6)} ${n(ny + 11.6)} ${n(nx + 7.6)} ${n(ny + 8.6)}L${n(nx + 7.4)} ${n(ny + 5)}Z`} fill={PAPER} />}
        {mk !== 'none' && <path d={`M${n(nx + 1.5)} ${n(ny + 3.2)}Q${n(nx + 5)} ${n(ny + 6.6)} ${n(nx + 9.5)} ${n(ny + 4)}`} />}
        {blob(r, nx, ny, between(r, 3.4, 4.8), between(r, 2.8, 3.6))}
        {front}
        {chance(r, 0.25) && collar(r, cx + rx * 0.1, cy + ry * 1.04, rx * 0.5)}
      </>
    ),
  };
};

/** Shared dog face for the face-on poses. */
function dogFace(r: R, cx: number, ex: number, ey: number, ny: number, nose = 1) {
  const ek = weighted(r, DOG_EYES);
  const mk = weighted(r, DOG_MOUTH);
  const mark = weighted(r, [['none', 5], ['patch', 1.6], ['brows', 1.2], ['freckles', 1], ['spot', 1.2]] as const);
  const side = chance(r, 0.5) ? 1 : -1;
  const at: P[] = [[cx - ex, ey], [cx + ex, ey]];
  const patched = mark === 'patch' && ek !== 'shades';
  return (
    <>
      {mark === 'spot' && blob(r, cx + side * ex * 1.1, ey - between(r, 4, 6), between(r, 3, 4.5), between(r, 2.5, 3.5))}
      {patched && blob(r, cx + side * ex, ey, 5.2, 4.8)}
      {mark === 'brows' && <path d={`M${n(cx - ex - 2.5)} ${n(ey - 4.2)}L${n(cx - ex + 1.8)} ${n(ey - 5.4)}M${n(cx + ex + 2.5)} ${n(ey - 4.2)}L${n(cx + ex - 1.8)} ${n(ey - 5.4)}`} strokeWidth={2} />}
      {eyes(ek, at, 1, patched ? (side < 0 ? [PAPER, INK] : [INK, PAPER]) : [])}
      {mouth(mk, cx, ny + 2.6, between(r, 2.6, 3.8), between(r, 3.5, 6))}
      {blob(r, cx, ny, between(r, 3, 4.1) * nose, between(r, 2.3, 3) * nose)}
      {mark === 'freckles' && (
        <g fill={INK} stroke="none">
          {[-1, 1].flatMap((d) => [[5.5, 0], [7, 1.8], [5.3, 3]].map(([x, y], i) => <circle key={`${d}${i}`} cx={n(cx + d * x!)} cy={n(ny + y!)} r={0.75} />))}
        </g>
      )}
    </>
  );
}

/** Face-on, ears hanging (doodle 03). */
const dogFloppy: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), cy = 33 + jit(r, 1.5);
  const rx = between(r, 13, 16.5), ry = between(r, 11, 14), sq = between(r, 2.3, 3.4);
  const jowls = chance(r, 0.35) ? [{ at: 0.18, w: 0.05, amt: 0.07 }, { at: 0.32, w: 0.05, amt: 0.07 }] : [];
  const head = ring(r, cx, cy, rx, ry, { sq, count: 14, bumps: jowls });
  const ear = weighted(r, [['hang', 4], ['long', 2], ['flip', 1.5], ['button', 2]] as const);
  const inkEars = weighted(r, [[0, 6], [1, 2], [2, 2]] as const);
  const fillFor = (dir: number) => (inkEars === 2 || (inkEars === 1 && dir === 1) ? INK : PAPER);
  const hang = (dir: 1 | -1, L: number) => {
    const ew = between(r, 2, 5.5);
    return flap(shake(r, [[cx + dir * rx * 0.4, cy - ry * 1.0], [cx + dir * (rx + ew * 0.6), cy - ry * 0.98], [cx + dir * (rx + ew), cy - ry * 0.15],
      [cx + dir * (rx + ew * 0.45), cy + ry * L], [cx + dir * (rx - 2.4), cy + ry * (L - 0.12)], [cx + dir * (rx - 3.2), cy - ry * 0.3]], 0.6), fillFor(dir));
  };
  const button = (dir: 1 | -1) => <path d={sketch(r, [[cx + dir * rx * 0.25, cy - ry * 0.93], [cx + dir * rx * 0.95, cy - ry * 1.12], [cx + dir * rx * 0.9, cy - ry * 0.42], [cx + dir * rx * 0.62, cy - ry * 0.62]], 0.6, true)} fill={fillFor(dir)} />;
  let ears: ReactNode;
  if (ear === 'hang') ears = <>{hang(-1, between(r, 0, 0.5))}{hang(1, between(r, 0, 0.5))}</>;
  else if (ear === 'long') { const L = between(r, 0.7, 1.05); ears = <>{hang(-1, L)}{hang(1, L + jit(r, 0.08))}</>; }
  else if (ear === 'button') ears = <>{button(-1)}{button(1)}</>;
  else ears = <>{hang(-1, between(r, 0.1, 0.5))}<path d={curve(shake(r, [[cx + rx * 0.3, cy - ry * 0.95], [cx + rx * 0.65, cy - ry * 1.55], [cx + rx * 1.15, cy - ry * 1.5], [cx + rx * 1.05, cy - ry * 0.95], [cx + rx * 0.8, cy - ry * 0.7]], 0.5), true)} fill={chance(r, 0.5) ? INK : PAPER} /></>;
  const ey = cy - ry * between(r, 0, 0.22), ex = rx * between(r, 0.32, 0.46), ny = cy + ry * between(r, 0.22, 0.38);
  return {
    spots: [[7, 8], [57, 8], [7, 57], [57, 57]],
    node: (
      <>
        {outline(head)}
        {ears}
        {dogFace(r, cx, ex, ey, ny)}
        {chance(r, 0.25) && collar(r, cx, cy + ry + 2.2, rx * 0.55)}
        {W > 3.3 && chance(r, 0.3) && <path d={sketch(r, [[cx - 2, cy - ry - 1.5], [cx, cy - ry - 5], [cx + 2.5, cy - ry - 2]], 0.6)} />}
      </>
    ),
  };
};

/** The shaggy one: fur blocks round a square face, no outline at all (doodle 02). */
const dogShaggy: Pose = (r, W) => {
  const s = between(r, 15, 18), L = 32 - s + jit(r, 1), R = 32 + s + jit(r, 1), T = 32 - s + jit(r, 1), B = 32 + s + jit(r, 1);
  const jag = (a: P, b: P, inward: P, d: number, teeth: number) => {
    const pts: P[] = [a, b];
    const k = teeth * 2;
    for (let i = k; i >= 0; i--) {
      const t = i / k, dd = d * (i % 2 ? between(r, 0.3, 0.55) : between(r, 0.75, 1.2));
      pts.push([a[0] + (b[0] - a[0]) * t + inward[0] * dd + jit(r, 0.6), a[1] + (b[1] - a[1]) * t + inward[1] * dd + jit(r, 0.6)]);
    }
    return <path d={sketch(r, pts, 0.5, true)} fill={INK} strokeWidth={1.4} />;
  };
  const depth = between(r, 4, 7);
  const top = weighted(r, [['part', 3], ['mop', 2], ['bare', 1]] as const);
  const sideTop = T + between(r, 9, 13);
  const ey = T + between(r, 11.5, 14.5), ex = between(r, 5.5, 7.5), ny = T + between(r, 19.5, 22.5);
  const ek = weighted(r, [['dot', 5], ['shine', 2], ['closed', 1], ['happy', 1]] as const);
  const mk = weighted(r, [['flat', 3], ['tongue', 1.5], ['smile', 1.5], ['w', 1]] as const);
  return {
    spots: [[6, 6], [58, 6], [6, 60], [58, 60]],
    node: (
      <>
        {chance(r, 0.85) && (
          <g strokeWidth={n(W * 1.25)}>
            <path d={sketch(r, [[L + between(r, 5, 7), B - between(r, 3, 6)], [L + 9, B - 1], [30.5, B - 0.5]], 0.6)} />
            <path d={sketch(r, [[33.5, B - 0.5], [R - between(r, 5, 7), B - between(r, 2, 5)]], 0.6)} />
          </g>
        )}
        {jag([L, sideTop], [L + jit(r, 1), B - between(r, 0, 4)], [1, 0], between(r, 3, 6), 3)}
        {jag([R, sideTop + jit(r, 1.5)], [R + jit(r, 1), B - between(r, 0, 4)], [-1, 0], between(r, 3, 6), 3)}
        {top === 'part' && <>{jag([L, T], [30, T + jit(r, 1)], [0, 1], depth, 2)}{jag([34.5, T + jit(r, 1)], [R, T], [0, 1], depth, 2)}{blob(r, 32.2, T + 1.2, 1.6, 2.6)}</>}
        {top === 'mop' && jag([L, T], [R, T + jit(r, 1)], [0, 1], depth + 2, 4)}
        {top === 'bare' && <path d={sketch(r, [[L + 1, T + 7], [32, T], [R - 1, T + 7]], 1)} />}
        {eyes(ek, [[32 - ex, ey], [32 + ex, ey]], 1.15)}
        {mouth(mk, 32, ny + 4.8, 3.2, 4.5)}
        {blob(r, 32, ny, between(r, 4, 5.2), between(r, 3, 3.8))}
      </>
    ),
  };
};

/** Standing up, long ears, big eyes or shades, little legs and a tail (doodle 04). */
const dogStanding: Pose = (r, W) => {
  const cx = 32 + jit(r, 1.2), top = between(r, 8, 11), hw = between(r, 7.5, 9.5), foot = between(r, 55, 58);
  const earL = between(r, 16, 23), earOut = between(r, 5.5, 9);
  const earFill = chance(r, 0.2) ? INK : PAPER;
  const ear = (dir: 1 | -1) => flap(shake(r, [[cx + dir * hw * 0.55, top + 0.5], [cx + dir * (hw + earOut * 0.7), top + 3], [cx + dir * (hw + earOut), top + earL * 0.55],
    [cx + dir * (hw + earOut * 0.75), top + earL], [cx + dir * (hw + 1.5), top + earL + 0.5], [cx + dir * (hw - 0.5), top + earL - 4]], 0.6), earFill);
  const ey = top + between(r, 10, 13), ex = hw * 0.45;
  const ek = weighted(r, [['shades', 3], ['big', 2.5], ['dot', 2], ['shine', 1.5], ['happy', 1]] as const);
  const mk = weighted(r, [['open', 3], ['tongue', 1.5], ['smile', 1.5], ['w', 1]] as const);
  const chest = weighted(r, [['paws', 2], ['collar', 1.5], ['none', 2], ['bow', 0.8]] as const);
  const py = ey + between(r, 13, 17);
  return {
    spots: [[7, 8], [57, 8], [8, 42], [56, 30]],
    node: (
      <>
        <path d={`M${n(cx - hw)} ${n(top + 2)}L${n(cx + hw)} ${n(top + 2)}L${n(cx + hw)} ${n(foot)}L${n(cx - hw)} ${n(foot)}Z`} fill={PAPER} stroke="none" />
        <path d={curve(shake(r, [[cx + hw, foot - 6], [cx + hw + 3, foot - 8.5], [cx + hw + 4.5, foot - 12.5]], 0.6))} />
        {chance(r, 0.4) && <path d={`M${n(cx + hw + 7.5)} ${n(foot - 14)}q1.6 1.6 0.6 3.6M${n(cx + hw + 7.6)} ${n(foot - 8.6)}q1.6 0.4 2.4 -0.8`} strokeWidth={1.6} />}
        <path d={sketch(r, [[cx - hw, top + between(r, 9, 12)], [cx - hw - 0.5 + jit(r, 0.6), foot - 2]], 0.6)} />
        <path d={sketch(r, [[cx + hw, top + between(r, 11, 14)], [cx + hw + jit(r, 0.6), foot - 2]], 0.6)} />
        <path d={`M${n(cx - hw)} ${n(foot - 2)}C${n(cx - hw)} ${n(foot + 2.5)} ${n(cx - 1.5)} ${n(foot + 2.5)} ${n(cx - 1)} ${n(foot - 1)}Q${n(cx)} ${n(foot - 3)} ${n(cx + 1)} ${n(foot - 1)}C${n(cx + 1.5)} ${n(foot + 2.5)} ${n(cx + hw)} ${n(foot + 2.5)} ${n(cx + hw)} ${n(foot - 2)}`} />
        <path d={curve(shake(r, [[cx - hw * 0.45, top + 0.3], [cx, top - 0.8], [cx + hw * 0.45, top + 0.3]], 0.4))} />
        {ear(-1)}{ear(1)}
        {eyes(ek, [[cx - ex, ey], [cx + ex, ey]], 0.95)}
        {mouth(mk, cx, ey + between(r, 5.5, 7), hw * 0.5, 4)}
        {chest === 'paws' && <path d={`M${n(cx - 1.2)} ${n(py)}q0.2 3.4 -2.2 3.4q-1.8 0 -1.8 -1.6M${n(cx + 1.2)} ${n(py)}q-0.2 3.4 2.2 3.4q1.8 0 1.8 -1.6`} strokeWidth={n(W * 0.8)} />}
        {chest === 'collar' && collar(r, cx, ey + 12, hw)}
        {chest === 'bow' && <path d={`M${n(cx)} ${n(ey + 11)}L${n(cx - 4)} ${n(ey + 8.6)}L${n(cx - 4)} ${n(ey + 13.4)}ZM${n(cx)} ${n(ey + 11)}L${n(cx + 4)} ${n(ey + 8.6)}L${n(cx + 4)} ${n(ey + 13.4)}Z`} fill={INK} strokeWidth={1.4} />}
      </>
    ),
  };
};

/** Face-on with pointed ears up: a shiba, a husky, a terrier. */
const dogPointy: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), cy = 35 + jit(r, 1.5), rx = between(r, 13.5, 16.5), ry = between(r, 11.5, 14.5), sq = between(r, 2, 2.6);
  const fluff = chance(r, 0.35);
  const head = ring(r, cx, cy, rx, ry, { sq, count: 14, bumps: fluff ? [{ at: 0.08, w: 0.035, amt: 0.12 }, { at: 0.42, w: 0.035, amt: 0.12 }] : [] });
  const tipX = between(r, 0.5, 0.95), tipY = between(r, 1.5, 1.95), earW = between(r, 0.75, 1.0);
  const inkEar = weighted(r, [[0, 6], [1, 2], [2, 1.5]] as const);
  const inner = inkEar === 0 && chance(r, 0.45);
  const ear = (dir: 1 | -1) => {
    const tip: P = [cx + dir * rx * tipX + jit(r, 1), cy - ry * tipY];
    const ink = inkEar === 2 || (inkEar === 1 && dir === -1);
    return (
      <g>
        <path d={sketch(r, [[cx + dir * rx * 0.12, cy - ry * 0.7], tip, [cx + dir * rx * earW, cy - ry * 0.25]], 0.8, true)} fill={ink ? INK : PAPER} />
        {inner && <path d={sketch(r, [[cx + dir * rx * 0.35, cy - ry * 1.02], [tip[0] * 0.7 + (cx + dir * rx * 0.55) * 0.3, tip[1] * 0.7 + (cy - ry) * 0.3], [cx + dir * rx * 0.72, cy - ry * 0.85]], 0.4)} strokeWidth={n(W * 0.7)} />}
      </g>
    );
  };
  const muzzle = chance(r, 0.4);
  const my = cy + ry * 0.45, mrx = between(r, 5.5, 7.5), mry = between(r, 4, 5.2);
  const ny = muzzle ? my - mry * 0.35 : cy + ry * between(r, 0.2, 0.35);
  return {
    spots: [[7, 22], [57, 22], [7, 57], [57, 57]],
    node: (
      <>
        {ear(-1)}{ear(1)}
        {outline(head)}
        {chance(r, 0.25) && <path d={curve(shake(r, [[cx - rx * 0.95, cy + ry * 0.1], [cx - rx * 0.45, cy - ry * 0.55], [cx, cy - ry * 0.2], [cx + rx * 0.45, cy - ry * 0.55], [cx + rx * 0.95, cy + ry * 0.1]], 0.5))} strokeWidth={n(W * 0.8)} />}
        {muzzle && <path d={curve(ring(r, cx, my, mrx, mry, { noise: 0.05, count: 8 }), true)} fill={PAPER} strokeWidth={n(W * 0.85)} />}
        {dogFace(r, cx, rx * between(r, 0.34, 0.46), cy - ry * between(r, 0, 0.18), ny, 0.95)}
        {chance(r, 0.2) && collar(r, cx, cy + ry + 2.2, rx * 0.55)}
      </>
    ),
  };
};

/** A long dog side-on: body, four stick legs, tail up, head with a snout (a sausage dog, a hound). */
const dogLong: Pose = (r) => {
  const bcx = 37 + jit(r, 1.5), bcy = 40 + jit(r, 1.5), brx = between(r, 14, 18), bry = between(r, 6.5, 8.5);
  const legL = between(r, 4, 8);
  const body = ring(r, bcx, bcy, brx, bry, { sq: between(r, 2.4, 3.2), count: 12 });
  const hrx = between(r, 7.5, 9.5), hry = between(r, 6.8, 8.5), hcx = bcx - brx + between(r, 2, 4), hcy = bcy - bry - between(r, 3, 6);
  const snout = between(r, 0.3, 0.6);
  const head = ring(r, hcx, hcy, hrx, hry, { count: 11, bumps: [{ at: 0.47, w: 0.07, amt: snout }] });
  const [tx, ty] = spot(hcx, hcy, hrx, hry, 0.47, 2, 1 + snout);
  const legs = [bcx - brx + 4, bcx - brx + 8, bcx + brx - 8, bcx + brx - 4].map((x) => x + jit(r, 1));
  const ek = weighted(r, [['dot', 4], ['shine', 2], ['closed', 1.5], ['happy', 1]] as const);
  const spotsOnBody = chance(r, 0.3) ? Math.floor(between(r, 1, 4)) : 0;
  const earFill = chance(r, 0.35) ? INK : PAPER;
  const tailUp = chance(r, 0.6);
  return {
    spots: [[56, 10], [44, 8], [8, 56], [30, 12]],
    node: (
      <>
        <path d={curve(shake(r, tailUp
          ? [[bcx + brx - 2, bcy - 2], [bcx + brx + 4, bcy - 7], [bcx + brx + 5, bcy - 14]]
          : [[bcx + brx - 2, bcy], [bcx + brx + 5, bcy + 1], [bcx + brx + 9, bcy - 2]], 0.6))} />
        {legs.map((x, i) => <path key={i} d={`M${n(x)} ${n(bcy + bry - 2)}L${n(x + jit(r, 0.8))} ${n(bcy + bry + legL)}l-1.8 0.2`} />)}
        {outline(body)}
        {Array.from({ length: spotsOnBody }, (_, i) => <g key={i}>{blob(r, bcx + between(r, -brx * 0.4, brx * 0.6), bcy + between(r, -bry * 0.5, bry * 0.2), between(r, 2, 3.4), between(r, 1.6, 2.6))}</g>)}
        {chance(r, 0.3) && <path d={curve([[hcx + hrx * 0.1, hcy + hry * 0.85], [hcx + hrx * 0.6, hcy + hry * 1.05], [hcx + hrx * 1.0, hcy + hry * 0.6]])} strokeWidth={4} />}
        {outline(head)}
        {flap(shake(r, [[hcx + 1, hcy - hry * 0.95], [hcx + hrx * 0.8, hcy - hry * 0.9], [hcx + hrx * 1.05, hcy + hry * 0.6], [hcx + hrx * 0.6, hcy + hry * 0.55], [hcx + hrx * 0.4, hcy - hry * 0.2]], 0.5), earFill)}
        {eyes(ek, [[hcx - hrx * 0.3, hcy - hry * 0.3]], 0.9)}
        {blob(r, tx + 2, ty, between(r, 2.6, 3.4), between(r, 2.2, 2.8))}
        {chance(r, 0.4) && <path d={`M${n(tx + 3)} ${n(ty + 3)}q3 2.4 6 0.6`} />}
      </>
    ),
  };
};

const DOGS: readonly (readonly [Pose, number])[] = [[dogProfile, 2], [dogFloppy, 2], [dogShaggy, 1.1], [dogStanding, 1.5], [dogPointy, 1.8], [dogLong, 1.3]];

/* ─── cats ───────────────────────────────────────────────────────────────── */

const CAT_EYES = [['dot', 4], ['slant', 1.5], ['shine', 2], ['happy', 1], ['closed', 1.3], ['wink', 0.7], ['big', 1], ['flat', 0.8]] as const;

function whiskers(r: R, cx: number, y: number, inner: number, outer: number, count: number, W: number): ReactNode {
  return (
    <g strokeWidth={n(W * 0.6)}>
      {[-1, 1].flatMap((d) => Array.from({ length: count }, (_, i) => {
        const yy = y + (i - (count - 1) / 2) * 2.6;
        return <path key={`${d}${i}`} d={`M${n(cx + d * inner)} ${n(yy)}L${n(cx + d * outer)} ${n(yy + (i - (count - 1) / 2) * 1.6 + jit(r, 0.6))}`} />;
      }))}
    </g>
  );
}

/** Ears up, no chin, slanted eyes, a long tongue and a burst on each side (doodle 05). */
const catExcited: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), cy = 33 + jit(r, 1.5), rx = between(r, 12, 14.5), ry = between(r, 10, 12);
  const lt: P = [cx - rx * between(r, 0.7, 0.95), cy - ry * between(r, 1.55, 2.0)];
  const rt: P = [cx + rx * between(r, 0.7, 0.95), cy - ry * between(r, 1.55, 2.0)];
  const head: P[] = [[cx - rx * 0.78, cy + ry * 0.45], [cx - rx * 0.98, cy + ry * 0.1], [cx - rx * 1.0, cy - ry * 0.5], lt,
    [cx - rx * 0.3, cy - ry * 0.8], [cx + rx * 0.3, cy - ry * 0.9], rt, [cx + rx * 1.0, cy - ry * 0.45], [cx + rx * 0.97, cy + ry * 0.05]];
  const ek = weighted(r, [['slant', 3], ['dot', 2], ['dash', 1.5], ['shine', 1.5], ['happy', 1]] as const);
  const tongue = chance(r, 0.6), tl = between(r, 6, 12);
  const burst = (dir: 1 | -1) => {
    const x0 = cx + dir * (rx + 4);
    return <path d={sketch(r, shake(r, [[x0, cy - 3], [x0 + dir * 8, cy - 3], [x0 + dir * 3, cy + 2], [x0 + dir * 6, cy + 10], [x0 + dir * 1, cy + 6], [x0 + dir * 0.5, cy + 9]], 0.8), 0.5)} />;
  };
  const my = cy + ry * 0.35, mw = rx * between(r, 0.32, 0.42);
  return {
    spots: [[8, 10], [56, 10], [10, 56], [54, 56]],
    node: (
      <>
        <path d={sketch(r, shake(r, head, 0.6), 0.9)} />
        {chance(r, 0.55) && <>{burst(-1)}{burst(1)}</>}
        {chance(r, 0.3) && <path d={`M${n(cx - 3)} ${n(cy - ry * 0.75)}l0.4 3.2M${n(cx)} ${n(cy - ry * 0.82)}l0 3.4M${n(cx + 3)} ${n(cy - ry * 0.85)}l-0.4 3.2`} strokeWidth={n(W * 0.75)} />}
        {eyes(ek, [[cx - rx * 0.38, cy - ry * 0.1], [cx + rx * 0.38, cy - ry * 0.1]], 1.05)}
        {tongue && <path d={`M${n(cx - 2.6)} ${n(my + 0.5)}L${n(cx - 2.8)} ${n(my + tl)}Q${n(cx)} ${n(my + tl + 4.5)} ${n(cx + 2.8)} ${n(my + tl)}L${n(cx + 2.6)} ${n(my + 0.5)}`} fill={PAPER} />}
        <path d={`M${n(cx - mw)} ${n(my - 0.6)}Q${n(cx - mw / 2)} ${n(my + mw * 0.7)} ${n(cx)} ${n(my - 1)}Q${n(cx + mw / 2)} ${n(my + mw * 0.7)} ${n(cx + mw)} ${n(my - 0.6)}`} />
      </>
    ),
  };
};

/** Fluffy sides running into the body, a flat face, holding a fish or a ball of wool (doodle 06). */
const catFluffy: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), top = between(r, 14, 18), hw = between(r, 10.5, 13), fluff = between(r, 3, 6.5);
  const ear = (dir: 1 | -1) => <path d={sketch(r, [[cx + dir * (hw + 2), top + 5], [cx + dir * (hw + jit(r, 1.5)), top - between(r, 8, 12)], [cx + dir * hw * 0.45, top - 0.5]], 0.8)} />;
  const side = (dir: 1 | -1) => {
    const x = cx + dir * (hw + 2);
    return (
      <>
        <path d={sketch(r, [[x, top + 6], [x + dir * fluff, top + 9], [x - dir * 0.5, top + 11], [x + dir * fluff * 0.9, top + 17], [x - dir * 0.5, top + 19]], 0.5)} />
        <path d={sketch(r, [[x + dir * 0.5, top + 23], [x + dir * fluff * 0.7, top + 28], [x + dir * 0.3, top + 30], [x + dir * 1.5, top + 41]], 0.5)} />
      </>
    );
  };
  const item = weighted(r, [['fish', 3], ['wool', 1.5], ['none', 1.5]] as const);
  const ek = weighted(r, [['dot', 4.5], ['shine', 1.5], ['closed', 1.5], ['happy', 1], ['flat', 1.2]] as const);
  const mk = weighted(r, [['flat', 4], ['w', 3], ['o', 1], ['smile', 1]] as const);
  const ey = top + between(r, 9, 12), fx = cx + jit(r, 1.5), y0 = top + 18, y1 = top + between(r, 33, 37);
  const paw = (dir: 1 | -1, y: number) => <path d={curve([[cx + dir * hw * 0.95, y + 1], [cx + dir * 4, y - 2.2], [cx - dir * 1.6, y + 0.6], [cx + dir * 1.2, y + 3.4], [cx + dir * hw * 0.75, y + 4.5]], true)} fill={PAPER} />;
  return {
    spots: [[8, 8], [56, 8], [8, 58], [56, 58]],
    node: (
      <>
        {ear(-1)}{ear(1)}
        <path d={sketch(r, [[cx - hw * 0.4, top + jit(r, 0.8)], [cx + hw * 0.4, top + jit(r, 0.8)]], 0.6)} />
        {side(-1)}{side(1)}
        {eyes(ek, [[cx - hw * 0.68, ey], [cx + hw * 0.68, ey]], 1.05)}
        {mouth(mk, cx, ey + 0.5, 3.2)}
        {item === 'fish' && (
          <>
            <path d={curve([[fx, y0], [fx + 4, y0 + 5], [fx + 3, y1 - 5], [fx, y1 - 3], [fx - 3, y1 - 5], [fx - 4, y0 + 5]], true)} fill={PAPER} />
            <path d={sketch(r, [[fx - 0.6, y1 - 3.4], [fx - 4, y1 + 1.5], [fx, y1 - 0.4], [fx + 4, y1 + 1.5], [fx + 0.6, y1 - 3.4]], 0.3, true)} fill={PAPER} />
            <path d={`M${n(fx)} ${n(y0 + 3)}l2 2M${n(fx + 2)} ${n(y0 + 3)}l-2 2`} strokeWidth={1.3} />
            {paw(-1, y0 + 9)}{paw(1, y0 + 11.5)}
          </>
        )}
        {item === 'wool' && (
          <>
            <circle cx={n(fx)} cy={n(y0 + 9)} r={6.5} fill={PAPER} />
            <path d={`M${n(fx - 5)} ${n(y0 + 6)}q5 3 9 -1M${n(fx - 5.5)} ${n(y0 + 10)}q6 3 11 -1M${n(fx - 2)} ${n(y0 + 3)}q3 6 1 12M${n(fx + 4)} ${n(y0 + 14)}q2 4 7 3`} strokeWidth={n(W * 0.6)} />
            {paw(-1, y0 + 12)}
          </>
        )}
      </>
    ),
  };
};

/** Peeking over the edge: flat head, almond eyes, = whiskers, ( ) for a body (doodle 07). */
const catPeek: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), ty = between(r, 19, 24), hw = between(r, 13, 15.5), eh = between(r, 4, 6.5);
  const head: P[] = [[cx - hw, ty + 5], [cx - hw * 0.85, ty - eh], [cx - hw * 0.55, ty], [cx + hw * 0.55, ty + jit(r, 0.6)], [cx + hw * 0.85, ty - eh + jit(r, 1)], [cx + hw, ty + 5]];
  const ey = ty + between(r, 8.5, 11), ex = hw * between(r, 0.45, 0.55);
  const kind = weighted(r, [['slit', 2], ['side', 2], ['lid', 1.5], ['dot', 1.5], ['round', 1.2]] as const);
  const look = chance(r, 0.5) ? 1 : -1;
  const eye = (x: number) => {
    if (kind === 'round') return <><circle cx={n(x)} cy={n(ey)} r={3.6} fill={PAPER} /><circle cx={n(x + look * 0.8)} cy={n(ey)} r={1.5} fill={INK} stroke="none" /></>;
    const lens = `M${n(x - 4.6)} ${n(ey)}Q${n(x)} ${n(ey - 4.2)} ${n(x + 4.6)} ${n(ey)}Q${n(x)} ${n(ey + 4.2)} ${n(x - 4.6)} ${n(ey)}Z`;
    return (
      <>
        <path d={lens} fill={PAPER} strokeWidth={n(W * 0.85)} />
        {kind === 'slit' && <ellipse cx={n(x)} cy={n(ey)} rx={0.9} ry={2} fill={INK} stroke="none" />}
        {kind === 'side' && <ellipse cx={n(x + look * 1.8)} cy={n(ey)} rx={1.1} ry={1.9} fill={INK} stroke="none" />}
        {kind === 'dot' && <circle cx={n(x)} cy={n(ey)} r={1.5} fill={INK} stroke="none" />}
        {kind === 'lid' && <path d={`M${n(x - 4.4)} ${n(ey)}Q${n(x)} ${n(ey - 4)} ${n(x + 4.4)} ${n(ey)}Z`} fill={INK} strokeWidth={1} />}
      </>
    );
  };
  const body = chance(r, 0.85);
  return {
    spots: [[8, 8], [56, 8], [32, 58], [8, 58]],
    node: (
      <>
        <path d={sketch(r, shake(r, head, 0.5), 0.5)} />
        {chance(r, 0.3) && <path d={`M${n(cx - 3)} ${n(ty + 2)}l0 3M${n(cx)} ${n(ty + 2)}l0 3.4M${n(cx + 3)} ${n(ty + 2)}l0 3`} strokeWidth={n(W * 0.75)} />}
        {eye(cx - ex)}{eye(cx + ex)}
        <circle cx={n(cx)} cy={n(ey + 0.6)} r={1.1} fill={INK} stroke="none" />
        {chance(r, 0.35) && mouth('w', cx, ey + 4.2, 2.2)}
        {chance(r, 0.85) && (
          <g strokeWidth={n(W * 0.8)}>
            {[-1, 1].map((d) => <path key={d} d={`M${n(cx + d * (hw + 2))} ${n(ey - 1.3)}l${d * 3.5} 0M${n(cx + d * (hw + 2))} ${n(ey + 1.3)}l${d * 3.5} 0`} />)}
          </g>
        )}
        {body && [-1, 1].map((d) => <path key={d} d={curve(shake(r, [[cx + d * (hw - 1), ey + 7], [cx + d * (hw + 1.2), ey + 16], [cx + d * (hw - 0.5), ey + between(r, 23, 27)]], 0.5))} />)}
      </>
    ),
  };
};

/** Round ears, stripes on the forehead, whiskers out the sides, mouth open, a paw up (doodle 08). */
const catSilly: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), ty = between(r, 18, 22), hw = between(r, 14, 16.5), eh = between(r, 3.5, 6);
  const head: P[] = [[cx - hw, ty + 9], [cx - hw * 0.85, ty + 1], [cx - hw * 0.6, ty - eh], [cx - hw * 0.3, ty + 1.5], [cx + hw * 0.28, ty + 1], [cx + hw * 0.58, ty - eh - 0.5], [cx + hw * 0.86, ty], [cx + hw * 0.96, ty + 7]];
  const stripes = weighted(r, [[2, 3], [3, 1.5], [0, 1.5]] as const);
  const ey = ty + between(r, 11, 13.5), ex = hw * 0.55;
  const ek = weighted(r, [['dot', 4], ['shine', 1.5], ['happy', 1], ['closed', 1]] as const);
  const mk = weighted(r, [['tongue', 3], ['w', 2], ['open', 1]] as const);
  const paw = chance(r, 0.65);
  const py = ey + between(r, 6, 8);
  return {
    spots: [[8, 8], [56, 8], [8, 58], [32, 6]],
    node: (
      <>
        <path d={curve(shake(r, head, 0.4))} />
        {Array.from({ length: stripes }, (_, i) => {
          const x = cx + (i - (stripes - 1) / 2) * 3.6;
          return <path key={i} d={`M${n(x)} ${n(ty + 3)}L${n(x + jit(r, 0.4))} ${n(ty + 7.5)}`} />;
        })}
        {whiskers(r, cx, ey + 1, hw + 1, hw + 6, 2, W * 1.4)}
        {eyes(ek, [[cx - ex, ey], [cx + ex, ey]])}
        {mouth(mk, cx, ey + 1.2, 3, between(r, 5, 8))}
        {paw && [-1, 1].map((d) => <path key={d} d={curve(shake(r, [[cx + d * (hw - 1.5), py], [cx + d * (hw + 0.5), py + 7], [cx + d * (hw - 1), 60]], 0.5))} />)}
      </>
    ),
  };
};

function catEars(r: R, cx: number, cy: number, rx: number, ry: number, fold: boolean, inkSide: number, W: number) {
  const tipX = between(r, 0.55, 0.9), tipY = fold ? between(r, 1.1, 1.25) : between(r, 1.4, 1.8);
  const inner = inkSide === 0 && chance(r, 0.4);
  return [-1, 1].map((dir) => {
    const tip: P = [cx + dir * rx * (fold ? tipX + 0.15 : tipX) + jit(r, 1), cy - ry * tipY];
    const ink = inkSide === 2 || inkSide === dir;
    return (
      <g key={dir}>
        <path d={sketch(r, [[cx + dir * rx * 0.1, cy - ry * 0.8], tip, [cx + dir * rx * 0.95, cy - ry * 0.35]], 0.7, true)} fill={ink ? INK : PAPER} />
        {inner && !fold && <path d={`M${n(cx + dir * rx * 0.4)} ${n(cy - ry * 1.02)}L${n(tip[0] * 0.65 + (cx + dir * rx * 0.55) * 0.35)} ${n(tip[1] * 0.65 + (cy - ry) * 0.35)}`} strokeWidth={n(W * 0.65)} />}
      </g>
    );
  });
}

/** Shared cat face: eyes, a small nose, ω mouth, whiskers through the cheeks. */
function catFace(r: R, cx: number, cy: number, rx: number, ry: number, W: number) {
  const ek = weighted(r, CAT_EYES);
  const ex = rx * between(r, 0.36, 0.48), ey = cy - ry * between(r, 0.05, 0.2);
  const ny = cy + ry * between(r, 0.15, 0.28);
  const mk = weighted(r, [['w', 5], ['tongue', 1.3], ['o', 0.8], ['none', 0.6]] as const);
  const wc = weighted(r, [[2, 3], [3, 2], [0, 1]] as const);
  return (
    <>
      {ek === 'dot' && chance(r, 0.25)
          ? <g fill={INK} stroke="none">{[-1, 1].map((d) => <ellipse key={d} cx={n(cx + d * ex)} cy={n(ey)} rx={3} ry={1.9} />)}</g>
          : eyes(ek, [[cx - ex, ey], [cx + ex, ey]])}
      <path d={`M${n(cx - 2.2)} ${n(ny - 1)}L${n(cx + 2.2)} ${n(ny - 1)}L${n(cx)} ${n(ny + 1.2)}Z`} fill={INK} strokeWidth={1.4} />
      {mouth(mk, cx, ny + 2.2, 2.7, 4)}
      {wc > 0 && whiskers(r, cx, ny + 1, rx * 0.55, rx + between(r, 4, 7), wc, W)}
    </>
  );
}

/** A round cat head face-on, triangle (or folded) ears, whiskers. */
const catRound: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), cy = 35 + jit(r, 1.5), rx = between(r, 13.5, 17), ry = between(r, 11.5, 14), sq = between(r, 2, 2.4);
  const fluffy = chance(r, 0.3);
  const head = ring(r, cx, cy, rx, ry, { sq, count: 14, bumps: fluffy ? [{ at: 0.06, w: 0.035, amt: 0.12 }, { at: 0.44, w: 0.035, amt: 0.12 }, { at: 0.14, w: 0.03, amt: 0.08 }, { at: 0.36, w: 0.03, amt: 0.08 }] : [] });
  const fold = chance(r, 0.15);
  const ink = weighted(r, [[0, 6], [-1, 1], [1, 1], [2, 1.5]] as const);
  const mark = weighted(r, [['none', 4], ['stripes', 1.6], ['patch', 1.2], ['bow', 0.8], ['bell', 0.8]] as const);
  const side = chance(r, 0.5) ? 1 : -1;
  return {
    spots: [[7, 22], [57, 22], [7, 57], [57, 57]],
    node: (
      <>
        {catEars(r, cx, cy, rx, ry, fold, ink, W)}
        {outline(head)}
        {mark === 'patch' && blob(r, cx + side * rx * 0.55, cy - ry * 0.45, rx * 0.35, ry * 0.32)}
        {mark === 'stripes' && <path d={`M${n(cx - 3.4)} ${n(cy - ry + 1.5)}l0.3 3.4M${n(cx)} ${n(cy - ry + 1)}l0 4M${n(cx + 3.4)} ${n(cy - ry + 1.5)}l-0.3 3.4`} strokeWidth={n(W * 0.8)} />}
        {catFace(r, cx, cy, rx, ry, W)}
        {mark === 'bow' && <path d={`M${n(cx + side * rx * 0.55)} ${n(cy - ry * 0.95)}l${side * -4} -3l0 6zM${n(cx + side * rx * 0.55)} ${n(cy - ry * 0.95)}l${side * 4} -3l0 6z`} fill={INK} strokeWidth={1.4} />}
        {mark === 'bell' && <><path d={curve([[cx - rx * 0.5, cy + ry * 0.92], [cx, cy + ry + 2], [cx + rx * 0.5, cy + ry * 0.92]])} /><circle cx={n(cx)} cy={n(cy + ry + 4.4)} r={2.4} fill={PAPER} /></>}
      </>
    ),
  };
};

/** Sitting up: small head on a pear body, front legs, the tail curled round. */
const catSitting: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), hcy = between(r, 19, 22), hrx = between(r, 10.5, 12.5), hry = between(r, 8.5, 10);
  const brx = between(r, 11, 13.5), bcy = 45, bry = 13;
  const body = ring(r, cx, bcy, brx, bry, { count: 12, bumps: [{ at: 0.25, w: 0.12, amt: 0.05 }] });
  const head = ring(r, cx, hcy, hrx, hry, { count: 12 });
  const tail = chance(r, 0.5)
    ? [[cx + brx * 0.7, 56], [cx + brx + 5, 53], [cx + brx + 6.5, 44], [cx + brx + 3, 37]] as P[]
    : [[cx + brx * 0.6, 57], [cx + brx + 2, 58.5], [cx + brx + 6, 56], [cx + brx + 5.5, 52]] as P[];
  const mark = weighted(r, [['none', 3], ['stripes', 1.5], ['bib', 1.2], ['patch', 1]] as const);
  return {
    spots: [[8, 8], [56, 8], [8, 40], [56, 30]],
    node: (
      <>
        <path d={curve(shake(r, tail, 0.6))} strokeWidth={n(W * 1.15)} />
        {outline(body)}
        {mark === 'stripes' && <path d={`M${n(cx - brx * 0.95)} ${n(bcy - 2)}q4 1 5 3M${n(cx - brx * 0.98)} ${n(bcy + 3)}q4 1 5 3M${n(cx + brx * 0.95)} ${n(bcy - 2)}q-4 1 -5 3M${n(cx + brx * 0.98)} ${n(bcy + 3)}q-4 1 -5 3`} strokeWidth={n(W * 0.75)} />}
        {mark === 'bib' && <path d={`M${n(cx - 5)} ${n(bcy - 8)}Q${n(cx)} ${n(bcy - 1)} ${n(cx + 5)} ${n(bcy - 8)}`} strokeWidth={n(W * 0.8)} />}
        {mark === 'patch' && blob(r, cx + brx * 0.45, bcy + 2, 4, 3.5)}
        <path d={`M${n(cx - 3)} ${n(bcy + 3)}L${n(cx - 3.4)} ${n(57)}M${n(cx + 3)} ${n(bcy + 3)}L${n(cx + 3.4)} ${n(57)}`} strokeWidth={n(W * 0.85)} />
        <path d={`M${n(cx - 7)} 58q2 -2.6 3.6 -0.4M${n(cx + 3.4)} 57.6q2 -2.6 3.6 0.4`} strokeWidth={n(W * 0.85)} />
        {catEars(r, cx, hcy, hrx, hry, false, chance(r, 0.2) ? 2 : 0, W)}
        {outline(head)}
        {catFace(r, cx, hcy, hrx, hry, W * 0.9)}
      </>
    ),
  };
};

const CATS: readonly (readonly [Pose, number])[] = [[catExcited, 1.5], [catFluffy, 1.6], [catPeek, 1.5], [catSilly, 1.3], [catRound, 2.4], [catSitting, 1.5]];

/* ─── birds ──────────────────────────────────────────────────────────────── */

const BIRD_EYE = [['dot', 5], ['shine', 2], ['closed', 1.2], ['happy', 1]] as const;

/** Beak on the left edge at (bx, by); birds face left and get mirrored half the time. */
function beak(r: R, kind: 'tiny' | 'cone' | 'bill', bx: number, by: number, s: number): ReactNode {
  if (kind === 'tiny') return <path d={sketch(r, [[bx + 2.5, by - 3 * s], [bx - 2.4 * s, by + 0.2], [bx + 2.8, by + 2.6 * s]], 0.4)} />;
  if (kind === 'cone') return <path d={sketch(r, [[bx + 1.5, by - 3 * s], [bx - 5.5 * s, by + 0.4], [bx + 1.5, by + 3 * s]], 0.5, true)} fill={PAPER} />;
  return (
    <>
      <path d={curve([[bx + 1.5, by - 2.8 * s], [bx - 4 * s, by - 3.2 * s], [bx - 7.5 * s, by - 1], [bx - 7 * s, by + 2.2 * s], [bx - 2 * s, by + 2.8 * s], [bx + 1.5, by + 2.4 * s]], true)} fill={PAPER} />
      <path d={`M${n(bx - 6 * s)} ${n(by + 0.4)}L${n(bx)} ${n(by + 0.2)}`} strokeWidth={1.4} />
    </>
  );
}

function crest(r: R, x: number, y: number, kind: number): ReactNode {
  if (kind === 0) return null;
  const tufts: P[][] = [[[x - 1.5, y], [x - 4, y - 6]], [[x + 0.5, y], [x, y - 7.5]], [[x + 2.5, y], [x + 5, y - 5.5]]];
  const lines: P[][] = kind === 1 ? [[[x, y], [x - 1, y - 5], [x + 2.5, y - 7.5]]] : tufts.slice(0, kind === 2 ? 2 : 3);
  return <g>{lines.map((l, i) => <path key={i} d={l.length === 3 ? curve(shake(r, l, 0.4)) : sketch(r, shake(r, l, 0.4), 0.8)} />)}</g>;
}

function toes(x: number, y: number, dir: number): string {
  return `M${n(x)} ${n(y)}l${n(dir * 3.2)} 0.4M${n(x)} ${n(y)}l${n(dir * 2.4)} -2M${n(x)} ${n(y)}l${n(-dir * 1.6)} 0.6`;
}

/** A round chick sitting with its legs out front, a little beak, a wing line (doodle 09). */
const birdChick: Pose = (r, W) => {
  const cx = 34 + jit(r, 1.5), cy = 30 + jit(r, 1.5), rx = between(r, 16.5, 19.5), ry = between(r, 13.5, 16);
  const body = ring(r, cx, cy, rx, ry, { count: 14, noise: 0.04, bumps: [{ at: 0.04, w: 0.035, amt: between(r, 0.08, 0.22) }] });
  const [bx, by] = spot(cx, cy, rx, ry, between(r, 0.52, 0.55));
  const bk = weighted(r, [['tiny', 3], ['cone', 2], ['bill', 0.8]] as const);
  const wing = weighted(r, [['line', 3], ['u', 1.5], ['none', 1]] as const);
  const sit = chance(r, 0.6);
  const ek = weighted(r, BIRD_EYE);
  return {
    spots: [[8, 8], [56, 8], [56, 56], [30, 6]],
    flip: true,
    node: (
      <>
        {sit ? (
          <>
            <path d={`M${n(cx - rx * 0.2)} ${n(cy + ry * 0.92)}L${n(cx - rx * 0.92)} ${n(cy + ry * 1.12)}${toes(cx - rx * 0.92, cy + ry * 1.12, -1)}`} />
            <path d={`M${n(cx + rx * 0.15)} ${n(cy + ry * 0.98)}L${n(cx - rx * 0.32)} ${n(cy + ry * 1.45)}${toes(cx - rx * 0.32, cy + ry * 1.45, -1)}`} />
          </>
        ) : (
          <path d={`M${n(cx - 4)} ${n(cy + ry - 1)}L${n(cx - 4.5)} ${n(cy + ry + 6)}${toes(cx - 4.5, cy + ry + 6, -1)}M${n(cx + 3)} ${n(cy + ry - 1)}L${n(cx + 3)} ${n(cy + ry + 6)}${toes(cx + 3, cy + ry + 6, -1)}`} />
        )}
        {outline(body, chance(r, 0.25) ? Math.floor(between(r, 9, 11)) : -1)}
        {crest(r, cx - rx * 0.3, cy - ry * 0.97, weighted(r, [[0, 4], [1, 1.5], [2, 1], [3, 0.7]] as const))}
        {eyes(ek, [[cx - rx * between(r, 0.25, 0.45), cy - ry * between(r, 0.3, 0.45)]], 0.9)}
        {wing === 'line' && <path d={curve(shake(r, [[cx + rx * 0.02, cy + ry * 0.1], [cx + rx * 0.35, cy + ry * 0.3], [cx + rx * 0.98, cy + ry * 0.18]], 0.6))} />}
        {wing === 'u' && <path d={`M${n(cx + rx * 0.35)} ${n(cy + 1)}q0 7 4 7q4 0 4 -7`} />}
        {beak(r, bk, bx, by, between(r, 0.9, 1.15))}
      </>
    ),
  };
};

/** Upright, a big hooked beak, a U for a wing, short legs with crossed feet (doodle 10). */
const birdParrot: Pose = (r) => {
  const cx = 35 + jit(r, 1.5), cy = 30 + jit(r, 1.5), rx = between(r, 13.5, 15.5), ry = between(r, 16, 18.5);
  const body = ring(r, cx, cy, rx, ry, { count: 13 });
  const s = between(r, 0.85, 1.2), hx = cx - rx * 0.82, hy = cy - ry * 0.38;
  const hook: P[] = [[hx + 3 * s, hy - 5 * s], [hx - 3.5 * s, hy - 5.5 * s], [hx - 6 * s, hy], [hx - 4.5 * s, hy + 5 * s], [hx - 1.5 * s, hy + 6.5 * s], [hx - 2.5 * s, hy + 3 * s], [hx + 1.5 * s, hy + 2.5 * s]];
  const ek = weighted(r, [['tiny', 3], ['dot', 2], ['ring', 1.5], ['closed', 1]] as const);
  const ex = cx - rx * 0.2, ey = cy - ry * 0.48;
  const fy = cy + ry + between(r, 4, 6);
  return {
    spots: [[8, 8], [56, 8], [8, 56], [56, 56]],
    flip: true,
    node: (
      <>
        <path d={`M${n(cx - 3)} ${n(cy + ry - 1)}L${n(cx - 3.4)} ${n(fy)}M${n(cx - 6)} ${n(fy)}L${n(cx - 0.8)} ${n(fy + 0.4)}M${n(cx + 4)} ${n(cy + ry - 1.5)}L${n(cx + 4.2)} ${n(fy - 0.4)}M${n(cx + 1.6)} ${n(fy - 0.4)}L${n(cx + 6.8)} ${n(fy)}`} />
        {chance(r, 0.35) && <path d={sketch(r, [[cx + rx * 0.6, cy + ry * 0.7], [cx + rx + 4, cy + ry + 6], [cx + rx * 0.9, cy + ry * 0.45]], 0.6, true)} fill={PAPER} />}
        {outline(body)}
        {crest(r, cx - rx * 0.05, cy - ry * 0.97, weighted(r, [[0, 3], [3, 1.5], [1, 1]] as const))}
        {ek === 'ring' ? <><circle cx={n(ex)} cy={n(ey)} r={3.2} fill={PAPER} /><circle cx={n(ex)} cy={n(ey)} r={1.1} fill={INK} stroke="none" /></>
          : ek === 'tiny' ? <circle cx={n(ex)} cy={n(ey)} r={1.3} fill={INK} stroke="none" />
            : eyes(ek, [[ex, ey]], 0.9)}
        <path d={curve(shake(r, hook, 0.3), true)} fill={PAPER} />
        <path d={`M${n(hx - 4.8 * s)} ${n(hy + 0.6)}L${n(hx + 1)} ${n(hy + 0.4)}`} strokeWidth={1.6} />
        {chance(r, 0.85) && <path d={`M${n(cx + rx * 0.15)} ${n(cy + ry * 0.05)}q0 ${n(between(r, 6, 8))} 3.4 ${n(between(r, 6, 8))}q3.4 0 3.4 -7`} />}
        {chance(r, 0.3) && <path d={`M${n(ex - 1)} ${n(ey + 4.5)}l-1 1.6M${n(ex + 1.6)} ${n(ey + 4.5)}l-1 1.6M${n(ex + 4.2)} ${n(ey + 4.5)}l-1 1.6`} strokeWidth={1.3} />}
      </>
    ),
  };
};

/** A long body leaning forward, a long thin beak, two dot eyes, long legs (doodle 11). */
const birdLong: Pose = (r, W) => {
  const cx = 37 + jit(r, 1.5), cy = 27 + jit(r, 2), rx = between(r, 15, 18.5), ry = between(r, 9.5, 12), k = between(r, 0.05, 0.18);
  const sh = ([x, y]: P): P => [x, y + (x - cx) * k];
  const body = ring(r, cx, cy, rx, ry, { sq: between(r, 2.6, 3.4), count: 12 }).map(sh);
  const [bx, by] = sh([cx - rx + 3, cy - ry * 0.15]);
  const len = between(r, 9, 15), ang = between(r, 0.5, 1.05);
  const tip: P = [bx - Math.cos(ang) * len, by + Math.sin(ang) * len];
  const two = chance(r, 0.6);
  const legX = [cx + rx * between(r, 0.1, 0.3), cx + rx * between(r, 0.45, 0.6)];
  const foot = between(r, 56, 60);
  return {
    spots: [[8, 8], [56, 8], [10, 56], [30, 6]],
    flip: true,
    node: (
      <>
        {legX.map((x, i) => {
          const [, y] = sh([x, cy + ry * 0.92]);
          const fx = x + jit(r, 1.5) - i * 1.5;
          return <path key={i} d={`M${n(x)} ${n(y)}L${n(fx)} ${n(foot - i)}${toes(fx, foot - i, -1)}`} />;
        })}
        {outline(body)}
        {chance(r, 0.35) && <path d={sketch(r, [sh([cx + rx * 0.9, cy - ry * 0.5]), sh([cx + rx + 6, cy - ry * 0.9]), sh([cx + rx * 0.95, cy])], 0.5)} />}
        {crest(r, sh([cx - rx * 0.55, cy - ry])[0], sh([cx - rx * 0.55, cy - ry])[1], weighted(r, [[0, 4], [1, 1], [2, 1]] as const))}
        <path d={sketch(r, [[bx + 1.2, by - 2.6], tip, [bx + 2.6, by + 2.2]], 0.5, true)} fill={PAPER} />
        {two ? eyes('dot', [sh([cx - rx * 0.72, cy - ry * 0.45]), sh([cx - rx * 0.36, cy - ry * 0.42])], 0.7)
          : eyes(weighted(r, BIRD_EYE), [sh([cx - rx * 0.55, cy - ry * 0.4])], 0.85)}
        {chance(r, 0.25) && <path d={curve(shake(r, [sh([cx + rx * 0.1, cy + ry * 0.05]), sh([cx + rx * 0.4, cy + ry * 0.3]), sh([cx + rx * 0.85, cy + ry * 0.1])], 0.5))} strokeWidth={n(W * 0.85)} />}
      </>
    ),
  };
};

/** Face-on round bird: an owl with tufts, a budgie, a robin. */
const birdFront: Pose = (r, W) => {
  const cx = 32 + jit(r, 1), cy = 34 + jit(r, 1.5), rx = between(r, 14.5, 17.5), ry = between(r, 15, 18);
  const owl = chance(r, 0.35);
  const body = ring(r, cx, cy, rx, ry, { count: 14, bumps: owl ? [{ at: 0.66, w: 0.03, amt: 0.22 }, { at: 0.84, w: 0.03, amt: 0.22 }] : [] });
  const ek = owl
    ? weighted(r, [['ring', 4], ['dot', 1], ['closed', 1]] as const)
    : weighted(r, [['dot', 4], ['shine', 2], ['ring', 0.8], ['closed', 1], ['happy', 1]] as const);
  const ex = rx * between(r, 0.32, 0.42), ey = cy - ry * between(r, 0.25, 0.38);
  const belly = weighted(r, [['none', 3], ['chevrons', 1.5], ['speckle', 1.2], ['bib', 1]] as const);
  const by = ey + between(r, 2, 3.5);
  return {
    spots: [[7, 10], [57, 10], [7, 57], [57, 57]],
    node: (
      <>
        {chance(r, 0.75) && <path d={`M${n(cx - 4)} ${n(cy + ry - 1)}l0 3${toes(cx - 4, cy + ry + 2, -1)}M${n(cx + 4)} ${n(cy + ry - 1)}l0 3${toes(cx + 4, cy + ry + 2, 1)}`} strokeWidth={n(W * 0.85)} />}
        {outline(body)}
        {!owl && crest(r, cx, cy - ry * 0.98, weighted(r, [[0, 3], [1, 1.5], [3, 1]] as const))}
        {chance(r, 0.7) && [-1, 1].map((d) => <path key={d} d={curve([[cx + d * rx * 0.86, cy - ry * 0.05], [cx + d * rx * 0.62, cy + ry * 0.4], [cx + d * rx * 0.72, cy + ry * 0.78]])} />)}
        {belly === 'chevrons' && <path d={`M${n(cx - 4)} ${n(cy + 4)}l2 2l2 -2M${n(cx)} ${n(cy + 4)}l2 2l2 -2M${n(cx - 2)} ${n(cy + 9)}l2 2l2 -2`} strokeWidth={1.5} />}
        {belly === 'speckle' && <g fill={INK} stroke="none">{[[-5, 3], [0, 5], [5, 3], [-3, 9], [3, 9], [0, 13]].map(([x, y], i) => <circle key={i} cx={n(cx + x!)} cy={n(cy + y!)} r={0.9} />)}</g>}
        {belly === 'bib' && <path d={curve([[cx - rx * 0.45, cy + ry * 0.05], [cx, cy + ry * 0.55], [cx + rx * 0.45, cy + ry * 0.05]])} />}
        {ek === 'ring'
          ? [-1, 1].map((d) => <g key={d}><circle cx={n(cx + d * ex)} cy={n(ey)} r={4.4} fill={PAPER} /><circle cx={n(cx + d * ex)} cy={n(ey)} r={1.8} fill={INK} stroke="none" /></g>)
          : eyes(ek, [[cx - ex, ey], [cx + ex, ey]])}
        <path d={sketch(r, [[cx - 2.4, by], [cx + 2.4, by], [cx, by + 4]], 0.3, true)} fill={chance(r, 0.4) ? INK : PAPER} strokeWidth={n(W * 0.8)} />
      </>
    ),
  };
};

/** Perched on a branch, long tail down behind, maybe singing. */
const birdPerch: Pose = (r, W) => {
  const cx = 30 + jit(r, 1.5), cy = 29 + jit(r, 1.5), rx = between(r, 13, 15.5), ry = between(r, 10.5, 12.5);
  const body = ring(r, cx, cy, rx, ry, { count: 12, bumps: [{ at: 0.05, w: 0.06, amt: 0.1 }] });
  const py = cy + ry + between(r, 4, 6);
  const tail: P[] = [[cx + rx * 0.8, cy + ry * 0.1], [cx + rx + between(r, 9, 14), cy + ry * between(r, 0.6, 1.1)], [cx + rx + between(r, 7, 11), cy + ry * between(r, 1.2, 1.5)], [cx + rx * 0.5, cy + ry * 0.7]];
  const [bx, by] = spot(cx, cy, rx, ry, 0.53);
  const ek = weighted(r, BIRD_EYE);
  const sing = chance(r, 0.25);
  return {
    spots: [[8, 56], [56, 8], [44, 8], [8, 30]],
    flip: true,
    node: (
      <>
        <path d={sketch(r, [[3, py + jit(r, 1)], [61, py + jit(r, 1.5)]], 0.8)} />
        {chance(r, 0.6) && <><path d={`M${n(12)} ${n(py)}l-4 -5`} /><path d={curve([[8, py - 5], [5, py - 9], [9.5, py - 9.5]], true)} fill={chance(r, 0.5) ? INK : PAPER} strokeWidth={1.6} /></>}
        <path d={curve(tail, true)} fill={chance(r, 0.15) ? INK : PAPER} />
        <path d={`M${n(cx - 3)} ${n(cy + ry - 0.5)}L${n(cx - 3.4)} ${n(py)}M${n(cx + 2.5)} ${n(cy + ry - 0.5)}L${n(cx + 2.5)} ${n(py)}`} />
        {outline(body)}
        {crest(r, cx - rx * 0.25, cy - ry * 0.97, weighted(r, [[0, 3], [1, 1.5], [2, 1]] as const))}
        {eyes(ek, [[cx - rx * 0.4, cy - ry * 0.32]], 0.9)}
        {chance(r, 0.6) && <path d={curve(shake(r, [[cx - rx * 0.1, cy + ry * 0.05], [cx + rx * 0.35, cy + ry * 0.35], [cx + rx * 0.8, cy + ry * 0.2]], 0.5))} />}
        {beak(r, sing ? 'cone' : weighted(r, [['cone', 2], ['tiny', 2]] as const), bx, by, 1)}
        {sing && <><ellipse cx={n(bx - 3)} cy={n(by - 12)} rx={1.8} ry={1.4} fill={INK} stroke="none" /><path d={`M${n(bx - 1.4)} ${n(by - 12)}l0 -6l2.6 1.4`} strokeWidth={1.5} /></>}
      </>
    ),
  };
};

const BIRDS: readonly (readonly [Pose, number])[] = [[birdChick, 2], [birdParrot, 1.6], [birdLong, 1.5], [birdFront, 1.8], [birdPerch, 1.5]];

/* ─── the face ───────────────────────────────────────────────────────────── */

function draw(species: PetSpecies, variant: number): ReactNode {
  const r = rng(hash(`${species}:${variant}`));
  r();
  const W = between(r, 2.6, 3.5);
  const pose = weighted(r, species === 'dog' ? DOGS : species === 'cat' ? CATS : BIRDS);
  const out = pose(r, W);
  const flip = out.flip !== false && chance(r, 0.5);
  const tilt = jit(r, 5);
  const sp = chance(r, 0.28) ? sparkles(r, out.spots, chance(r, 0.5) ? 1 : 2) : null;
  return (
    <g transform={`rotate(${n(tilt)} 32 32)${flip ? ' translate(64 0) scale(-1 1)' : ''}`}
      stroke={INK} strokeWidth={n(W)} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {out.node}
      {sp}
    </g>
  );
}

/** The drawn face, or the owner's uploaded picture. */
export function PetAvatar({ pet, size = 40, label }: {
  pet: { species: PetSpecies; avatar: { variant: number; url: string | null }; name?: string };
  size?: number;
  label?: string;
}) {
  if (pet.avatar.url) {
    return <img className="pet-face photo" src={pet.avatar.url} alt={label ?? ''} width={size} height={size} />;
  }
  return (
    <svg className="pet-face" viewBox="0 0 64 64" width={size} height={size}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {draw(pet.species, pet.avatar.variant)}
    </svg>
  );
}
