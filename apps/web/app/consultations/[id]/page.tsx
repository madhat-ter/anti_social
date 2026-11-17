'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';
import { CONSULT_PRICE_NOTE_MAX, CONSULT_THANKS_MAX } from '@anti/shared';
import { api, errorMessage, type Consultation, type ConsultPricing, type MyConsultOffer } from '@/lib/api';
import { fmtDate, useTitle } from '@/lib/hooks';
import { CONSULT_EVENT, SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { AlertDialog, Loading } from '@/components/retro';
import { Avatar } from '@/components/Avatar';
import { NameMarks } from '@/components/Marks';
import { ConsultStatusTag, isAdult, minutesLabel, priceLabel } from '@/components/Consult';

export default function ConsultationPage() {
  useTitle('Consultation');
  return <SeatedShell>{(me) => (isAdult(me) ? <View /> : <p className="empty">Consultations are for members 18 and over.</p>)}</SeatedShell>;
}

type Confirm = null | 'decline' | 'close' | 'nothanks' | 'withdraw' | 'hide' | 'done' | 'report';

function View() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Consultation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = useCallback(async () => {
    try { setC(await api.consultation(id)); } catch (e) { setErr(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<Consultation | unknown>, done?: string) {
    setBusy(true); setErr(null); setSaid(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'status' in r && 'role' in r) setC(r as Consultation); else await load();
      window.dispatchEvent(new Event(CONSULT_EVENT));
      if (done) setSaid(done);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!c) return err ? <><ErrorNote message={err} /><p><Link href="/consultations">Back to consultations</Link></p></> : <Loading />;

  const iAmConsultant = c.role === 'consultant';
  const them = iAmConsultant ? c.requester : c.consultant;
  return (
    <>
      <p><Link href={`/consultations${iAmConsultant ? '' : '?tab=sent'}`} className="ui">Back to consultations</Link></p>
      <article className="stack consult-detail">
        <header className="row consult-head">
          <Avatar seed={them.handle} gender={them.gender} size={64} />
          <div>
            <h1>Consultation <ConsultStatusTag c={c} /></h1>
            <p className="muted">
              {iAmConsultant ? 'From ' : 'With '}
              <Link href={`/u/${them.handle}`}>{them.displayName}<NameMarks admin={them.admin} verified={them.verified} size=".85em" /> @{them.handle}</Link> · asked {fmtDate(c.createdAt)}
            </p>
          </div>
        </header>

        <dl className="facts">
          <dt>Needs help with</dt><dd className="pre">{c.need}</dd>
          {c.when && <><dt>When suits</dt><dd>{c.when}</dd></>}
          <dt>Session</dt><dd>{minutesLabel(c.minutes)}</dd>
          {c.pricing && (
            <>
              <dt>Cost</dt>
              <dd>
                {priceLabel(c)}
                {c.paymentUrl && <> · <a href={c.paymentUrl} target="_blank" rel="noopener noreferrer nofollow">Payment link ↗</a> (paid to them, not anti)</>}
              </dd>
            </>
          )}
        </dl>

        <Stage c={c} />

        {c.contacts && <Contacts c={c} />}

        <ErrorNote message={err} />
        {said && <p className="muted" role="status">{said}</p>}

        {c.can.accept && <Accept c={c} busy={busy} onAccept={(b) => act(() => api.acceptConsultation(c.id, b), b.pricing === 'free' ? 'Accepted. Your contacts are swapped.' : 'Accepted. They will see the price and agree before contacts swap.')} />}

        {c.can.agree && (
          <div className="card stack consult-agree">
            <h2>{them.displayName} accepted, for {c.priceNote ?? 'a price'}</h2>
            <p>Agree to it and you both see each other&apos;s contact. How and when you pay is between you two{c.paymentUrl ? '; their payment link is above' : ''}. Anti never handles the money.</p>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => act(() => api.agreeConsultation(c.id), 'Agreed. Your contacts are swapped.')}>I agree to pay this</button>
              <button className="btn" disabled={busy} onClick={() => setConfirm('nothanks')}>No thanks</button>
            </div>
          </div>
        )}

        <div className="row">
          {c.can.decline && <button className="btn" disabled={busy} onClick={() => setConfirm('decline')}>Decline</button>}
          {c.can.done && <button className="btn primary" disabled={busy} onClick={() => setConfirm('done')}>Mark done</button>}
          {c.can.close && c.status === 'pending' && <button className="btn" disabled={busy} onClick={() => setConfirm('withdraw')}>Withdraw request</button>}
          {c.can.close && c.status !== 'pending' && !c.can.agree && <button className="btn" disabled={busy} onClick={() => setConfirm('close')}>Close</button>}
          {c.can.hideContacts && <button className="btn" disabled={busy} onClick={() => setConfirm('hide')}>Hide contacts now</button>}
          {c.can.report
            ? <button className="btn" disabled={busy} onClick={() => setConfirm('report')}>Report</button>
            : <span className="muted small">Reported. An admin will look.</span>}
        </div>

        {c.status === 'done' && <Thanks c={c} busy={busy} act={act} />}
      </article>

      <AlertDialog
        open={confirm !== null}
        title={confirm === 'report' ? 'Report' : confirm === 'done' ? 'Done' : 'Are you sure?'}
        message={{
          decline: 'Decline this request? They get a short note, without a reason.',
          close: 'Close this? Both contacts are hidden again and it cannot be reopened.',
          nothanks: 'Say no thanks to the price? The request closes and no contacts are shared.',
          withdraw: 'Withdraw your request?',
          hide: 'Hide both contacts now? The session stays done.',
          done: 'Mark the session done? Contacts stay visible for 14 more days.',
          report: 'Report this to the admins? They will be able to read the request, including both contacts, to judge it.',
        }[confirm ?? 'close']}
        confirmLabel={{ decline: 'Decline', close: 'Close', nothanks: 'No thanks', withdraw: 'Withdraw', hide: 'Hide', done: 'Mark done', report: 'Report' }[confirm ?? 'close']}
        danger={confirm === 'close' || confirm === 'decline'}
        focusCancel
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const w = confirm; setConfirm(null);
          if (w === 'decline') void act(() => api.declineConsultation(c.id), 'Declined.');
          else if (w === 'done') void act(() => api.doneConsultation(c.id), 'Marked done.');
          else if (w === 'report') void act(() => api.flagConsultation(c.id), 'Reported. Thanks, an admin will take a look.');
          else void act(() => api.closeConsultation(c.id), w === 'hide' ? 'Contacts hidden.' : w === 'withdraw' ? 'Withdrawn.' : 'Closed.');
        }}
      />
    </>
  );
}

/** One line on where it stands and what happens next. */
function Stage({ c }: { c: Consultation }) {
  const me = c.role === 'consultant';
  const until = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
  const line = {
    pending: me ? `Accept or decline by ${until(c.expiresAt)}. Their contact appears when you accept.` : `Waiting for an answer, until ${until(c.expiresAt)}.`,
    accepted: me ? `Waiting for them to agree to ${c.priceNote ?? 'the price'}, until ${until(c.expiresAt)}.` : `Agree by ${until(c.expiresAt)}, or it expires.`,
    revealed: 'Contacts are swapped. Talk where you like; mark it done afterwards.',
    done: c.contacts ? `Done${c.doneAt ? ` on ${until(c.doneAt)}` : ''}. Contacts stay until ${until(c.contactsUntil)}.` : `Done${c.doneAt ? ` on ${until(c.doneAt)}` : ''}.`,
    declined: me ? 'You declined this one.' : 'Not this time. There are other people to ask.',
    expired: 'Nobody answered in time, so this expired.',
    closed: c.closedByMe ? 'You closed this.' : 'This was closed.',
  }[c.status];
  return <p className="banner notice consult-stage" role="status">{line}</p>;
}

function Contacts({ c }: { c: Consultation }) {
  const me = c.role === 'consultant';
  const theirs = me ? c.contacts!.requester : c.contacts!.consultant;
  const mine = me ? c.contacts!.consultant : c.contacts!.requester;
  return (
    <section className="card stack consult-contacts" aria-labelledby="cc-h">
      <h2 id="cc-h">Reach {me ? c.requester.displayName : c.consultant.displayName}</h2>
      <p className="consult-contact">{theirs}</p>
      <p className="muted small">They see yours: <span className="mine">{mine}</span></p>
      <p className="muted small">Visible to you two until {c.contactsUntil ? new Date(c.contactsUntil).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'it is closed'}, then hidden again. Anti does not keep it.</p>
    </section>
  );
}

function Accept({ c, busy, onAccept }: { c: Consultation; busy: boolean; onAccept: (b: { pricing: ConsultPricing; priceNote?: string | null; paymentUrl?: string | null }) => void }) {
  const id = useId();
  const [offer, setOffer] = useState<MyConsultOffer | null>(null);
  const [pricing, setPricing] = useState<ConsultPricing>('free');
  const [note, setNote] = useState('');
  useEffect(() => {
    api.myConsultOffer().then((o) => { setOffer(o); setPricing(o.pricing); setNote(o.priceNote ?? ''); }, () => {});
  }, []);
  return (
    <form className="card stack consult-accept" onSubmit={(e) => { e.preventDefault(); onAccept(pricing === 'free' ? { pricing } : { pricing, priceNote: note }); }}>
      <h2>Accept this request</h2>
      <fieldset>
        <legend>For this one</legend>
        <div className="row">
          <label className="check"><input type="radio" name={`${id}-p`} checked={pricing === 'free'} onChange={() => setPricing('free')} /> Free</label>
          <label className="check"><input type="radio" name={`${id}-p`} checked={pricing === 'paid'} onChange={() => setPricing('paid')} /> Paid</label>
        </div>
      </fieldset>
      {pricing === 'paid' && (
        <label>Price
          <input value={note} maxLength={CONSULT_PRICE_NOTE_MAX} placeholder="NPR 1,500 for 30 minutes" onChange={(e) => setNote(e.target.value)} required />
          {offer?.paymentUrl && <span className="muted small">They also get your payment link.</span>}
        </label>
      )}
      <p className="muted small">
        {pricing === 'free' ? 'Free: you both see each other’s contact as soon as you accept.' : 'Paid: they see the price first and agree to it; then you both see each other’s contact.'}
      </p>
      <div className="row"><button className="btn primary" disabled={busy || (pricing === 'paid' && !note.trim())}>Accept</button></div>
    </form>
  );
}

function Thanks({ c, busy, act }: { c: Consultation; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const [text, setText] = useState(c.thanks?.text ?? '');
  const [editing, setEditing] = useState(!c.thanks);
  if (c.role === 'consultant') {
    if (!c.thanks) return null;
    return (
      <section className="card stack">
        <h2>Their thank-you</h2>
        <blockquote className="consult-thanks">{c.thanks.text}</blockquote>
        <p className="muted small">{c.thanks.hidden ? 'Hidden from your portfolio.' : 'Shown on your portfolio.'}</p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => act(() => api.hideConsultThanks(c.id, !c.thanks!.hidden), c.thanks!.hidden ? 'Shown again.' : 'Hidden.')}>
            {c.thanks.hidden ? 'Show it' : 'Hide it'}
          </button>
        </div>
      </section>
    );
  }
  if (!c.can.thank) return null;
  return (
    <section className="card stack">
      <h2>Say thanks</h2>
      <p className="muted small">A few public words on {c.consultant.displayName}&apos;s portfolio. No stars, no scores. They can hide it.</p>
      {editing ? (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void act(() => api.thankConsultation(c.id, text), 'Thanks posted.').then(() => setEditing(false)); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={CONSULT_THANKS_MAX} rows={3} placeholder="What helped." />
          <span className="counter">{text.length} / {CONSULT_THANKS_MAX}</span>
          <div className="row">
            <button className="btn primary" disabled={busy || !text.trim()}>Post thank-you</button>
            {c.thanks && <button type="button" className="btn" onClick={() => { setText(c.thanks!.text); setEditing(false); }}>Cancel</button>}
          </div>
        </form>
      ) : (
        <>
          <blockquote className="consult-thanks">{c.thanks?.text}</blockquote>
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" disabled={busy} onClick={() => act(() => api.thankConsultation(c.id, null), 'Removed.').then(() => { setText(''); setEditing(true); })}>Remove</button>
          </div>
        </>
      )}
    </section>
  );
}
