/**
 * RFC §10.17: pet faces. 100 looks per species, drawn in code from `species:variant` in the same
 * hand-drawn 1-bit ink as the member faces (Avatar.tsx): wobbly outlines, uneven strokes, filled
 * noses and patches, the occasional sparkle. Same pet → same face, everywhere; no image files.
 */
import type { ReactNode } from 'react';
import type { PetSpecies } from '@/lib/api';

const INK = 'currentColor';
const PAPER = 'var(--paper)';
const n = (v: number) => Number(v.toFixed(1));

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
const pick = <T,>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (r: R, p: number) => r() < p;
const between = (r: R, a: number, b: number) => a + r() * (b - a);
const jit = (r: R, amount: number) => (r() - 0.5) * 2 * amount;

/** An ellipsish outline with four slightly uneven corners, so the line looks inked by hand. */
function blob(cx: number, cy: number, rx: number, ry: number, j: number): string {
  const p = (x: number, y: number) => `${n(x)} ${n(y)}`;
  const k = 0.5523;
  const jx = 1 + j;
  const jy = 1 + j;
  return `M ${p(cx - rx, cy)} `
    + `C ${p(cx - rx, cy - ry * jy)} ${p(cx - rx * jx, cy - ry)} ${p(cx, cy - ry)} `
    + `C ${p(cx + rx * jx, cy - ry)} ${p(cx + rx, cy - ry * jy)} ${p(cx + rx, cy)} `
    + `C ${p(cx + rx, cy + ry * jy)} ${p(cx + rx * jx, cy + ry)} ${p(cx, cy + ry)} `
    + `C ${p(cx - rx * jx, cy + ry)} ${p(cx - rx, cy + ry * jy)} ${p(cx - rx, cy)} Z`;
}

function Sparkles({ xs, ink }: { xs: [number, number][]; ink: Record<string, unknown> }) {
  return (
    <g {...ink} strokeWidth={1.7}>
      {xs.map(([x, y], i) => (
        <path key={i} d={`M${n(x - 1.6)} ${n(y)} L${n(x + 1.6)} ${n(y)} M${n(x)} ${n(y - 1.6)} L${n(x)} ${n(y + 1.6)}`} />
      ))}
    </g>
  );
}

/* ─── dog ────────────────────────────────────────────────────────────────── */

function dog(r: R): ReactNode {
  const W = between(r, 2.3, 3.1);
  const ink = { stroke: INK, strokeWidth: W, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  const paper = { ...ink, fill: PAPER };
  const tilt = jit(r, 3.5);
  const withBody = chance(r, 0.35);
  const cx = 32 + jit(r, 1.4);
  const cy = withBody ? 23 + jit(r, 1) : 31 + jit(r, 1);
  const rx = between(r, 12.5, 16);
  const ry = between(r, 10.5, 14);
  const wob = jit(r, 0.05);
  const ear = pick(r, ['floppy', 'pointy', 'oneup', 'long'] as const);
  const eyes = pick(r, ['dots', 'dashes', 'shades', 'wink', 'happy', 'sleepy'] as const);
  const patch = pick(r, ['none', 'ear', 'spot', 'muzzle'] as const);
  const tongue = chance(r, 0.28);
  const collar = chance(r, 0.45);
  const noseY = cy + ry * 0.34;
  const ex = rx * 0.46;
  const ey = cy - ry * 0.08;

  const earInk = patch === 'ear' ? { ...paper, fill: INK } : paper;
  const floppy = (dir: 1 | -1) => {
    const x = cx + dir * (rx - 1.5);
    const drop = ear === 'long' ? ry + 9 : ry * 0.85;
    return (
      <path
        d={`M${n(x)} ${n(cy - ry + 3)} C${n(x + dir * 8)} ${n(cy - ry + 1)} ${n(x + dir * 9)} ${n(cy + drop * 0.7)} ${n(x + dir * 3)} ${n(cy + drop)} C${n(x - dir * 1)} ${n(cy + drop * 0.7)} ${n(x - dir * 1)} ${n(cy + 2)} ${n(x)} ${n(cy - ry + 3)} Z`}
        {...earInk}
      />
    );
  };
  const pointy = (dir: 1 | -1) => {
    const x = cx + dir * (rx - 3);
    return (
      <path
        d={`M${n(x)} ${n(cy - ry + 4)} C${n(x + dir * 1)} ${n(cy - ry - 7)} ${n(x + dir * 5)} ${n(cy - ry - 9)} ${n(x + dir * 7)} ${n(cy - ry - 8)} C${n(x + dir * 7)} ${n(cy - ry - 2)} ${n(x + dir * 5)} ${n(cy - ry + 2)} ${n(x + dir * 8)} ${n(cy - ry + 5)} Z`}
        {...earInk}
      />
    );
  };

  return (
    <g transform={`rotate(${n(tilt)} 32 32)`}>
      {withBody && (
        <g>
          <path d={`M${n(cx - rx * 0.55)} ${n(cy + ry + 1)} C${n(cx - rx * 0.7)} ${n(cy + ry + 10)} ${n(cx - rx * 0.5)} 59 ${n(cx - 3)} 59 L${n(cx + 4)} 59 C${n(cx + rx * 0.55)} 58 ${n(cx + rx * 0.6)} ${n(cy + ry + 8)} ${n(cx + rx * 0.5)} ${n(cy + ry + 1)} Z`} {...paper} />
          <path d={`M${n(cx - rx * 0.5)} 58 l-1 4 M${n(cx + rx * 0.45)} 58 l1 4`} {...ink} />
          <path d={`M${n(cx + rx * 0.5)} ${n(cy + ry + 6)} C${n(cx + rx + 7)} ${n(cy + ry + 3)} ${n(cx + rx + 8)} ${n(cy + 4)} ${n(cx + rx + 4)} ${n(cy + 1)}`} {...ink} />
        </g>
      )}
      {ear === 'oneup' ? <>{floppy(-1)}{pointy(1)}</> : ear === 'pointy' ? <>{pointy(-1)}{pointy(1)}</> : <>{floppy(-1)}{floppy(1)}</>}
      <path d={blob(cx, cy, rx, ry, wob)} {...paper} />
      {patch === 'spot' && <path d={blob(cx - rx * 0.55, cy + ry * 0.25, rx * 0.32, ry * 0.28, wob)} fill={INK} />}
      {(patch === 'muzzle' || chance(r, 0.4)) && (
        <path d={blob(cx, cy + ry * 0.46, rx * 0.5, ry * 0.34, wob)} {...paper} />
      )}

      {eyes === 'dots' && <g fill={INK}><circle cx={n(cx - ex)} cy={n(ey)} r={1.7} /><circle cx={n(cx + ex)} cy={n(ey)} r={1.7} /></g>}
      {eyes === 'dashes' && <g {...ink} strokeWidth={2.6}><path d={`M${n(cx - ex - 2)} ${n(ey)} L${n(cx - ex + 2)} ${n(ey)}`} /><path d={`M${n(cx + ex - 2)} ${n(ey)} L${n(cx + ex + 2)} ${n(ey)}`} /></g>}
      {eyes === 'shades' && (
        <g>
          <path d={`M${n(cx - ex - 5)} ${n(ey - 2)} q5 -3 10 0 q1 4 -4 4 q-5 0 -6 -4 Z`} fill={INK} />
          <path d={`M${n(cx + ex - 5)} ${n(ey - 2)} q5 -3 10 0 q1 4 -4 4 q-5 0 -6 -4 Z`} fill={INK} />
          <path d={`M${n(cx - 1)} ${n(ey - 1)} L${n(cx + 1)} ${n(ey - 1)}`} {...ink} />
        </g>
      )}
      {eyes === 'wink' && <g><circle cx={n(cx - ex)} cy={n(ey)} r={1.7} fill={INK} /><path d={`M${n(cx + ex - 3)} ${n(ey)} q3 3 6 0`} {...ink} /></g>}
      {eyes === 'happy' && <g {...ink}><path d={`M${n(cx - ex - 3)} ${n(ey + 1)} q3 -4 6 0`} /><path d={`M${n(cx + ex - 3)} ${n(ey + 1)} q3 -4 6 0`} /></g>}
      {eyes === 'sleepy' && <g {...ink}><path d={`M${n(cx - ex - 3)} ${n(ey - 1)} q3 3 6 0`} /><path d={`M${n(cx + ex - 3)} ${n(ey - 1)} q3 3 6 0`} /></g>}

      <path d={blob(cx, noseY, 3.4 + r(), 2.6 + r() * 0.8, wob)} fill={INK} />
      <path d={`M${n(cx)} ${n(noseY + 3)} q${n(-rx * 0.2)} ${n(ry * 0.28)} ${n(-rx * 0.36)} ${n(ry * 0.1)} M${n(cx)} ${n(noseY + 3)} q${n(rx * 0.2)} ${n(ry * 0.28)} ${n(rx * 0.36)} ${n(ry * 0.1)}`} {...ink} />
      {tongue && <path d={blob(cx, noseY + 7, 3, 4.2, wob)} {...paper} />}
      {collar && (
        <g>
          <path d={`M${n(cx - rx * 0.6)} ${n(cy + ry + 2)} q${n(rx * 0.6)} 4 ${n(rx * 1.2)} 0`} {...ink} />
          <circle cx={n(cx)} cy={n(cy + ry + 5)} r={2.2} {...ink} fill={PAPER} />
        </g>
      )}
      {chance(r, 0.35) && <Sparkles ink={ink} xs={[[between(r, 8, 16), between(r, 8, 16)], [between(r, 48, 57), between(r, 8, 18)]]} />}
    </g>
  );
}

/* ─── cat ────────────────────────────────────────────────────────────────── */

function cat(r: R): ReactNode {
  const W = between(r, 2.2, 3);
  const ink = { stroke: INK, strokeWidth: W, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  const paper = { ...ink, fill: PAPER };
  const tilt = jit(r, 3);
  const withBody = chance(r, 0.3);
  const cx = 32 + jit(r, 1.2);
  const cy = withBody ? 26 + jit(r, 1) : 32 + jit(r, 1);
  const rx = between(r, 13, 16);
  const ry = between(r, 11, 14);
  const wob = jit(r, 0.055);
  const ear = pick(r, ['tall', 'wide', 'small', 'fold'] as const);
  const eyes = pick(r, ['dots', 'almond', 'happy', 'wink', 'sleepy'] as const);
  const whiskers = pick(r, [0, 2, 3] as const);
  const stripes = Math.floor(between(r, 0, 3.99));
  const patch = pick(r, ['none', 'ear', 'cheek', 'none'] as const);
  const tongue = chance(r, 0.16);
  const ex = rx * 0.42;
  const ey = cy - ry * 0.12;

  const earInk = patch === 'ear' ? { ...paper, fill: INK } : paper;
  const earShape = (dir: 1 | -1) => {
    const x = cx + dir * rx * 0.62;
    const top = cy - ry;
    if (ear === 'wide') return <path d={`M${n(x - dir * 5)} ${n(top + 3)} L${n(x + dir * 6)} ${n(top - 7)} L${n(x + dir * 7)} ${n(top + 4)} Z`} {...earInk} />;
    if (ear === 'small') return <path d={`M${n(x - dir * 3)} ${n(top + 2)} L${n(x + dir * 3)} ${n(top - 4)} L${n(x + dir * 4)} ${n(top + 3)} Z`} {...earInk} />;
    if (ear === 'fold') return <path d={`M${n(x - dir * 4)} ${n(top + 2)} L${n(x + dir * 5)} ${n(top - 2)} L${n(x + dir * 6)} ${n(top + 3)} Z`} {...earInk} />;
    return <path d={`M${n(x - dir * 4)} ${n(top + 3)} L${n(x + dir * 2)} ${n(top - 11)} L${n(x + dir * 7)} ${n(top + 3)} Z`} {...earInk} />;
  };

  return (
    <g transform={`rotate(${n(tilt)} 32 32)`}>
      {withBody && (
        <g>
          <path d={`M${n(cx - rx * 0.5)} ${n(cy + ry)} C${n(cx - rx * 0.7)} ${n(cy + ry + 10)} ${n(cx - rx * 0.4)} 60 ${n(cx)} 60 C${n(cx + rx * 0.5)} 60 ${n(cx + rx * 0.7)} ${n(cy + ry + 9)} ${n(cx + rx * 0.45)} ${n(cy + ry)} Z`} {...paper} />
          <path d={`M${n(cx + rx * 0.55)} ${n(cy + ry + 8)} C${n(cx + rx + 9)} ${n(cy + ry + 6)} ${n(cx + rx + 10)} ${n(cy + ry - 2)} ${n(cx + rx + 5)} ${n(cy + ry - 4)}`} {...ink} />
        </g>
      )}
      {earShape(-1)}{earShape(1)}
      <path d={blob(cx, cy, rx, ry, wob)} {...paper} />
      {patch === 'cheek' && <path d={blob(cx - rx * 0.6, cy + ry * 0.2, rx * 0.3, ry * 0.3, wob)} fill={INK} />}
      {Array.from({ length: stripes }, (_, i) => (
        <path key={i} d={`M${n(cx - 6 + i * 5)} ${n(cy - ry + 3)} q2 -3 4 0`} {...ink} strokeWidth={1.9} />
      ))}
      {eyes === 'dots' && <g fill={INK}><circle cx={n(cx - ex)} cy={n(ey)} r={1.6} /><circle cx={n(cx + ex)} cy={n(ey)} r={1.6} /></g>}
      {eyes === 'almond' && <g fill={INK}><ellipse cx={n(cx - ex)} cy={n(ey)} rx={3} ry={1.9} /><ellipse cx={n(cx + ex)} cy={n(ey)} rx={3} ry={1.9} /></g>}
      {eyes === 'happy' && <g {...ink}><path d={`M${n(cx - ex - 3)} ${n(ey + 1)} q3 -4 6 0`} /><path d={`M${n(cx + ex - 3)} ${n(ey + 1)} q3 -4 6 0`} /></g>}
      {eyes === 'wink' && <g><circle cx={n(cx - ex)} cy={n(ey)} r={1.7} fill={INK} /><path d={`M${n(cx + ex - 3)} ${n(ey)} q3 3 6 0`} {...ink} /></g>}
      {eyes === 'sleepy' && <g {...ink}><path d={`M${n(cx - ex - 3)} ${n(ey - 1)} q3 3 6 0`} /><path d={`M${n(cx + ex - 3)} ${n(ey - 1)} q3 3 6 0`} /></g>}
      <path d={`M${n(cx - 2.4)} ${n(cy + 4)} L${n(cx + 2.4)} ${n(cy + 4)} L${n(cx)} ${n(cy + 6.4)} Z`} fill={INK} />
      <path d={`M${n(cx)} ${n(cy + 6.4)} q-2.4 2 -4.6 0.8 M${n(cx)} ${n(cy + 6.4)} q2.4 2 4.6 0.8`} {...ink} strokeWidth={1.8} />
      {tongue && <path d={blob(cx, cy + 10, 2.6, 3.4, wob)} {...paper} />}
      {whiskers > 0 && (
        <g {...ink} strokeWidth={1.6}>
          {Array.from({ length: whiskers }, (_, i) => (
            <g key={i}>
              <path d={`M${n(cx - rx - 1)} ${n(cy + 3 + i * 3 - 2)} l-8 ${n(-1 + i)}`} />
              <path d={`M${n(cx + rx + 1)} ${n(cy + 3 + i * 3 - 2)} l8 ${n(-1 + i)}`} />
            </g>
          ))}
        </g>
      )}
      {chance(r, 0.3) && <Sparkles ink={ink} xs={[[between(r, 7, 15), between(r, 8, 17)], [between(r, 50, 58), between(r, 7, 16)]]} />}
    </g>
  );
}

/* ─── bird ───────────────────────────────────────────────────────────────── */

function bird(r: R): ReactNode {
  const W = between(r, 2.4, 3.2);
  const ink = { stroke: INK, strokeWidth: W, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  const paper = { ...ink, fill: PAPER };
  const tilt = jit(r, 4);
  const facing = chance(r, 0.5) ? 1 : -1;
  const cx = 32;
  const cy = 32 + jit(r, 1.5);
  const rx = between(r, 13, 17);
  const ry = between(r, 11, 15);
  const wob = jit(r, 0.05);
  const beak = pick(r, ['short', 'long', 'hook'] as const);
  const eye = pick(r, ['dot', 'ring', 'sleepy', 'happy'] as const);
  const crest = pick(r, ['none', 'one', 'two', 'three'] as const);
  const wing = chance(r, 0.65);
  const legs = chance(r, 0.75);
  const tail = chance(r, 0.4);
  const chest = pick(r, ['none', 'speckle', 'bib'] as const);

  return (
    <g transform={`rotate(${n(tilt)} 32 32) translate(32 32) scale(${facing} 1) translate(-32 -32)`}>
      <path d={blob(cx, cy, rx, ry, wob)} {...paper} />
      {tail && (
        <path d={`M${n(cx - rx + 2)} ${n(cy + ry * 0.2)} C${n(cx - rx - 9)} ${n(cy + ry * 0.1)} ${n(cx - rx - 8)} ${n(cy + ry + 5)} ${n(cx - rx - 1)} ${n(cy + ry * 0.8)} Z`} {...paper} />
      )}
      {crest !== 'none' && (
        <g {...ink}>
          <path d={`M${n(cx - 2)} ${n(cy - ry)} q${n(-1)} -7 ${n(3)} -9`} />
          {crest !== 'one' && <path d={`M${n(cx + 2)} ${n(cy - ry)} q${n(3)} -7 ${n(7)} -7`} />}
          {crest === 'three' && <path d={`M${n(cx - 5)} ${n(cy - ry + 1)} q${n(-4)} -5 ${n(-8)} -4`} />}
        </g>
      )}
      {/* the beak sits on the facing side */}
      {beak === 'long'
        ? <path d={`M${n(cx + rx - 2)} ${n(cy - 1)} L${n(cx + rx + 9)} ${n(cy + 2)} L${n(cx + rx - 2)} ${n(cy + 4)} Z`} {...paper} />
        : beak === 'hook'
          ? <path d={`M${n(cx + rx - 3)} ${n(cy - 2)} q8 1 8 5 q0 4 -4 5 q4 -3 2 -6 q-2 -2 -6 -1 Z`} {...paper} />
          : <path d={`M${n(cx + rx - 3)} ${n(cy)} L${n(cx + rx + 7)} ${n(cy + 2)} L${n(cx + rx - 3)} ${n(cy + 5)} Z`} {...paper} />}

      {eye === 'dot' && <circle cx={n(cx + rx * 0.35)} cy={n(cy - ry * 0.25)} r={1.7} fill={INK} />}
      {eye === 'ring' && <g><circle cx={n(cx + rx * 0.35)} cy={n(cy - ry * 0.25)} r={3.2} {...ink} /><circle cx={n(cx + rx * 0.35)} cy={n(cy - ry * 0.25)} r={1.1} fill={INK} /></g>}
      {eye === 'sleepy' && <path d={`M${n(cx + rx * 0.25)} ${n(cy - ry * 0.25)} q3 2 5 0`} {...ink} />}
      {eye === 'happy' && <path d={`M${n(cx + rx * 0.22)} ${n(cy - ry * 0.3)} q3 -3 5 0`} {...ink} />}

      {chest === 'speckle' && (
        <g fill={INK}>
          {[[-6, 4], [-1, 7], [4, 5], [-4, 10], [2, 11]].map(([x, y], i) => <circle key={i} cx={n(cx + x)} cy={n(cy + y)} r={0.9} />)}
        </g>
      )}
      {chest === 'bib' && <path d={`M${n(cx - 7)} ${n(cy + 2)} q7 5 14 0 q-1 9 -7 10 q-6 -1 -7 -10 Z`} fill={INK} />}
      {wing && <path d={`M${n(cx - rx * 0.75)} ${n(cy + ry * 0.2)} q7 7 13 3 q-5 -7 -13 -3 Z`} {...ink} strokeWidth={W * 0.8} />}
      {legs && (
        <g {...ink}>
          <path d={`M${n(cx - 4)} ${n(cy + ry)} l-1 6 M${n(cx - 5)} 61 l4 -1`} />
          <path d={`M${n(cx + 4)} ${n(cy + ry)} l1 6 M${n(cx + 3)} 62 l4 -1`} />
        </g>
      )}
      {chance(r, 0.35) && <Sparkles ink={ink} xs={[[between(r, 7, 15), between(r, 7, 16)], [between(r, 50, 58), between(r, 8, 18)]]} />}
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
  const r = rng(hash(`${pet.species}:${pet.avatar.variant}`));
  const face = pet.species === 'dog' ? dog(r) : pet.species === 'cat' ? cat(r) : bird(r);
  return (
    <svg className="pet-face" viewBox="0 0 64 64" width={size} height={size}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {face}
    </svg>
  );
}
