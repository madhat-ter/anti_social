'use client';
import { useState, type FormEvent } from 'react';
import {
  EVENT_DESCRIPTION_MAX, EVENT_LOCATION_MAX, EVENT_PRICE_NOTE_MAX, EVENT_TITLE_MAX, EVENT_CAPACITY_MAX,
  EVENT_INTERESTS_MAX, EVENT_REQUIREMENTS_MAX,
} from '@anti/shared';
import { InterestPicker } from './Interests';
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

/** On a card the date chip already says the day, so this is the weekday and the time: "Friday, 7:00 PM" or "Friday, 7:00 – 9:00 PM". */
export function eventTime(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  const wd = s.toLocaleDateString(undefined, { weekday: 'long' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endsAt) return `${wd}, ${t(s)}`;
  const e = new Date(endsAt);
  return e.toDateString() === s.toDateString() ? `${wd}, ${t(s)} – ${t(e)}` : `${wd}, ${t(s)} – ${e.toLocaleDateString(undefined, { weekday: 'short' })} ${t(e)}`;
}

/** Who is coming. A zero is an invitation, not a count. */
export function spotsText(e: AnEvent): string {
  if (e.started) {
    if (e.attendedCount > 0) return `${e.attendedCount} attended`;
    return e.goingCount > 0 ? `${e.goingCount} going` : 'Nobody signed up';
  }
  if (e.capacity === null) return e.goingCount > 0 ? `${e.goingCount} going` : 'Be the first to go';
  const left = Math.max(e.capacity - e.goingCount, 0);
  if (left === 0) return `Full, ${e.waitlistCount} on the waitlist`;
  return e.goingCount > 0 ? `${e.goingCount} going, ${left} of ${e.capacity} spots left` : `${e.capacity} spots, be the first`;
}

export function MyStatus({ e }: { e: AnEvent }) {
  if (e.isHost) return <span className="tag">hosting</span>;
  if (!e.my || e.my.status === 'cancelled') return null;
  if (e.my.status === 'going') return <span className="tag on">{e.my.attended ? 'attended' : 'going'}</span>;
  return <span className="tag">waitlist #{e.my.waitlistPosition}</span>;
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
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? []);
  const [requirements, setRequirements] = useState(initial?.requirements ?? '');
  const [joinMode, setJoinMode] = useState<'open' | 'approve'>(initial?.joinMode ?? 'open');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // RFC §10.21: everything beyond the basics is in one fold, open when editing something inside it
  const [more, setMore] = useState(!!(initial && (initial.endsAt || initial.capacity || initial.locationRsvpOnly
    || initial.requirements || initial.interests.length || initial.priceNote || initial.externalPaymentUrl || initial.joinMode === 'approve')));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    const cap = capacity.trim() ? Number(capacity) : null;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) { setErr('Capacity must be a whole number, or empty for no limit.'); setMore(true); return; }
    if (!startsAt) { setErr('Pick a start time.'); return; }
    setBusy(true);
    try {
      await onSubmit({
        title, description, startsAt: fromLocalInput(startsAt)!, endsAt: fromLocalInput(endsAt), location,
        locationRsvpOnly: rsvpOnly, capacity: cap, priceNote: priceNote.trim() || null, externalPaymentUrl: payUrl.trim() || null,
        interests, requirements, joinMode,
      });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form className="win" onSubmit={submit}>
      <div className="win-bar" aria-hidden="true">
        <span className="win-close" />
        <span className="win-title">{initial ? 'edit_event' : 'new_event'}</span>
      </div>
      <div className="win-body stack">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={EVENT_TITLE_MAX} required placeholder="A picnic on Saturday" /></label>
        <div className="row two">
          <label>Starts<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
          <label>Where<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={EVENT_LOCATION_MAX} required /></label>
        </div>
        <label>What is it?
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={EVENT_DESCRIPTION_MAX} rows={4} />
        </label>

        <details open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
          <summary className="muted">More options</summary>
          <div className="stack" style={{ marginTop: '.6rem' }}>
            <label>Ends (optional)<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
            <label>Capacity (empty = no limit)
              <input type="number" min={1} max={EVENT_CAPACITY_MAX} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={rsvpOnly} onChange={(e) => setRsvpOnly(e.target.checked)} />
              Only show the location to people who are going
            </label>
            <fieldset className="stack">
              <legend>Who can come</legend>
              <label className="check"><input type="radio" name="join-mode" checked={joinMode === 'open'} onChange={() => setJoinMode('open')} /> Anyone: they just say they are going</label>
              <label className="check"><input type="radio" name="join-mode" checked={joinMode === 'approve'} onChange={() => setJoinMode('approve')} /> People ask with a note, you accept</label>
            </fieldset>
            <label>What to bring or know
              <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={EVENT_REQUIREMENTS_MAX} rows={2} placeholder="Comfortable shoes. Some Spanish helps." />
            </label>
            <fieldset className="stack">
              <legend>Interests <span className="muted small">(up to {EVENT_INTERESTS_MAX}; helps you invite people who fit)</span></legend>
              <InterestPicker value={interests} onChange={setInterests} max={EVENT_INTERESTS_MAX} />
            </fieldset>
            <label>Price note<input value={priceNote} onChange={(e) => setPriceNote(e.target.value)} maxLength={EVENT_PRICE_NOTE_MAX} placeholder="$15 at the door" /></label>
            <label>Payment link<input type="url" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} placeholder="https://" /></label>
            <p className="muted small">Events are free on anti. If there is a cost, say so here and collect it yourself.</p>
          </div>
        </details>

        <ErrorNote message={err} />
        <div className="row dlg-actions"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
      </div>
    </form>
  );
}
