'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CONSULT_CONTACT_MAX, CONSULT_NEED_MAX, CONSULT_WHEN_MAX } from '@anti/shared';
import { api, errorMessage, type ConsultOffer } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Loading, Win } from '@/components/retro';
import { isAdult, minutesLabel, priceLabel } from '@/components/Consult';

export default function BookPage() {
  useTitle('Book a consultation');
  return <SeatedShell>{(me) => (isAdult(me) ? <Book /> : <p className="empty">Consultations are for members 18 and over.</p>)}</SeatedShell>;
}

/** No topic to pick: their portfolio said who they are; say what you need. */
function Book() {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle);
  const router = useRouter();
  const [o, setO] = useState<ConsultOffer | null | undefined>(undefined);
  const [need, setNeed] = useState('');
  const [when, setWhen] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.consultOffer(handle).then((r) => setO(r.offer), (e) => { setErr(errorMessage(e)); setO(null); });
    // start from your own contact, if you consult too
    api.myConsultOffer().then((m) => { if (m.contact) setContact((c) => c || m.contact); }, () => {});
  }, [handle]);

  if (o === undefined) return <Loading />;
  if (!o || !o.canBook) {
    return <><ErrorNote message={err} /><p className="empty">@{handle} is not taking consultations right now. <Link href={`/u/${handle}`}>Back to their portfolio</Link></p></>;
  }

  return (
    <Win title="book.consultation" className="consult-book" bodyClassName="stack">
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null);
        try {
          const c = await api.requestConsultation(handle, { need, when, contact });
          router.push(`/consultations/${c.id}`);
        } catch (x) { setErr(errorMessage(x)); setBusy(false); }
      }}>
        <h1>Book a consultation with @{handle}</h1>
        <p className="muted">{minutesLabel(o.minutes)} · usually {priceLabel(o).toLowerCase() === 'free' ? 'free' : priceLabel(o)}. They decide on each request, and whether it is free or paid.</p>
        {o.description && <p className="body">{o.description}</p>}
        <label>What you need help with
          <textarea value={need} onChange={(e) => setNeed(e.target.value)} maxLength={CONSULT_NEED_MAX} rows={6} required
            placeholder="The situation, what you have tried, what you hope to leave with." />
          <span className="counter">{need.length} / {CONSULT_NEED_MAX}</span>
        </label>
        <label>When suits you
          <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={CONSULT_WHEN_MAX} placeholder="Weekday evenings, or Saturday morning" />
        </label>
        <label>How they can reach you
          <textarea value={contact} onChange={(e) => setContact(e.target.value)} maxLength={CONSULT_CONTACT_MAX} rows={2} required
            placeholder="WhatsApp +977…, Telegram @you, or an email" />
          <span className="muted small">They only see this if they accept, and you see theirs at the same time. It is hidden again afterwards.</span>
        </label>
        <ErrorNote message={err} />
        <div className="row">
          <button className="btn primary" disabled={busy || !need.trim() || !contact.trim()}>{busy ? 'Sending…' : 'Send request'}</button>
          <Link className="btn" href={`/u/${handle}`}>Cancel</Link>
        </div>
        <p className="muted small">If nobody answers in 7 days the request expires.</p>
      </form>
    </Win>
  );
}
