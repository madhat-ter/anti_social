'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type EventDetail } from '@/lib/api';
import { fmtDate } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { eventWhen, MyStatus, spotsText } from '@/components/Events';
import { Loading } from '@/components/retro';

export default function EventPage() {
  return <SeatedShell>{() => <EventView />}</SeatedShell>;
}

function EventView() {
  const { id } = useParams<{ id: string }>();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <>
      <p><Link href="/events">Back to events</Link></p>
      <article className="card stack event-detail">
        {ev.cancelledAt && <div className="banner" role="status">This event was cancelled.</div>}
        <h1>{ev.title} <MyStatus e={ev} /></h1>
        <p className="when">{eventWhen(ev.startsAt, ev.endsAt)}</p>
        <p>
          {ev.location ?? <span className="muted">The location is shared with people who are going.</span>}
          {ev.locationRsvpOnly && ev.location && <span className="tag" title="Only the host and people going can see this">private</span>}
        </p>
        {ev.host && <p className="muted">Hosted by <Link href={`/u/${ev.host.handle}`}>@{ev.host.handle}</Link></p>}
        {ev.description && <p className="body">{ev.description}</p>}
        {(ev.priceNote || ev.externalPaymentUrl) && (
          <p className="muted">
            {ev.priceNote}
            {ev.externalPaymentUrl && <> · <a href={ev.externalPaymentUrl} target="_blank" rel="noopener noreferrer nofollow">Payment link</a> (paid to the host, not anti)</>}
          </p>
        )}
        <p className="muted small">{spotsText(ev)}</p>

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
            <button className="btn danger" disabled={busy} onClick={() => {
              if (window.confirm('Cancel this event? Everyone who RSVP\'d will be notified.')) void act(() => api.cancelEvent(id));
            }}>Cancel event</button>
          )}
        </div>
        {waiting && <p className="muted small">You are #{ev.my!.waitlistPosition} on the waitlist. If a spot opens you move up automatically and get a notification.</p>}
      </article>

      {ev.canConfirmAttendance
        ? <Attendance ev={ev} onSaved={load} />
        : <People title={`Going (${ev.goingCount})`} people={ev.going} showAttended={ev.started} />}
      {ev.waitlist && ev.waitlist.length > 0 && <People title={`Waitlist (${ev.waitlist.length})`} people={ev.waitlist} showAttended={false} />}
    </>
  );
}

function People({ title, people, showAttended }: { title: string; people: EventDetail['going']; showAttended: boolean }) {
  return (
    <section className="card stack">
      <h2>{title}</h2>
      {people.length === 0 ? <p className="muted">Nobody yet.</p> : (
        <ul className="list">
          {people.map((p) => (
            <li key={p.handle}>
              <Link href={`/u/${p.handle}`}>{p.displayName} <span className="muted">@{p.handle}</span></Link>
              {showAttended && p.attended && <span className="tag on">attended</span>}
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
