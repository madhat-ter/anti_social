'use client';
/**
 * Consultations (RFC §10.6): the offer editor, the Consulting section on a portfolio, list cards
 * and the status tag. Contacts never appear here: only on a request page, once revealed.
 */
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import {
  ageOn, CONSULT_CONTACT_MAX, CONSULT_DESCRIPTION_MAX, CONSULT_MIN_AGE, CONSULT_MINUTES, CONSULT_PRICE_NOTE_MAX, CONSULT_TOPICS_MAX,
  localToday,
} from '@anti/shared';
import {
  api, errorMessage, type ConsultOffer, type ConsultOfferInput, type ConsultStatus, type Consultation, type Me, type MyConsultOffer,
} from '@/lib/api';
import { relativeTime } from '@/lib/hooks';
import { Avatar } from './Avatar';
import { InterestPicker, InterestTags } from './Interests';
import { NameMarks } from './Marks';
import { AlertDialog } from './retro';
import { ErrorNote } from './ui';
import { WatchOnly, useReadOnly } from './Visitor';

/** 18 or over: consultations exist for you at all. */
export function isAdult(me: Pick<Me, 'birthday'> | null): boolean {
  if (!me?.birthday) return false;
  const a = ageOn(me.birthday, localToday());
  return a !== null && a >= CONSULT_MIN_AGE;
}

export const minutesLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`);
export const priceLabel = (o: { pricing: 'free' | 'paid' | null; priceNote: string | null }) =>
  o.pricing === 'paid' ? o.priceNote || 'Paid' : o.pricing === 'free' ? 'Free' : '';

const STATUS: Record<ConsultStatus, string> = {
  pending: 'waiting for an answer', accepted: 'price set', revealed: 'contacts swapped', done: 'done',
  declined: 'declined', expired: 'expired', closed: 'closed',
};
/** From the viewer's side, so "waiting" says who it waits on. */
export function ConsultStatusTag({ c }: { c: Pick<Consultation, 'status' | 'role'> }) {
  const label = c.status === 'pending' ? (c.role === 'consultant' ? 'to answer' : 'waiting')
    : c.status === 'accepted' ? (c.role === 'requester' ? 'agree to the price' : 'waiting for them to agree')
    : STATUS[c.status];
  const hot = (c.status === 'pending' && c.role === 'consultant') || (c.status === 'accepted' && c.role === 'requester');
  return <span className={`tag consult-status ${c.status}${hot ? ' hot' : ''}`}>{label}</span>;
}

export function ConsultCard({ c }: { c: Consultation }) {
  const them = c.role === 'consultant' ? c.requester : c.consultant;
  return (
    <li className="consult-card">
      <Link href={`/consultations/${c.id}`} className="consult-link">
        <Avatar seed={them.handle} gender={them.gender} size={44} />
        <span className="consult-main">
          <span className="consult-title">
            {c.role === 'consultant'
              ? <>@{them.handle}<NameMarks admin={them.admin} verified={them.verified} size=".85em" /> asks about <b>{c.topic.label}</b></>
              : <>You asked @{them.handle}<NameMarks admin={them.admin} verified={them.verified} size=".85em" /> about <b>{c.topic.label}</b></>}
            {' '}<ConsultStatusTag c={c} />
          </span>
          <span className="muted small consult-need">{c.need}</span>
          <span className="muted small">{minutesLabel(c.minutes)}{c.pricing && <> · {priceLabel(c)}</>} · {relativeTime(c.createdAt)}</span>
        </span>
      </Link>
    </li>
  );
}

// ─── The offer editor (on the Consultations page) ───────────────────────────

export function OfferEditor({ initial, onSaved }: { initial: MyConsultOffer; onSaved: (o: MyConsultOffer) => void }) {
  const id = useId();
  const [d, setD] = useState<ConsultOfferInput>({ ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const set = <K extends keyof ConsultOfferInput>(k: K, v: ConsultOfferInput[K]) => { setD((c) => ({ ...c, [k]: v })); setSaid(null); };

  async function save(active: boolean) {
    setBusy(true); setErr(null); setSaid(null);
    try {
      const o = await api.saveConsultOffer({ ...d, active, priceNote: d.priceNote || null, paymentUrl: d.paymentUrl || null });
      setD({ ...o }); onSaved(o);
      setSaid(active ? 'Saved. Your portfolio shows a Book a consultation button.' : initial.active ? 'Paused. Nobody can send a new request.' : 'Saved, not switched on yet.');
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (initial.blocked) {
    return <div className="banner" role="status">An admin switched your consulting off. Sessions you already agreed to can still be finished.</div>;
  }
  return (
    <form className="stack card consult-offer-form" onSubmit={(e) => { e.preventDefault(); void save(true); }}>
      <div className="row between">
        <h2>Your offer</h2>
        <span className={`tag${initial.active ? ' on' : ''}`}>{initial.active ? 'on' : initial.exists ? 'paused' : 'off'}</span>
      </div>
      {initial.hidden && <div className="banner" role="status">Hidden after reports until an admin looks. People cannot book you meanwhile.</div>}
      <p className="muted small">Members can book a session with you. You decide on each request, and for each one whether it is free or paid. Anti never handles the money.</p>

      <fieldset>
        <legend>What you consult on (up to {CONSULT_TOPICS_MAX})</legend>
        <InterestPicker value={d.topics ?? []} onChange={(t) => set('topics', t)} max={CONSULT_TOPICS_MAX} />
      </fieldset>
      <label>About your sessions
        <textarea value={d.description ?? ''} maxLength={CONSULT_DESCRIPTION_MAX} rows={4}
          placeholder="Portfolio reviews, first-job advice, how I would approach your brief…" onChange={(e) => set('description', e.target.value)} />
        <span className="counter">{(d.description ?? '').length} / {CONSULT_DESCRIPTION_MAX}</span>
      </label>
      <label className="consult-len">Session length
        <select value={d.minutes} onChange={(e) => set('minutes', Number(e.target.value))}>
          {CONSULT_MINUTES.map((m) => <option key={m} value={m}>{minutesLabel(m)}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Usually</legend>
        <div className="row">
          <label className="check"><input type="radio" name={`${id}-p`} checked={d.pricing === 'free'} onChange={() => set('pricing', 'free')} /> Free</label>
          <label className="check"><input type="radio" name={`${id}-p`} checked={d.pricing === 'paid'} onChange={() => set('pricing', 'paid')} /> Paid</label>
        </div>
        <p className="muted small">Only a starting point: when you accept a request you can make it free, or change the price.</p>
      </fieldset>
      {d.pricing === 'paid' && (
        <div className="row two">
          <label>Price
            <input value={d.priceNote ?? ''} maxLength={CONSULT_PRICE_NOTE_MAX} placeholder="NPR 2,000 per hour" onChange={(e) => set('priceNote', e.target.value)} />
          </label>
          <label>Your payment link (optional)
            <input type="url" inputMode="url" value={d.paymentUrl ?? ''} maxLength={500} placeholder="https://" onChange={(e) => set('paymentUrl', e.target.value)} />
          </label>
        </div>
      )}
      <label>How people reach you (private)
        <textarea value={d.contact ?? ''} maxLength={CONSULT_CONTACT_MAX} rows={2}
          placeholder="WhatsApp +977…, Telegram @you, or an email" onChange={(e) => set('contact', e.target.value)} />
        <span className="muted small">Nobody sees this until you accept their request. Then they see it, and you see theirs, for a while.</span>
      </label>

      <ErrorNote message={err} />
      {said && <p className="muted" role="status">{said}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : initial.active ? 'Save' : 'Switch on'}</button>
        {initial.active && <button type="button" className="btn" disabled={busy} onClick={() => void save(false)}>Pause</button>}
        {!initial.active && initial.exists && <button type="button" className="btn" disabled={busy} onClick={() => void save(false)}>Save, keep paused</button>}
      </div>
    </form>
  );
}

// ─── The Consulting section on a portfolio ──────────────────────────────────

export function ConsultingSection({ handle, viewerAdult }: { handle: string; viewerAdult: boolean }) {
  const readOnly = useReadOnly();
  const [o, setO] = useState<ConsultOffer | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  const [more, setMore] = useState<ConsultOffer['thanks'] | null>(null);
  const [report, setReport] = useState(false);
  const [reported, setReported] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!viewerAdult) { setO(null); return; }
    let alive = true;
    api.consultOffer(handle).then((r) => { if (alive) setO(r.offer); }, () => { if (alive) setO(null); });
    return () => { alive = false; };
  }, [handle, viewerAdult]);
  useEffect(() => { if (all && !more) api.consultThanks(handle).then((r) => setMore(r.items), (e) => setErr(errorMessage(e))); }, [all, more, handle]);

  if (!o) return null;
  if (o.mine && !o.active) {
    return (
      <section className="pf-consult" aria-labelledby="pf-consult-h">
        <h2 id="pf-consult-h" className="pf-sec-h">Consulting</h2>
        <p className="muted">{o.blocked ? 'An admin switched your consulting off.' : 'Paused: only you can see this.'} <Link href="/consultations?tab=offer">Your offer</Link></p>
      </section>
    );
  }
  const thanks = all && more ? more : o.thanks;
  return (
    <section className="pf-consult" aria-labelledby="pf-consult-h">
      <div className="row between">
        <h2 id="pf-consult-h" className="pf-sec-h">Consulting</h2>
        {o.mine
          ? <Link className="btn" href="/consultations?tab=offer">Edit offer</Link>
          : o.canBook && (readOnly ? <WatchOnly>Book a consultation</WatchOnly> : <Link className="btn primary" href={`/u/${handle}/consult`}>Book a consultation</Link>)}
      </div>
      {o.hidden && <p className="tag danger">hidden after reports</p>}
      <InterestTags slugs={o.topics} />
      {o.description && <p className="body pf-consult-desc">{o.description}</p>}
      <dl className="pf-consult-facts">
        <div><dt>Session</dt><dd>{minutesLabel(o.minutes)}</dd></div>
        <div><dt>Usually</dt><dd>{priceLabel(o)}</dd></div>
        <div><dt>Sessions done</dt><dd>{o.sessionsDone > 0 ? o.sessionsDone : <span className="muted">none yet</span>}</dd></div>
      </dl>
      {thanks.length > 0 && (
        <ul className="pf-thanks">
          {thanks.map((t) => (
            <li key={`${t.handle}-${t.at}`} className={t.hidden ? 'hidden' : undefined}>
              <blockquote>{t.text}</blockquote>
              <span className="muted small">
                <Link href={`/u/${t.handle}`}>@{t.handle}<NameMarks admin={t.admin} verified={t.verified} size=".9em" /></Link> · {relativeTime(t.at)}{t.hidden && <> · <span className="tag">hidden</span></>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!all && o.thanksCount > o.thanks.filter((t) => !t.hidden).length && (
        <button type="button" className="link-btn" onClick={() => setAll(true)}>All {o.thanksCount} thank-yous</button>
      )}
      <ErrorNote message={err} />
      {o.canReport && !reported && !readOnly && <button type="button" className="link-btn small" onClick={() => setReport(true)}>Report this offer</button>}
      {reported && <p className="muted small" role="status">Reported. Thanks, an admin will take a look.</p>}
      <AlertDialog open={report} title="Report" message="Report this consultation offer to the admins? After five reports it is hidden until they look."
        confirmLabel="Report" onCancel={() => setReport(false)}
        onConfirm={() => { setReport(false); api.flagConsultOffer(handle).then(() => setReported(true), (e) => setErr(errorMessage(e))); }} />
    </section>
  );
}
