'use client';
/**
 * Picks: members suggest a movie, book, place or food. The pick.txt window shows a random
 * one from a random member; "Another" swaps it, "Suggest" adds yours.
 */
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SUGGESTION_NOTE_MAX, SUGGESTION_TITLE_MAX } from '@anti/shared';
import { api, errorMessage, type Pick, type SuggestionKind } from '@/lib/api';
import { Avatar } from './Avatar';
import { Win } from './retro';
import { ErrorNote } from './ui';

export const KINDS: { kind: SuggestionKind; label: string; placeholder: string }[] = [
  { kind: 'movie', label: 'Movie', placeholder: 'Perfect Days' },
  { kind: 'book', label: 'Book', placeholder: 'Piranesi' },
  { kind: 'place', label: 'Place', placeholder: 'The lido, after 7pm' },
  { kind: 'food', label: 'Food', placeholder: 'Khao soi at Mae' },
];
const labelOf = (k: SuggestionKind) => KINDS.find((x) => x.kind === k)?.label ?? k;

/** 1-bit icons, drawn to match the alert triangle. */
export function KindIcon({ kind, size = 22 }: { kind: SuggestionKind; size?: number }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="kind-icon">
      {kind === 'movie' && (<>
        <rect x="3" y="10" width="18" height="11" {...s} fill="var(--paper)" />
        <path d="M3 9.5 L19.5 4.5 L20.5 7.8 L4 12.8 Z" {...s} fill="currentColor" />
        <path d="M8 8 L10 11.2 M13 6.5 L15 9.7" stroke="var(--paper)" strokeWidth="2" />
      </>)}
      {kind === 'book' && (<>
        <path d="M12 6.5 C9.5 4.7 6 4.5 3 5.5 V19 C6 18 9.5 18.3 12 20 C14.5 18.3 18 18 21 19 V5.5 C18 4.5 14.5 4.7 12 6.5 Z" {...s} fill="var(--paper)" />
        <path d="M12 6.5 V20" {...s} />
      </>)}
      {kind === 'place' && (<>
        <path d="M12 21.5 C12 21.5 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21.5 12 21.5 Z" {...s} fill="currentColor" />
        <circle cx="12" cy="9.5" r="2.6" fill="var(--paper)" />
      </>)}
      {kind === 'food' && (<>
        <path d="M3 13 H21 C21 17.5 17 20.5 12 20.5 C7 20.5 3 17.5 3 13 Z" {...s} fill="currentColor" />
        <path d="M13 3 L17.5 12 M16.5 2.5 L20 12" {...s} />
      </>)}
    </svg>
  );
}

/** One pick, as shown in the window and on profiles. */
export function PickCard({ p, showAuthor = true }: { p: Pick; showAuthor?: boolean }) {
  return (
    <figure className="pick">
      <figcaption className="pick-kind"><KindIcon kind={p.kind} /> {labelOf(p.kind)}</figcaption>
      <p className="pick-title">{p.title}</p>
      {p.note && <p className="pick-note">{p.note}</p>}
      {showAuthor && p.author && (
        <Link href={`/u/${p.author.handle}`} className="pick-by">
          <Avatar seed={p.author.handle} size={28} /> <span className="ui">@{p.author.handle}</span>
        </Link>
      )}
    </figure>
  );
}

/** Wide screens show the window in the left column; narrow screens in the feed. */
export function useWide(query = '(min-width: 900px)') {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

export function PickWindow({ className }: { className?: string }) {
  const [item, setItem] = useState<Pick | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = useRef<string | null>(null);

  const next = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.randomPick(shown.current);
      // only one pick exists and it is on screen: keep showing it
      if (r.item || !shown.current) { setItem(r.item); shown.current = r.item?.id ?? null; }
    } catch (e) { setErr(errorMessage(e)); if (item === undefined) setItem(null); }
    finally { setBusy(false); }
  }, [item]);

  useEffect(() => { void next(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Win title="pick.txt" as="aside" className={`pick-win${className ? ` ${className}` : ''}`} bodyClassName="stack">
      <div aria-live="polite">
        {item === undefined ? <p className="ui muted">Picking one…</p>
          : item === null ? <p className="muted small">No picks yet. Suggest a movie, a book, a place or something to eat.</p>
          : <PickCard p={item} />}
      </div>
      <ErrorNote message={err} />
      <div className="row between">
        <button type="button" className="btn" onClick={() => void next()} disabled={busy || !item}>Another</button>
        <button type="button" className="btn primary" onClick={() => setAsking(true)}>+ Suggest</button>
      </div>
      <SuggestDialog
        open={asking}
        onClose={() => setAsking(false)}
        onCreated={(p) => { setAsking(false); setItem(p); shown.current = p.id; }}
      />
    </Win>
  );
}

function SuggestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Pick) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [kind, setKind] = useState<SuggestionKind>('movie');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setTitle(''); setNote(''); setErr(null); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);

  const ph = KINDS.find((k) => k.kind === kind)!.placeholder;
  return (
    <dialog
      ref={ref} className="dlg" aria-labelledby={`${id}-t`}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <form className="win" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { onCreated(await api.suggest({ kind, title: title.trim(), note: note.trim() || null })); }
        catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        <div className="win-bar">
          <button type="button" className="win-close" onClick={onClose} aria-label="Close" />
          <span className="win-title" id={`${id}-t`}>Suggest something</span>
        </div>
        <div className="win-body stack">
          <fieldset className="kinds">
            <legend>What is it?</legend>
            {KINDS.map((k) => (
              <label key={k.kind} className={`kind-opt${kind === k.kind ? ' on' : ''}`}>
                <input type="radio" name={`${id}-kind`} value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="sr-only" />
                <KindIcon kind={k.kind} size={26} />
                {k.label}
              </label>
            ))}
          </fieldset>
          <label>Name it
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SUGGESTION_TITLE_MAX} placeholder={ph} required autoFocus />
          </label>
          <label>Why? (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={SUGGESTION_NOTE_MAX} placeholder="One line, for the rest of the room" />
          </label>
          <ErrorNote message={err} />
          <div className="row dlg-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn default" disabled={busy || !title.trim()}>{busy ? 'Suggesting…' : 'Suggest'}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
