'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_PRICE_NOTE_MAX, EVENT_TITLE_MAX, EVENT_CAPACITY_MAX,
} from '@anti/shared';
import { errorMessage, type AnEvent, type EventInput } from '@/lib/api';
import { ErrorNote } from './ui';

/** "Sat, Nov 14 · 10:00 AM – 12:00 PM" in the viewer's time zone. */
export function eventWhen(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  const day = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return `${day}, ${t(s)}`;
  const e = new Date(endsAt);
  const sameDay = e.toDateString() === s.toDateString();
  return sameDay ? `${day}, ${t(s)} – ${t(e)}` : `${day}, ${t(s)} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t(e)}`;
}

export function spotsText(e: AnEvent): string {
  if (e.started) return e.attendedCount > 0 ? `${e.attendedCount} attended` : `${e.goingCount} going`;
  if (e.capacity === null) return `${e.goingCount} going`;
  const left = Math.max(e.capacity - e.goingCount, 0);
  return left > 0 ? `${e.goingCount} going, ${left} of ${e.capacity} spots left` : `Full, ${e.waitlistCount} on the waitlist`;
}

export function MyStatus({ e }: { e: AnEvent }) {
  if (e.isHost) return <span className="tag">hosting</span>;
  if (!e.my || e.my.status === 'cancelled') return null;
  if (e.my.status === 'going') return <span className="tag on">{e.my.attended ? 'attended' : 'going'}</span>;
  return <span className="tag">waitlist #{e.my.waitlistPosition}</span>;
}

export function EventCard({ e }: { e: AnEvent }) {
  const start = new Date(e.startsAt);
  return (
    <li className="event-card">
      <Link href={`/events/${e.id}`} className="event-link">
        <span className="date-chip" aria-hidden>
          <span className="m">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
          <span className="d">{start.getDate()}</span>
        </span>
        <span className="event-main">
          <span className="event-title">{e.title} <MyStatus e={e} />{e.cancelledAt && <span className="tag danger">cancelled</span>}</span>
          <span className="muted small">{eventWhen(e.startsAt, e.endsAt)}</span>
          <span className="muted small">{e.location ?? 'Location shared with people going'}</span>
          <span className="muted small">{spotsText(e)}</span>
          {e.host && <span className="muted small">Hosted by @{e.host.handle}</span>}
        </span>
      </Link>
    </li>
  );
}

// ─── Create / edit form ─────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function EventForm({ initial, submitLabel, onSubmit }: {
  initial?: AnEvent;
  submitLabel: string;
  onSubmit: (b: EventInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(initial?.endsAt ?? null));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [rsvpOnly, setRsvpOnly] = useState(initial?.locationRsvpOnly ?? false);
  const [capacity, setCapacity] = useState(initial?.capacity ? String(initial.capacity) : '');
  const [priceNote, setPriceNote] = useState(initial?.priceNote ?? '');
  const [payUrl, setPayUrl] = useState(initial?.externalPaymentUrl ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    const cap = capacity.trim() ? Number(capacity) : null;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) { setErr('Capacity must be a whole number, or empty for no limit.'); return; }
    if (!startsAt) { setErr('Pick a start time.'); return; }
    setBusy(true);
    try {
      await onSubmit({
        title, description, startsAt: fromLocalInput(startsAt)!, endsAt: fromLocalInput(endsAt), location,
        locationRsvpOnly: rsvpOnly, capacity: cap, priceNote: priceNote.trim() || null, externalPaymentUrl: payUrl.trim() || null,
      });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  const previewStart = startsAt ? new Date(startsAt) : null;
  return (
    <form className="win" onSubmit={submit}>
      <div className="win-bar" aria-hidden="true">
        <span className="win-close" />
        <span className="win-title">{initial ? 'edit_event' : 'new_event'}</span>
      </div>
      <div className="win-body stack">
      <figure className="poster-preview" aria-label="Preview of how the event will look in Events">
        <span className="date-chip" aria-hidden>
          <span className="m">{previewStart ? previewStart.toLocaleDateString(undefined, { month: 'short' }) : 'Date'}</span>
          <span className="d">{previewStart ? previewStart.getDate() : '?'}</span>
        </span>
        <span className="event-main">
          <span className="event-title">{title.trim() || 'Your event'}</span>
          <span className="muted small">{startsAt ? eventWhen(fromLocalInput(startsAt)!, fromLocalInput(endsAt)) : 'Pick a time'}</span>
          <span className="muted small">{rsvpOnly ? 'Location shared with people going' : location.trim() || 'Somewhere'}</span>
          <span className="muted small">{capacity.trim() ? `${capacity} spots` : 'No limit on spots'}</span>
        </span>
        <figcaption className="ui muted">Preview</figcaption>
      </figure>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={EVENT_TITLE_MAX} required /></label>
      <label>What is it?
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={EVENT_DESCRIPTION_MAX} rows={4} />
      </label>
      <div className="row two">
        <label>Starts<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
        <label>Ends (optional)<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      </div>
      <label>Where<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={EVENT_LOCATION_MAX} required /></label>
      <label className="check">
        <input type="checkbox" checked={rsvpOnly} onChange={(e) => setRsvpOnly(e.target.checked)} />
        Only show the location to people who are going
      </label>
      <label>Capacity (empty = no limit)
        <input type="number" min={1} max={EVENT_CAPACITY_MAX} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </label>
      <details>
        <summary className="muted">Cost (optional)</summary>
        <div className="stack" style={{ marginTop: '.6rem' }}>
          <p className="muted small">Events are free on anti. If there is a cost, say so here and collect it yourself.</p>
          <label>Price note<input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={EVENT_PRICE_NOTE_MAX} placeholder="$15 at the door" /></label>
          <label>Payment link<input type="url" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} placeholder="https://" /></label>
        </div>
      </details>
      <ErrorNote message={err} />
      <div className="row dlg-actions"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
      </div>
    </form>
  );
}
