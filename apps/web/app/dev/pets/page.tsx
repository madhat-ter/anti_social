'use client';
/**
 * RFC §10.17: a sheet of drawn pet looks — 120 per species, spread across the endless variants
 * so near-duplicates show up — for checking the drawing before a member picks one. Sample pets only.
 */
import { PetAvatar } from '@/components/PetAvatar';

const SHEETS = [
  { label: 'Dogs (120 looks)', species: 'dog' as const },
  { label: 'Cats (120 looks)', species: 'cat' as const },
  { label: 'Birds (120 looks)', species: 'bird' as const },
];

/** spaced through the range, so the sheet is a fair sample rather than the first 120 seeds */
const VARIANT = (i: number) => (i * 7919) % 1_000_000;

export default function PetsSheet() {
  return (
    <div className="stack">
      <h1>Pets</h1>
      <p className="muted">Every pet face is drawn from its species and variant. There is no fixed set: any variant number draws a new look.</p>
      {SHEETS.map((s) => (
        <section key={s.species} className="stack">
          <h2 className="ui">{s.label}</h2>
          <div className="row faces-sheet">
            {Array.from({ length: 120 }, (_, i) => (
              <PetAvatar key={i} pet={{ species: s.species, avatar: { variant: VARIANT(i), url: null } }} size={56} label={`${s.species} ${VARIANT(i)}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
