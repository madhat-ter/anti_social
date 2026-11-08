'use client';
/**
 * Visitor passes (RFC §10.8): an admin gives someone an hour of looking around. The visitor has no
 * account; the API hands the app a stand-in `me` with `visitor.expiresAt`. Everything here hangs
 * off that: the read-only switch every write control reads, the pill in the menu with the time
 * left, the window in the side rail, the code form on the landing page, and the timer that sends
 * them to the ended page the moment the hour is up.
 */
import Link from 'next/link';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { normalizeInviteCode } from '@anti/shared';
import { api, errorMessage, type Me } from '@/lib/api';
import { Avatar } from './Avatar';
import { Win } from './retro';
import { ErrorNote } from './ui';

export const VISITOR_NOTE = 'Visitors can only watch.';
/** the pill turns red with this long to go */
const SOON_MS = 5 * 60_000;

const ReadOnly = createContext(false);
/** Wraps everything a visitor sees; write controls ask `useReadOnly()` and disable themselves. */
export function ReadOnlyProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <ReadOnly.Provider value={on}>{children}</ReadOnly.Provider>;
}
export const useReadOnly = () => useContext(ReadOnly);

export const isVisitor = (me: Me | null | undefined): me is Me & { visitor: { expiresAt: string } } => !!me?.visitor;

/** Pages a visitor has no business on: their own things, the inbox, writing and editing. */
const MEMBERS_ONLY = /^\/(settings|setup|notifications|consultations|admin|events\/new|collabs\/new)|\/(edit|consult|work\/new)$/;
export const membersOnlyPath = (path: string) => MEMBERS_ONLY.test(path);

/** Re-renders every `ms` so the countdown keeps up. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function minutesLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}
function leftText(expiresAt: string, now: number): string {
  const m = minutesLeft(expiresAt, now);
  return m <= 1 ? 'under a minute left' : `${m} min left`;
}

/** The moment the hour is up, wherever they are: the ended page. The API would say so on the next request anyway. */
export function useVisitorEnd(me: Me | null | undefined) {
  const at = me?.visitor?.expiresAt;
  useEffect(() => {
    if (!at) return;
    const ms = new Date(at).getTime() - Date.now();
    const t = setTimeout(() => window.location.assign('/visit/ended'), Math.max(ms, 0) + 500);
    return () => clearTimeout(t);
  }, [at]);
}

/** In the menu where a member's face and handle go: a grey face, "Visitor", and the time left. */
export function VisitorPill({ expiresAt }: { expiresAt: string }) {
  const now = useNow(15_000);
  const soon = new Date(expiresAt).getTime() - now <= SOON_MS;
  return (
    <span className="nav-me nav-visitor" title={VISITOR_NOTE}>
      <Avatar seed={null} size={28} label="A visitor, no face yet" />
      <span className={`visitor-pill${soon ? ' soon' : ''}`} role="status" aria-live="polite">
        Visitor <span aria-hidden="true">·</span> <span className="sr-only">,</span>{leftText(expiresAt, now)}
      </span>
    </span>
  );
}

/** The side-rail window where "you" would be; on phones, the sheet behind the fifth tab. */
export function VisitorWindow({ expiresAt, onClose }: { expiresAt: string; onClose?: () => void }) {
  const now = useNow(15_000);
  const [busy, setBusy] = useState(false);
  const soon = new Date(expiresAt).getTime() - now <= SOON_MS;
  async function leave() {
    setBusy(true);
    try { await api.leaveVisit(); } catch { /* the cookie goes either way */ }
    window.location.assign('/');
  }
  return (
    <Win title="visitor" as="section" bodyClassName="rail-you" onClose={onClose}>
      <span className="rail-you-link">
        <Avatar seed={null} size={56} label="A visitor, no face yet" />
        <span>
          <span className="rail-name">Visitor</span>
          <span className={`ui ${soon ? 'visitor-soon' : 'muted'}`}>{leftText(expiresAt, now)}</span>
        </span>
      </span>
      <p className="ui muted small">You are looking around on a pass. {VISITOR_NOTE}</p>
      <button type="button" className="btn" onClick={() => void leave()} disabled={busy}>Leave</button>
    </Win>
  );
}

/**
 * Entering a code. On the landing page under the sign-in window, and on /visit/<code> with the
 * code filled in. Works once; the hour starts on entry and the pass locks to this browser.
 */
export function VisitorCodeForm({ initial = '', compact = false }: { initial?: string; compact?: boolean }) {
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.visit(code);
      window.location.assign('/');
    } catch (x) { setErr(errorMessage(x)); setBusy(false); }
  }
  const well = normalizeInviteCode(code).length === 8;
  return (
    <form className={`visit-form${compact ? ' compact' : ''}`} onSubmit={go} aria-label="Visitor code">
      {compact ? <p className="ui muted">Have a visitor code?</p> : null}
      <div className="row visit-row">
        <label className={compact ? 'sr-only' : undefined} htmlFor="visit-code">Visitor code</label>
        <input id="visit-code" className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={12} />
        <button className={`btn${compact ? '' : ' primary'}`} disabled={busy || !well}>{busy ? 'Opening…' : 'Visit for an hour'}</button>
      </div>
      <ErrorNote message={err} />
    </form>
  );
}

/** What a disabled "write" link looks like to a visitor: the same button, struck out, with the note. */
export function WatchOnly({ children, primary = true }: { children: ReactNode; primary?: boolean }) {
  return <span className={`btn${primary ? ' primary' : ''}`} aria-disabled="true" title={VISITOR_NOTE}>{children}</span>;
}

/** "Visitors can only watch" as a line, where a form would be; `banner` makes it a notice strip (phones, where the composer would be). */
export function WatchOnlyNote({ banner = false }: { banner?: boolean }) {
  return (
    <p className={banner ? 'banner notice watch-strip' : 'muted small watch-only'} role="note">
      {VISITOR_NOTE} <Link href="/join">Join with an invite</Link> to take part.
    </p>
  );
}
