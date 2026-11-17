'use client';
/**
 * Asking for a seat (RFC §10.25), on the landing page. The message above it speaks to someone who
 * feels they have nobody; "ask a member for an invite" is no door for that person. So the button
 * opens a short form right where it stands: a name, one way to reach them, a few words if they
 * want. No account. A person (an admin) reads it and writes back by hand.
 *
 * The form needs the server's contact key (what they type is kept sealed); without it the page
 * falls back to the old line about asking a member.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { SEAT_REQUEST } from '@anti/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Win } from './retro';
import { ErrorNote, why } from './ui';

const INSIDE = 'Know someone inside? Every member can invite two people at a time, and they choose.';

export function SeatAsk() {
  const id = useId();
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.seatRequestsOpen().then((r) => { if (alive) setAvailable(r.open); }, () => { /* keep the button: sending says what is wrong */ });
    return () => { alive = false; };
  }, []);

  const ready = name.trim().length > 0 && contact.trim().length >= SEAT_REQUEST.contactMin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true); setErr(null);
    try {
      await api.askForSeat({ name, contact, note, website: trap });
      setSent(true); setOpen(false);
    } catch (x) {
      // the API's own words for "too many": the general message would not say how long to wait
      setErr(x instanceof ApiError && x.status === 429 && x.detail ? x.detail : errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  if (!available) {
    return (
      <div className="hero-how">
        <p>No invite? Ask someone who is already inside: every member can invite two people at a time, and they choose.</p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="hero-how">
        <p className="seat-ask-sent" role="status">
          <strong>Sent.</strong> A person will read it. There are only a hundred seats, so it can take a while; when one is
          free, one of us will write to you.
        </p>
      </div>
    );
  }

  return (
    <div className="hero-how">
      {open ? (
        <Win title="Ask for a seat" as="div" className="seat-ask" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={submit}>
          <p className="muted small">
            No account needed. Only the admins see what you write here. A person reads every request; there are only a hundred
            seats, so it can take a while.
          </p>
          <label>Your name
            <input value={name} maxLength={SEAT_REQUEST.nameMax} required autoComplete="given-name" placeholder="What should we call you?" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="file-trap" aria-hidden="true">
            <label>Website <input value={trap} tabIndex={-1} autoComplete="off" onChange={(e) => setTrap(e.target.value)} /></label>
          </div>
          <label>How can we reach you?
            <input value={contact} maxLength={SEAT_REQUEST.contactMax} required autoComplete="off" placeholder="A phone number, an email or an Instagram name" onChange={(e) => setContact(e.target.value)} />
          </label>
          <label htmlFor={`${id}-note`}><span>Anything you want to say <span className="muted seat-ask-opt">(you can leave this empty)</span></span></label>
          <textarea id={`${id}-note`} className="seat-ask-note" value={note} maxLength={SEAT_REQUEST.noteMax} rows={3} onChange={(e) => setNote(e.target.value)} />
          <ErrorNote message={err} />
          <div className="row dlg-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Not now</button>
            <button className="btn default" disabled={busy || !ready} {...why(!busy && !ready && 'A name and a way to reach you first.')}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
          </form>
        </Win>
      ) : (
        <div className="seat-ask-row">
          <p>No invite, and no one inside to ask?</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>Ask for a seat</button>
        </div>
      )}
      <p>{INSIDE}</p>
    </div>
  );
}
