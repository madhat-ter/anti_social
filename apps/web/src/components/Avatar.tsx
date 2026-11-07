/**
 * Doodle avatars: a hand-drawn-looking 1-bit face generated deterministically from a seed
 * (the member's handle). Same handle → same face, everywhere, forever. No uploads needed.
 * Ink = currentColor, fill = var(--paper), so it follows the light/dark theme.
 */
import type { ReactNode } from 'react';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Head = { cx: number; cy: number; l: number; r: number; t: number; b: number; shape: 'round' | 'square' | 'long' };

const INK = 'currentColor';
const PAPER = 'var(--paper)';
const S = { stroke: INK, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function face(seed: string): ReactNode {
  const r = rng(hash(seed.toLowerCase()));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const chance = (p: number) => r() < p;
  const jit = (n: number) => (r() - 0.5) * 2 * n;

  // ── frame: a slightly crooked card with a hard ink shadow
  const tilt = jit(5);
  const frame = (
    <g transform={`rotate(${tilt.toFixed(2)} 32 32)`}>
      <rect x="9" y="9" width="50" height="50" fill={INK} />
      <rect x="5" y="5" width="50" height="50" fill={PAPER} {...S} />
    </g>
  );

  // ── head
  const shape = pick(['round', 'square', 'long'] as const);
  const cx = 30 + jit(1.5), cy = 33 + jit(1);
  const w = shape === 'long' ? 12 + r() * 2 : 14 + r() * 3;
  const h = shape === 'long' ? 18 + r() * 2 : 15 + r() * 3;
  const head: Head = { cx, cy, l: cx - w, r: cx + w, t: cy - h, b: cy + h, shape };
  const headEl =
    shape === 'round' ? <ellipse cx={cx} cy={cy} rx={w} ry={h} fill={PAPER} {...S} />
    : <rect x={head.l} y={head.t} width={w * 2} height={h * 2} rx={shape === 'square' ? 5 : 9} fill={PAPER} {...S} />;

  const ears = chance(0.55) ? (
    <g>
      <circle cx={head.l - 1} cy={cy + 1} r={3.2} fill={PAPER} {...S} />
      <circle cx={head.r + 1} cy={cy + 1} r={3.2} fill={PAPER} {...S} />
    </g>
  ) : null;

  // ── hair (some styles draw behind the head, some on top)
  const hairStyle = pick(['none', 'flat', 'spiky', 'side', 'bob', 'curly', 'cap', 'crown', 'beanie', 'quiff'] as const);
  let behind: ReactNode = null;
  let top: ReactNode = null;
  const { l, t } = head;
  const R = head.r;
  switch (hairStyle) {
    case 'flat':
      top = <path d={`M${l - 1} ${t + 9} L${l - 1} ${t + 2} Q${cx} ${t - 5} ${R + 1} ${t + 2} L${R + 1} ${t + 9} Q${cx} ${t + 4} ${l - 1} ${t + 9} Z`} fill={INK} {...S} />;
      break;
    case 'spiky': {
      const n = 6;
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const x = l + ((R - l) * i) / n;
        return `${x.toFixed(1)},${(t + 5).toFixed(1)} ${(x + (R - l) / n / 2).toFixed(1)},${(t - 6 - r() * 4).toFixed(1)}`;
      }).join(' ');
      top = <polygon points={`${l},${t + 9} ${pts} ${R},${t + 9}`} fill={INK} {...S} />;
      break;
    }
    case 'side':
      top = <path d={`M${l - 1} ${t + 13} Q${l + 2} ${t - 4} ${cx + 4} ${t - 2} Q${R + 3} ${t} ${R + 1} ${t + 10} Q${cx + 2} ${t + 3} ${l + 4} ${t + 9} Z`} fill={INK} {...S} />;
      break;
    case 'bob':
      behind = <path d={`M${l - 4} ${cy + 8} L${l - 4} ${t + 4} Q${cx} ${t - 9} ${R + 4} ${t + 4} L${R + 4} ${cy + 8} Z`} fill={INK} {...S} />;
      top = <path d={`M${l} ${t + 10} Q${cx} ${t - 4} ${R} ${t + 10} L${R} ${t + 4} Q${cx} ${t - 6} ${l} ${t + 4} Z`} fill={INK} {...S} />;
      break;
    case 'curly':
      top = (
        <g>
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} cx={l + 2 + ((R - l - 4) * i) / 5} cy={t + 1 + (i % 2) * 2} r={4.4} fill={INK} {...S} />
          ))}
        </g>
      );
      break;
    case 'cap':
      top = (
        <g>
          <path d={`M${l} ${t + 7} Q${cx} ${t - 9} ${R} ${t + 7} Z`} fill={INK} {...S} />
          <path d={`M${cx} ${t + 7} L${R + 9} ${t + 8}`} {...S} strokeWidth={3} />
        </g>
      );
      break;
    case 'crown':
      top = (
        <path
          d={`M${cx - 10} ${t + 1} L${cx - 11} ${t - 10} L${cx - 5} ${t - 4} L${cx} ${t - 12} L${cx + 5} ${t - 4} L${cx + 11} ${t - 10} L${cx + 10} ${t + 1} Z`}
          fill={PAPER} {...S}
        />
      );
      break;
    case 'beanie':
      top = (
        <g>
          <path d={`M${l - 1} ${t + 8} Q${cx} ${t - 14} ${R + 1} ${t + 8} Z`} fill={INK} {...S} />
          <rect x={l - 2} y={t + 5} width={R - l + 4} height={5} rx={1.5} fill={PAPER} {...S} />
          <circle cx={cx} cy={t - 6} r={2.6} fill={PAPER} {...S} />
        </g>
      );
      break;
    case 'quiff':
      top = <path d={`M${l} ${t + 8} Q${l + 1} ${t - 3} ${cx - 2} ${t - 4} Q${cx + 6} ${t - 13} ${R + 2} ${t - 3} Q${R - 2} ${t + 1} ${R} ${t + 8} Q${cx} ${t + 1} ${l} ${t + 8} Z`} fill={INK} {...S} />;
      break;
  }

  // ── eyes
  const ey = cy - 2 + jit(1);
  const dx = 6 + r() * 1.5;
  const eyesStyle = pick(['dots', 'dots', 'ring', 'glasses', 'square-glasses', 'sleepy', 'wink'] as const);
  const brows = chance(0.45) ? (
    <g>
      <path d={`M${cx - dx - 3} ${ey - 5 + jit(1)} L${cx - dx + 3} ${ey - 6 + jit(1.5)}`} {...S} />
      <path d={`M${cx + dx - 3} ${ey - 6 + jit(1.5)} L${cx + dx + 3} ${ey - 5 + jit(1)}`} {...S} />
    </g>
  ) : null;
  let eyes: ReactNode;
  switch (eyesStyle) {
    case 'dots':
      eyes = <g fill={INK}><circle cx={cx - dx} cy={ey} r={1.8} /><circle cx={cx + dx} cy={ey} r={1.8} /></g>;
      break;
    case 'ring':
      eyes = (
        <g>
          <circle cx={cx - dx} cy={ey} r={3.2} fill={PAPER} {...S} strokeWidth={1.8} />
          <circle cx={cx + dx} cy={ey} r={3.2} fill={PAPER} {...S} strokeWidth={1.8} />
          <circle cx={cx - dx + 0.8} cy={ey + 0.5} r={1.3} fill={INK} />
          <circle cx={cx + dx + 0.8} cy={ey + 0.5} r={1.3} fill={INK} />
        </g>
      );
      break;
    case 'glasses':
      eyes = (
        <g>
          <circle cx={cx - dx} cy={ey} r={4.4} fill={PAPER} {...S} strokeWidth={2} />
          <circle cx={cx + dx} cy={ey} r={4.4} fill={PAPER} {...S} strokeWidth={2} />
          <path d={`M${cx - dx + 4.4} ${ey} L${cx + dx - 4.4} ${ey}`} {...S} strokeWidth={1.8} />
          <circle cx={cx - dx} cy={ey + 0.5} r={1.4} fill={INK} />
          <circle cx={cx + dx} cy={ey + 0.5} r={1.4} fill={INK} />
        </g>
      );
      break;
    case 'square-glasses':
      eyes = (
        <g>
          <rect x={cx - dx - 4.4} y={ey - 3.4} width={8.8} height={6.8} rx={1.5} fill={PAPER} {...S} strokeWidth={2} />
          <rect x={cx + dx - 4.4} y={ey - 3.4} width={8.8} height={6.8} rx={1.5} fill={PAPER} {...S} strokeWidth={2} />
          <path d={`M${cx - dx + 4.4} ${ey - 1} L${cx + dx - 4.4} ${ey - 1}`} {...S} strokeWidth={1.8} />
          <circle cx={cx - dx} cy={ey} r={1.3} fill={INK} />
          <circle cx={cx + dx} cy={ey} r={1.3} fill={INK} />
        </g>
      );
      break;
    case 'sleepy':
      eyes = (
        <g>
          <path d={`M${cx - dx - 3} ${ey} Q${cx - dx} ${ey + 2.5} ${cx - dx + 3} ${ey}`} {...S} fill="none" />
          <path d={`M${cx + dx - 3} ${ey} Q${cx + dx} ${ey + 2.5} ${cx + dx + 3} ${ey}`} {...S} fill="none" />
        </g>
      );
      break;
    default: // wink
      eyes = (
        <g>
          <circle cx={cx - dx} cy={ey} r={1.8} fill={INK} />
          <path d={`M${cx + dx - 3} ${ey} L${cx + dx + 3} ${ey}`} {...S} />
        </g>
      );
  }

  // ── nose
  const ny = ey + 6 + jit(1);
  const nose = pick([
    <path key="L" d={`M${cx + 1} ${ey + 1} L${cx - 1} ${ny} L${cx + 3} ${ny}`} {...S} fill="none" />,
    <path key="hook" d={`M${cx} ${ey + 2} Q${cx + 5} ${ny} ${cx} ${ny + 1}`} {...S} fill="none" />,
    <circle key="dot" cx={cx} cy={ny - 1} r={1.2} fill={INK} />,
    <path key="v" d={`M${cx - 2} ${ny - 1} L${cx} ${ny + 1} L${cx + 2} ${ny - 1}`} {...S} fill="none" />,
  ]);

  // ── mouth
  const my = Math.min(ny + 6 + jit(1), head.b - 4);
  const mw = 3 + r() * 3;
  const mouth = pick([
    <path key="smile" d={`M${cx - mw} ${my} Q${cx} ${my + 4} ${cx + mw} ${my}`} {...S} fill="none" />,
    <path key="flat" d={`M${cx - mw} ${my + 1} L${cx + mw} ${my + 1}`} {...S} />,
    <circle key="o" cx={cx} cy={my + 1} r={1.9} fill={PAPER} {...S} strokeWidth={1.8} />,
    <path key="smirk" d={`M${cx - mw} ${my + 1} Q${cx + 1} ${my + 2} ${cx + mw} ${my - 1.5}`} {...S} fill="none" />,
    <path key="frown" d={`M${cx - mw} ${my + 2} Q${cx} ${my - 2} ${cx + mw} ${my + 2}`} {...S} fill="none" />,
  ]);

  // ── facial hair
  const fh = pick(['none', 'none', 'none', 'mustache', 'beard'] as const);
  let facial: ReactNode = null;
  if (fh === 'mustache') {
    facial = <path d={`M${cx - 7} ${my - 1} Q${cx - 3} ${my - 5} ${cx} ${my - 2.5} Q${cx + 3} ${my - 5} ${cx + 7} ${my - 1} Q${cx + 3} ${my - 2} ${cx} ${my - 1} Q${cx - 3} ${my - 2} ${cx - 7} ${my - 1} Z`} fill={INK} {...S} strokeWidth={1.4} />;
  } else if (fh === 'beard') {
    const by = my - 3;
    const bb = head.b + 5;
    facial = (
      <g>
        <path d={`M${l + 1} ${cy + 2} Q${l + 2} ${bb} ${cx} ${bb} Q${R - 2} ${bb} ${R - 1} ${cy + 2} Q${cx + 6} ${by} ${cx} ${by + 2} Q${cx - 6} ${by} ${l + 1} ${cy + 2} Z`} fill={INK} {...S} />
        {[-6, -3, 0, 3, 6].map((o) => (
          <path key={o} d={`M${cx + o} ${by + 5} L${cx + o * 1.1} ${bb - 3}`} stroke={PAPER} strokeWidth={1} strokeLinecap="round" />
        ))}
        <path d={`M${cx - 3} ${my + 0.5} L${cx + 3} ${my + 0.5}`} stroke={PAPER} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  return (
    <>
      {frame}
      {behind}
      {ears}
      {headEl}
      {top}
      {brows}
      {eyes}
      {nose}
      {fh === 'beard' ? <>{facial}</> : <>{mouth}{facial}</>}
    </>
  );
}

export function Avatar({ seed, size = 40, label, className }: {
  /** usually the handle; null = deleted user */
  seed: string | null;
  size?: number;
  /** accessible name; omit when the name is printed next to it */
  label?: string;
  className?: string;
}) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      className={`avatar${className ? ` ${className}` : ''}`}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      overflow="visible"
      {...a11y}
    >
      {seed ? face(seed) : (
        <g>
          <rect x="9" y="9" width="50" height="50" fill={INK} />
          <rect x="5" y="5" width="50" height="50" fill={PAPER} {...S} strokeDasharray="4 4" />
          <text x="30" y="38" textAnchor="middle" fontSize="20" fontFamily="var(--font-ui)" fill={INK}>?</text>
        </g>
      )}
    </svg>
  );
}
