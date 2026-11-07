'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RULES } from '@anti/shared';
import { api, errorMessage, type Me, type Notification } from '@/lib/api';
import { fmtDate, relativeTime } from '@/lib/hooks';
import { ErrorNote } from './ui';

/** Re-renders every `ms` so countdowns stay current. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timeLeft(untilIso: string, now = Date.now()): string {
  const ms = new Date(untilIso).getTime() - now;
  if (ms <= 0) return 'less than a minute';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${Math.max(mm, 1)}m`;
}

function Countdown({ until }: { until: string }) {
  const now = useNow();
  return <time dateTime={until} title={fmtDate(until)}>{timeLeft(until, now)}</time>;
}

/** Moves focus to the feed composer, navigating home first if needed. */
export function focusComposer(router: ReturnType<typeof useRouter>) {
  const ta = document.querySelector<HTMLTextAreaElement>('#compose textarea');
  if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); }
  else router.push('/#compose');
}

/** Shown on every seated page while the member is flagged as a lurker (RFC §5.2). */
export function LurkerBanner({ me }: { me: Me }) {
  const router = useRouter();
  const l = me.lurker;
  if (me.state !== 'flagged_lurker') return null;
  const required = l?.required ?? RULES.lurker_min_contributions;
  const done = Math.min(l?.contributions ?? 0, required);
  const met = done >= required;
  return (
    <div className="banner stack lurker" role="status">
      <div>
        <strong>Your seat is at risk.</strong>{' '}
        {met ? (
          <>Thanks — you have posted enough. Your seat is cleared at the next hourly check.</>
        ) : (
          <>
            You have been reading without posting. Post or reply {required} times
            {l ? <> in the next <Countdown until={l.graceEndsAt} /> (by {fmtDate(l.graceEndsAt)})</> : null} to keep your seat,
            or pay the stay fee for {RULES.stay_fee_exempt_days} days of exemption. Likes do not count.
          </>
        )}
      </div>
      <div className="row">
        <span className="progress" aria-label={`${done} of ${required} contributions`}>
          {Array.from({ length: required }, (_, i) => <span key={i} className={i < done ? 'pip on' : 'pip'} />)}
          <span className="small muted">{done} of {required}</span>
        </span>
        {!met && <button type="button" className="btn primary" onClick={() => focusComposer(router)}>Post something</button>}
        {!met && <button type="button" className="btn" disabled title="Payments are not open yet">Pay stay fee</button>}
      </div>
    </div>
  );
}

/** Polls /me while the user waits for a state change (seat, offer). */
export function usePollMe(refresh: () => Promise<void>, ms = 60_000) {
  useEffect(() => {
    const t = setInterval(() => void refresh(), ms);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh, ms]);
}

export function WaitlistCard({ me }: { me: Me }) {
  const w = me.waitlist;
  return (
    <div className="card stack">
      <h2>You are on the waitlist</h2>
      {w ? (
        <p>
          <span className="big">#{w.position}</span>{' '}
          <span className="muted">of {Math.max(w.total, w.position)} waiting</span>
        </p>
      ) : (
        <p className="muted">Your place in the queue is being updated.</p>
      )}
      <p>All seats are taken. When one opens you will be seated automatically and this page will turn into your feed.</p>
      <p className="muted small">
        Returning members are seated ahead of new invitees, so your number can go up as well as down.
        Sign in at least once every {RULES.waitlist_decay_days} days to keep your place.
      </p>
    </div>
  );
}

const ARCHIVE_REASON: Record<string, string> = {
  inactive: `You had not signed in for ${RULES.inactivity_days} days, so your seat went to the next person in line.`,
  lurker_grace_expired: `You did not post during the ${RULES.lurker_grace_days}-day grace period, so your seat went to the next person in line.`,
  waitlist_decay: `You had not signed in for ${RULES.waitlist_decay_days} days, so you were removed from the waitlist.`,
};

export function ArchivedCard({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const w = me.waitlist;
  const wasMember = me.archived?.wasMember ?? true;
  const reason = ARCHIVE_REASON[me.archived?.reason ?? ''] ?? '';

  async function rejoin() {
    setBusy(true); setErr(null);
    try { await api.rejoin(); await refresh(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (w?.offeredUntil) {
    return (
      <div className="card stack offer">
        <h2>A seat is being held for you</h2>
        <p><span className="big"><Countdown until={w.offeredUntil} /></span> <span className="muted">left</span></p>
        <p>Pay the reinstatement fee before {fmtDate(w.offeredUntil)} to take your seat back. If you don't, it goes to the next person in line and you can rejoin the queue.</p>
        <div className="row">
          <button type="button" className="btn primary" disabled title="Payments are not open yet">Pay to reinstate</button>
        </div>
        <p className="muted small">Payments are not open yet.</p>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h2>{wasMember ? 'Your seat was released' : 'You left the waitlist'}</h2>
      <p>{reason} Your handle, profile and posts are kept.</p>
      {w ? (
        <>
          <p>
            <span className="big">#{w.position}</span>{' '}
            <span className="muted">of {Math.max(w.total, w.position)} in the queue</span>
          </p>
          <p className="muted small">
            {w.priority === 'reinstating'
              ? `Returning members are ahead of new invitees. When a seat opens it is held for you for ${RULES.reinstate_offer_hours} hours while you pay the reinstatement fee.`
              : 'When a seat opens you will be seated automatically.'}
          </p>
        </>
      ) : (
        <>
          <p className="muted">
            {wasMember
              ? `Rejoining the queue is free and puts you ahead of new invitees. When a seat opens it is held for you for ${RULES.reinstate_offer_hours} hours, and you pay the reinstatement fee to take it.`
              : 'Rejoining is free. You will be seated automatically when a seat opens.'}
          </p>
          <div className="row">
            <button type="button" className="btn primary" onClick={rejoin} disabled={busy}>Rejoin the queue</button>
          </div>
        </>
      )}
      <ErrorNote message={err} />
    </div>
  );
}

function describeAccount(n: Notification): string | null {
  switch (n.kind) {
    case 'seat_offered': return 'A seat opened up and is being held for you.';
    case 'seat_offer_expired': return 'Your seat offer expired before payment. You can rejoin the queue.';
    // 'activated' / 'lurker_warning' belong to the seated past; on a status page they are noise.
    default: return null;
  }
}

/** Recent account updates for users without a seat (they have no notifications page). */
export function AccountUpdates() {
  const [items, setItems] = useState<Notification[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.notifications(null, 10).then((r) => {
      if (!alive) return;
      const mine = r.items.filter((n) => describeAccount(n));
      setItems(mine.slice(0, 5));
      const unread = mine.filter((n) => !n.readAt).map((n) => n.id);
      if (unread.length) api.markRead(unread).catch(() => {});
    }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items?.length) return null;
  return (
    <section className="card stack">
      <h2>Updates</h2>
      <ul className="plain stack">
        {items.map((n) => (
          <li key={n.id} className={n.readAt ? undefined : 'unread'}>
            {describeAccount(n)} <time className="muted small" dateTime={n.createdAt} title={fmtDate(n.createdAt)}>{relativeTime(n.createdAt)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
