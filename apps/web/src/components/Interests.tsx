'use client';
/** Interest tags (RFC §10.5): shown on profiles, collabs and events; picked as chips. */
import { useEffect, useState } from 'react';
import type { Interest } from '@/lib/api';
import { interestsCached } from '@/lib/interests';

/** Slugs → their labels, in the list's order. Renders nothing for an empty list. */
export function InterestTags({ slugs, className }: { slugs: string[]; className?: string }) {
  const [all, setAll] = useState<Interest[] | null>(null);
  useEffect(() => { if (slugs.length) interestsCached().then(setAll, () => setAll([])); }, [slugs.length]);
  if (!slugs.length) return null;
  const label = (s: string) => all?.find((i) => i.slug === s)?.label ?? s;
  return (
    <ul className={`interest-tags${className ? ` ${className}` : ''}`} aria-label="Interests">
      {slugs.map((s) => <li key={s} className="tag">{label(s)}</li>)}
    </ul>
  );
}

/** Toggle chips over the whole list; `max` caps how many can be on. */
export function InterestPicker({ value, onChange, max, disabled }: {
  value: string[]; onChange: (next: string[]) => void; max: number; disabled?: boolean;
}) {
  const [all, setAll] = useState<Interest[] | null>(null);
  useEffect(() => { interestsCached().then(setAll, () => setAll([])); }, []);
  if (!all) return <p className="ui muted">Loading…</p>;
  return (
    <div className="chips" role="group" aria-label="Interests">
      {all.map((i) => {
        const on = value.includes(i.slug);
        return (
          <button key={i.slug} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
            disabled={disabled || (!on && value.length >= max)}
            onClick={() => onChange(on ? value.filter((s) => s !== i.slug) : [...value, i.slug])}>
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
