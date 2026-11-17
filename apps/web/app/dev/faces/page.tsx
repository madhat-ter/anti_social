'use client';
/**
 * A sheet of generated faces, for checking the drawing (no member data): two hundred women, two
 * hundred men and a hundred neutral faces from made-up handles, so a wrong-reading face can be
 * spotted before anyone gets it. The three hair sets never overlap (Avatar.tsx).
 */
import { Avatar } from '@/components/Avatar';
import type { Gender } from '@anti/shared';

const seeds = (n: number, salt: string) => Array.from({ length: n }, (_, i) => `${salt}${i + 1}`);
const SHEETS: { label: string; gender: Gender | null; n: number; salt: string }[] = [
  { label: 'Women (200)', gender: 'woman', n: 200, salt: 'w' },
  { label: 'Men (200)', gender: 'man', n: 200, salt: 'm' },
  { label: 'Neutral: non-binary, prefer not to say, not set up yet (100)', gender: 'nonbinary', n: 100, salt: 'n' },
];

export default function Faces() {
  return (
    <div className="stack">
      <h1>Faces</h1>
      <p className="muted">Every face is drawn from a handle and a gender. These are sample handles; a member's face comes from theirs.</p>
      {SHEETS.map((s) => (
        <section key={s.label} className="stack">
          <h2 className="ui">{s.label}</h2>
          <div className="row faces-sheet">
            {seeds(s.n, s.salt).map((h) => <Avatar key={h} seed={h} gender={s.gender} size={56} label={`@${h}`} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
