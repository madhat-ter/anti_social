'use client';
/**
 * Picks: members suggest a movie, book, place or food. The pick.txt window shows a random
 * one, changing every minute (or now, with "Another"); "Suggest" adds yours. People who tried it
 * vote good / not for me, with an optional remark.
 */
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PICK_NO_REPEAT, PICK_ROTATE_MS, SUGGESTION_NOTE_MAX, SUGGESTION_REMARK_MAX, SUGGESTION_TITLE_MAX } from '@anti/shared';
import { api, errorMessage, type Pick, type PickRemark, type SuggestionKind } from '@/lib/api';
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

/** 👍 12 · 👎 3 */
function Tally({ p }: { p: Pick }) {
  return (
    <span className="pick-tally ui" aria-label={`${p.up} tried it and liked it, ${p.down} tried it and did not`}>
      <span aria-hidden="true">👍 {p.up} · 👎 {p.down}</span>
    </span>
  );
}

/**
 * One pick, as shown in the window and on profiles: what it is, who suggested it, how the people
 * who tried it voted, the newest remark, and (not on your own) "Tried it" buttons.
 * `onEditing` reports while a remark is being written, so the window holds still.
 */
export function PickCard({ p, showAuthor = true, onChange, onEditing }: {
  p: Pick; showAuthor?: boolean; onChange?: (p: Pick) => void; onEditing?: (editing: boolean) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const holding = writing || listing;
  useEffect(() => { onEditing?.(holding); }, [holding, onEditing]);
  // a different pick on screen: start clean
  useEffect(() => { setWriting(false); setErr(null); }, [p.id]);

  async function vote(v: 1 | -1) {
    setBusy(true); setErr(null);
    try {
      // pressing your current vote again takes it back
      if (p.myVote === v) { onChange?.(await api.unvotePick(p.id)); setWriting(false); }
      else { onChange?.(await api.votePick(p.id, v)); setText(p.myRemark ?? ''); setWriting(true); }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function saveRemark() {
    if (!p.myVote) return;
    setBusy(true); setErr(null);
    try { onChange?.(await api.votePick(p.id, p.myVote, text)); setWriting(false); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const lr = p.latestRemark;
  return (
    <figure className="pick">
      <figcaption className="pick-kind"><KindIcon kind={p.kind} /> {labelOf(p.kind)}</figcaption>
      <p className="pick-title">{p.title}</p>
      {p.note && <p className="pick-note">{p.note}</p>}
      {showAuthor && p.author && (
        <Link href={`/u/${p.author.handle}`} className="pick-by">
          <Avatar seed={p.author.handle} gender={p.author.gender} size={28} /> <span className="ui">@{p.author.handle}</span>
        </Link>
      )}
      <div className="pick-votes">
        <Tally p={p} />
        {lr?.remark && (
          <p className="pick-remark">
            <Link href={`/u/${lr.handle}`} className="ui">@{lr.handle}</Link> <span aria-label={lr.vote === 1 ? 'liked it' : 'not for them'}>{lr.vote === 1 ? '👍' : '👎'}</span>{' '}
            &ldquo;{lr.remark}&rdquo;
          </p>
        )}
        {(p.up + p.down > 0) && (
          <button type="button" className="link-btn pick-all" onClick={() => setListing(true)}>
            All remarks{p.remarkCount ? ` (${p.remarkCount})` : ''}
          </button>
        )}
      </div>
      {!p.mine && onChange && (
        <div className="pick-tried">
          <span className="ui muted">Tried it?</span>
          <div className="row">
            <button type="button" className={`btn pick-vote${p.myVote === 1 ? ' on' : ''}`} aria-pressed={p.myVote === 1} disabled={busy} onClick={() => void vote(1)}>👍 Good</button>
            <button type="button" className={`btn pick-vote${p.myVote === -1 ? ' on' : ''}`} aria-pressed={p.myVote === -1} disabled={busy} onClick={() => void vote(-1)}>👎 Not for me</button>
          </div>
          {p.myVote && !writing && (
            <button type="button" className="link-btn" onClick={() => { setText(p.myRemark ?? ''); setWriting(true); }}>
              {p.myRemark ? 'Edit your remark' : 'Add a remark'}
            </button>
          )}
          {writing && (
            <div className="stack pick-remark-form">
              <label>A remark (optional)
                <textarea rows={2} maxLength={SUGGESTION_REMARK_MAX} value={text} autoFocus
                  placeholder={p.myVote === 1 ? 'Why it is worth it' : 'Why it was not for you'} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="row between">
                <span className="counter">{text.length}/{SUGGESTION_REMARK_MAX}</span>
                <span className="row">
                  <button type="button" className="btn" onClick={() => setWriting(false)}>Skip</button>
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void saveRemark()}>Save</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      <ErrorNote message={err} />
      <RemarksDialog open={listing} pickId={p.id} title={p.title} onClose={() => setListing(false)} onChanged={(np) => onChange?.(np)} />
    </figure>
  );
}

/** Everyone who tried it: face, name, vote, remark. Admins can remove a remark. */
function RemarksDialog({ open, pickId, title, onClose, onChanged }: {
  open: boolean; pickId: string; title: string; onClose: () => void; onChanged: (p: Pick) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [data, setData] = useState<{ items: PickRemark[]; canModerate: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await api.pickRemarks(pickId); setData(r); onChanged(r.pick); } catch (e) { setErr(errorMessage(e)); }
  }, [pickId, onChanged]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setData(null); setErr(null); setConfirming(null); d.showModal(); void load(); }
    if (!open && d.open) d.close();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(handle: string) {
    setConfirming(null);
    try { await api.opsRemoveRemark(pickId, handle); await load(); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <dialog ref={ref} className="dlg remarks-dlg" aria-labelledby={`${id}-t`}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="win">
        <div className="win-bar">
          <button type="button" className="win-close" onClick={onClose} aria-label="Close" />
          <span className="win-title" id={`${id}-t`}>Tried: {title}</span>
        </div>
        <div className="win-body stack">
          {err && <ErrorNote message={err} />}
          {!data ? <p className="ui muted">Loading…</p> : data.items.length === 0 ? <p className="muted">Nobody has tried it yet.</p> : (
            <ul className="remarks">
              {data.items.map((r) => (
                <li key={r.handle}>
                  <Avatar seed={r.handle} gender={r.gender} size={36} />
                  <span className="remarks-main">
                    <span><Link href={`/u/${r.handle}`} className="name">{r.displayName}</Link> <span className="muted ui">@{r.handle}</span>{' '}
                      <span aria-label={r.vote === 1 ? 'liked it' : 'not for them'}>{r.vote === 1 ? '👍' : '👎'}</span></span>
                    {r.remark ? <span>{r.remark}</span> : <span className="muted small">No remark.</span>}
                  </span>
                  {data.canModerate && r.remark && (
                    confirming === r.handle
                      ? <button type="button" className="btn danger" onClick={() => void remove(r.handle)}>Remove?</button>
                      : <button type="button" className="link-btn" onClick={() => setConfirming(r.handle)}>Remove (admin)</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="row dlg-actions"><button type="button" className="btn default" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </dialog>
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

/** The tab is in front (the window holds still while it is in the background). */
function useVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * The pick window: a new pick every minute on its own, or now with "Another" (which restarts
 * the minute). It holds still while the pointer is over it, a remark is being written or a
 * dialog is open, and while the tab is in the background. The last few
 * picks seen are not repeated.
 */
export function PickWindow({ className }: { className?: string }) {
  const [item, setItem] = useState<Pick | null | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const visible = useVisible();
  const seen = useRef<string[]>([]); // newest first; [0] is the one on screen

  const next = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.randomPick(seen.current);
      if (r.item) {
        setItem(r.item);
        seen.current = [r.item.id, ...seen.current.filter((x) => x !== r.item!.id)].slice(0, PICK_NO_REPEAT);
      } else if (!seen.current.length) setItem(null); // nothing at all yet
    } catch (e) { setErr(errorMessage(e)); setItem((cur) => (cur === undefined ? null : cur)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void next(); }, [next]);

  const paused = hover || editing || asking || !visible;
  useEffect(() => {
    if (!item || paused) return;
    const t = setTimeout(() => void next(), PICK_ROTATE_MS);
    return () => clearTimeout(t);
  }, [item, paused, next]);

  const onEditing = useCallback((e: boolean) => setEditing(e), []);
  return (
    <Win title="pick.txt" as="aside" className={`pick-win${className ? ` ${className}` : ''}`} bodyClassName="stack">
      <div
        className="pick-holder"
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      >
        <div aria-live="polite">
          {item === undefined ? <p className="ui muted">Picking one…</p>
            : item === null ? <p className="muted small">No picks yet. Suggest a movie, a book, a place or something to eat.</p>
            : <PickCard p={item} onChange={setItem} onEditing={onEditing} />}
        </div>
      </div>
      <ErrorNote message={err} />
      <div className="row between">
        <button type="button" className="btn" onClick={() => void next()} disabled={busy || !item}>Another</button>
        <button type="button" className="btn primary" onClick={() => setAsking(true)}>+ Suggest</button>
      </div>
      <SuggestDialog
        open={asking}
        onClose={() => setAsking(false)}
        onCreated={(p) => { setAsking(false); setItem(p); seen.current = [p.id, ...seen.current].slice(0, PICK_NO_REPEAT); }}
      />
    </Win>
  );
}
export function SuggestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Pick) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [kind, setKind] = useState<SuggestionKind>('movie');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTitle(''); setNote(''); setErr(null); d.showModal();
      // jump to the name field only with a mouse/trackpad: on touch screens focusing it pops the
      // on-screen keyboard over the dialog before the member has even picked a kind
      if (window.matchMedia('(pointer: fine)').matches) titleRef.current?.focus();
    }
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={SUGGESTION_TITLE_MAX} placeholder={ph} required ref={titleRef} />
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
