'use client';
/** Interest tags (RFC §10.5): shown on profiles, collabs and events; picked as chips. */
import { useEffect, useState } from 'react';
import { api, errorMessage, type Interest } from '@/lib/api';
import { interestsCached } from '@/lib/interests';
import { ErrorNote } from './ui';

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

/**
 * Toggle chips over the whole list; `max` caps how many can be on. Anything missing can be added
 * ("Add your own"): it joins the shared list for everyone and is switched on here.
 */
export function InterestPicker({ value, onChange, max, disabled }: {
  value: string[]; onChange: (next: string[]) => void; max: number; disabled?: boolean;
}) {
  const [all, setAll] = useState<Interest[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { interestsCached().then(setAll, () => setAll([])); }, []);

  async function add(e: { preventDefault(): void }) {
    e.preventDefault();
    if (label.trim().length < 2) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await api.addInterest(label);
      setAll(await interestsCached(true));
      setLabel(''); setAdding(false);
      if (value.includes(r.slug)) setNote(`"${r.label}" is already on.`);
      else if (value.length >= max) setNote(`"${r.label}" is on the list now. You have ${max} picked: switch one off to pick it.`);
      else { onChange([...value, r.slug]); setNote(r.added ? `Added "${r.label}" for everyone, and picked it.` : `"${r.label}" was already on the list: picked it.`); }
    } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }

  if (!all) return <p className="ui muted">Loading…</p>;
  return (
    <div className="stack interest-picker">
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
        {!adding && (
          <button type="button" className="chip add" disabled={disabled} onClick={() => { setAdding(true); setNote(null); }}>+ Add your own</button>
        )}
      </div>
      {adding && (
        // a div, not a form: the picker sits inside other forms (collabs, events)
        <div className="row interest-add" role="group" aria-label="Add an interest">
          <input aria-label="New interest" value={label} maxLength={30} placeholder="Not on the list? e.g. Bonsai" autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(e); if (e.key === 'Escape') setAdding(false); }} />
          <button type="button" className="btn" disabled={busy || label.trim().length < 2} onClick={(e) => void add(e)}>{busy ? 'Adding…' : 'Add'}</button>
          <button type="button" className="link-btn" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
        </div>
      )}
      {note && <p className="muted small" role="status">{note}</p>}
      <ErrorNote message={err} />
    </div>
  );
}
