'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type EventDetail } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { eventWhen, MyStatus, spotsText } from '@/components/Events';
import { AlertDialog, Loading } from '@/components/retro';
import { Avatar } from '@/components/Avatar';

export default function EventPage() {
  return <SeatedShell>{() => <EventView />}</SeatedShell>;
}

function EventView() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);

  const load = useCallback(async () => {
    try { setEv(await api.event(id)); } catch (e) { setErr(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!ev) return err ? <><ErrorNote message={err} /><p><Link href="/events">Back to events</Link></p></> : <Loading />;

  const going = ev.my?.status === 'going';
  const waiting = ev.my?.status === 'waitlisted';
  const full = ev.capacity !== null && ev.goingCount >= ev.capacity;

  const start = new Date(ev.startsAt);
  return (
    <>
      <p><Link href="/events" className="ui">Back to events</Link></p>
      <article className="stack event-detail">
        {ev.cancelledAt && <div className="banner" role="status">This event was cancelled.</div>}
        <header className="event-poster">
          <span className="date-chip" aria-hidden>
            <span className="m">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
            <span className="d">{start.getDate()}</span>
          </span>
          <div>
            <h1>{ev.title}</h1>
            <MyStatus e={ev} />
          </div>
        </header>
        {ev.description && <p className="body event-desc">{ev.description}</p>}
        <dl className="facts">
          <dt>When</dt><dd>{eventWhen(ev.startsAt, ev.endsAt)}</dd>
          <dt>Where</dt>
          <dd>
            {ev.location ?? <span className="muted">Shared with people who are going.</span>}
            {ev.locationRsvpOnly && ev.location && <span className="tag" title="Only the host and people going can see this">private</span>}
          </dd>
          {ev.host && <><dt>Host</dt><dd><Link href={`/u/${ev.host.handle}`}>@{ev.host.handle}</Link></dd></>}
          <dt>Spots</dt><dd>{spotsText(ev)}</dd>
          {(ev.priceNote || ev.externalPaymentUrl) && (
            <>
              <dt>Cost</dt>
              <dd>
                {ev.priceNote}{ev.priceNote && ev.externalPaymentUrl ? '. ' : ''}
                {ev.externalPaymentUrl && <><a href={ev.externalPaymentUrl} target="_blank" rel="noopener noreferrer nofollow">Payment link</a> (paid to the host, not anti)</>}
              </dd>
            </>
          )}
        </dl>

        <ErrorNote message={err} />
        <div className="row">
          {!ev.isHost && ev.rsvpOpen && !going && !waiting && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.rsvp(id))}>
              {full ? 'Join the waitlist' : "I'm going"}
            </button>
          )}
          {!ev.isHost && ev.rsvpOpen && (going || waiting) && (
            <button className="btn" disabled={busy} onClick={() => act(() => api.leaveEvent(id))}>
              {going ? "Can't make it" : 'Leave the waitlist'}
            </button>
          )}
          {ev.canEdit && <Link className="btn" href={`/events/${id}/edit`}>Edit</Link>}
          {ev.canEdit && (
            <button className="btn danger" disabled={busy} onClick={() => setAskCancel(true)}>Cancel event</button>
          )}
        </div>
        {waiting && <p className="muted small">You are #{ev.my!.waitlistPosition} on the waitlist. If a spot opens you move up automatically and get a notification.</p>}
      </article>
      <AlertDialog
        open={askCancel}
        title="Cancel event"
        message="Cancel this event? Everyone who said they were going gets a notification."
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        danger
        onConfirm={() => { setAskCancel(false); void act(() => api.cancelEvent(id)); }}
        onCancel={() => setAskCancel(false)}
      />

      {ev.canConfirmAttendance
        ? <Attendance ev={ev} onSaved={load} />
        : <People title={`Going (${ev.goingCount})`} people={ev.going} showAttended={ev.started} />}
      {ev.waitlist && ev.waitlist.length > 0 && <People title={`Waitlist (${ev.waitlist.length})`} people={ev.waitlist} showAttended={false} />}
    </>
  );
}

function People({ title, people, showAttended }: { title: string; people: EventDetail['going']; showAttended: boolean }) {
  return (
    <section className="stack">
      <h2 className="section-h">{title}</h2>
      {people.length === 0 ? <p className="muted">Nobody yet. Be the first.</p> : (
        <ul className="crowd">
          {people.map((p) => (
            <li key={p.handle}>
              <Link href={`/u/${p.handle}`}>
                <Avatar seed={p.handle} size={64} />
                <span className="crowd-name">{p.displayName}</span>
              </Link>
              {showAttended && p.attended && <span className="tag on">came</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Host-only, from the start until 14 days after: tick who actually came. */
function Attendance({ ev, onSaved }: { ev: EventDetail; onSaved: () => Promise<void> }) {
  const [picked, setPicked] = useState(() => new Set(ev.going.filter((p) => p.attended).map((p) => p.handle)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toggle = (h: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(h)) n.delete(h); else n.add(h);
    return n;
  });
  return (
    <section className="card stack">
      <h2>Who came?</h2>
      <p className="muted small">Confirming attendance counts as taking part for each person you tick, and for you as host. You can change this until {fmtDate(new Date(new Date(ev.startsAt).getTime() + 14 * 86_400_000).toISOString())}.</p>
      {ev.going.length === 0 ? <p className="muted">Nobody RSVP&apos;d.</p> : (
        <ul className="list">
          {ev.going.map((p) => (
            <li key={p.handle}>
              <label className="check">
                <input type="checkbox" checked={picked.has(p.handle)} onChange={() => { toggle(p.handle); setSaved(false); }} />
                {p.displayName} <span className="muted">@{p.handle}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={err} />
      <div className="row">
        <button className="btn primary" disabled={busy || ev.going.length === 0} onClick={async () => {
          setBusy(true); setErr(null);
          try { await api.confirmAttendance(ev.id, [...picked]); await onSaved(); setSaved(true); }
          catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Save attendance</button>
        {saved && <span className="muted" role="status">Saved.</span>}
      </div>
    </section>
  );
}
