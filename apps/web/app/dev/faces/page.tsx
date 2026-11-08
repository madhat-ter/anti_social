'use client';
/**
 * A sheet of generated faces, for checking the drawing (no member data): the same sample handles
 * drawn without a gender (the original faces) and as each gender (RFC §10.3).
 */
import { GENDERS, GENDER_LABEL } from '@anti/shared';
import { Avatar } from '@/components/Avatar';

const HANDLES = [
  'maya', 'theo', 'juno', 'kai', 'lena', 'omar', 'seef', 'ana_r', 'rio', 'sol', 'nadia', 'tomas',
  'iris', 'ben', 'yuki', 'arjun', 'zoe', 'leo', 'mira', 'ravi',
];

export default function Faces() {
  const rows: { label: string; gender: (typeof GENDERS)[number] | null }[] = [
    { label: 'No gender yet (original)', gender: null },
    ...GENDERS.map((g) => ({ label: GENDER_LABEL[g], gender: g })),
  ];
  return (
    <div className="stack">
      <h1>Faces</h1>
      {rows.map((r) => (
        <section key={r.label} className="stack">
          <h2 className="ui">{r.label}</h2>
          <div className="row faces-sheet">
            {HANDLES.map((h) => <Avatar key={h} seed={h} gender={r.gender} size={64} label={`@${h}`} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
