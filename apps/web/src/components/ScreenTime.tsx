'use client';
/**
 * Screen time (RFC §10.10): half an hour of looking, then an hour away. The timer in the header
 * counts the seconds the tab is in front; every 30 s (and when the tab goes to the background)
 * the page tells the API, which keeps the tally per member so the half hour follows them across
 * tabs and devices. Nudges at 10, 20 and 25 minutes; at 30 the lock window replaces every page
 * until the hour is up. Visitors (RFC §10.8) have their own hour and are left alone.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RULES } from '@anti/shared';
import { api, type Me, type ScreenState } from '@/lib/api';
import { AlertDialog, Win } from './retro';
import { isVisitor } from './Visitor';

const BEAT_S = 30;
const NUDGES: { at: number; title: string; text: string; button: string }[] = [
  { at: RULES.screen_time_nudges_s[0]!, title: 'ten_minutes', text: 'Ten minutes. Everything new was at the top; the rest you have seen. Go and make something worth posting.', button: 'Fine' },
  { at: RULES.screen_time_nudges_s[1]!, title: 'twenty_minutes', text: 'Twenty minutes. Nobody here will mind if you leave: they are not here either. Ten left.', button: 'Ten more' },
  { at: RULES.screen_time_nudges_s[2]!, title: 'five_to_go', text: 'Five minutes to go. Say the thing you came to say, then go outside.', button: 'Last five' },
];

export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** Wraps a signed-in member's pages: the header timer, the nudges, and the lock when the half hour is spent. */
export function ScreenTime({ me, children }: { me: Me; children: ReactNode }) {
  if (isVisitor(me)) return <>{children}</>;
  return <Timed me={me}>{children}</Timed>;
}

function Timed({ me, children }: { me: Me; children: ReactNode }) {
  const [state, setState] = useState<ScreenState | null>(null);
  const [extra, setExtra] = useState(0); // visible seconds not yet reported
  const extraRef = useRef(0);
  const [nudge, setNudge] = useState<number | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const beating = useRef(false);

  const load = useCallback(() => { api.screenTime().then(setState, () => {}); }, []);
  useEffect(() => { load(); setSlot(document.getElementById('top-center')); }, [load]);

  // the API said "rest_time" to some other request: find out where we stand
  useEffect(() => {
    window.addEventListener('anti:rest', load);
    return () => window.removeEventListener('anti:rest', load);
  }, [load]);

  const beat = useCallback(async () => {
    const s = extraRef.current;
    if (s <= 0 || beating.current) return;
    beating.current = true;
    try {
      const next = await api.screenBeat(s);
      extraRef.current = Math.max(0, extraRef.current - s);
      setExtra(extraRef.current);
      setState(next);
    } catch { /* the next beat carries it */ } finally { beating.current = false; }
  }, []);

  const exempt = !!state?.exempt; // an admin: the timer counts on, nothing locks
  const locked = !exempt && !!state?.lockedUntil && new Date(state.lockedUntil).getTime() > now;
  const limit = state?.limitSeconds ?? RULES.screen_time_limit_s;

  // one tick a second while the tab is in front; a beat every 30 s and when it goes to the back
  useEffect(() => {
    if (!state || locked) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState !== 'visible') return;
      extraRef.current += 1;
      setExtra(extraRef.current);
      if (extraRef.current >= BEAT_S || (!exempt && state.usedSeconds + extraRef.current >= limit)) void beat();
    }, 1000);
    const onHide = () => { if (document.visibilityState === 'hidden') void beat(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onHide); };
  }, [state, locked, limit, exempt, beat]);

  // the rest counts down on the lock screen; when it ends, ask again and the fresh half hour begins
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (new Date(state!.lockedUntil!).getTime() <= Date.now()) { extraRef.current = 0; setExtra(0); load(); }
    }, 1000);
    return () => clearInterval(t);
  }, [locked, state, load]);

  const used = exempt ? (state?.usedSeconds ?? 0) + extra : Math.min(limit, (state?.usedSeconds ?? 0) + extra);

  // nudges: once each per half hour, remembered on this device by the window's start
  useEffect(() => {
    if (!state || locked) return;
    const key = `anti:nudged:${state.windowStartedAt ?? 'none'}`;
    let seen: number[] = [];
    try { seen = JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { /* fine */ }
    const due = NUDGES.findIndex((n, i) => used >= n.at && !seen.includes(i));
    if (due >= 0 && nudge === null) {
      setNudge(due);
      try { sessionStorage.setItem(key, JSON.stringify([...seen, due])); } catch { /* fine */ }
    }
  }, [used, state, locked, nudge]);

  const soon = used >= limit - 300;
  const pill = state && (
    <span className={`time-pill${locked ? ' rest' : soon ? ' soon' : ''}`} role="timer"
      aria-label={locked ? `Locked out, ${mmss(Math.ceil((new Date(state.lockedUntil!).getTime() - now) / 1000))} to go` : `${mmss(used)} of your half hour used`}
      title={locked ? 'Come back when this reaches zero.' : exempt ? 'Your time on the site. Admins are reminded, never locked out.' : 'Your half hour on the site. Then an hour away.'}>
      {locked ? `rest ${mmss(Math.ceil((new Date(state.lockedUntil!).getTime() - now) / 1000))}` : mmss(used)}
    </span>
  );

  if (locked && state) return (
    <>
      {slot && createPortal(pill, slot)}
      <Locked until={state.lockedUntil!} now={now} />
    </>
  );
  return (
    <>
      {slot && createPortal(pill, slot)}
      {children}
      <AlertDialog
        open={nudge !== null}
        title={nudge !== null ? NUDGES[nudge]!.title : ''}
        message={nudge !== null ? NUDGES[nudge]!.text : ''}
        confirmLabel={nudge !== null ? NUDGES[nudge]!.button : 'OK'}
        cancelLabel={null}
        onConfirm={() => setNudge(null)}
        onCancel={() => setNudge(null)}
      />
    </>
  );
}

/** The half hour is spent: one window, a countdown, and the door out. */
function Locked({ until, now }: { until: string; now: number }) {
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
  async function signOut() {
    setBusy(true);
    try { await api.logout(); } finally { window.location.assign('/'); }
  }
  return (
    <div className="stack locked">
      <h1>That is your half hour</h1>
      <Win title="half_hour_up" dark bodyClassName="stack">
        <p className="dlg-msg">The door opens again in <strong className="ui">{mmss(left)}</strong>. Go and do something that is not this.</p>
        <p className="muted small">Thirty minutes of looking, then an hour away: that is the deal here. Nothing you were writing is lost; drafts wait on this device.</p>
        <div className="row dlg-actions">
          <button type="button" className="btn" onClick={() => void signOut()} disabled={busy}>Sign out</button>
        </div>
      </Win>
    </div>
  );
}
