'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Consultation, type MyConsultOffer } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';
import { ConsultCard, isAdult, OfferEditor } from '@/components/Consult';
import { CONSULT_MIN_AGE } from '@anti/shared';

type Tab = 'received' | 'sent' | 'offer';

export default function ConsultationsPage() {
  useTitle('Consultations');
  return (
    <SeatedShell>
      {(me) => isAdult(me)
        ? <Consultations myHandle={me.handle} />
        : <><h1>Consultations</h1><p className="empty">Consultations are for members {CONSULT_MIN_AGE} and over.</p></>}
    </SeatedShell>
  );
}

function Consultations({ myHandle }: { myHandle: string }) {
  const [tab, setTab] = useState<Tab>('received');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'sent' || t === 'offer') setTab(t);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === 'received') u.searchParams.delete('tab'); else u.searchParams.set('tab', t);
    window.history.replaceState(null, '', u);
  };
  return (
    <>
      <h1>Consultations</h1>
      <p className="muted">Book time with someone who knows, or offer yours. Nobody sees a contact until a request is accepted; then both sides do, for a while. Anti never handles money.</p>
      <div className="tabs" role="tablist">
        {(['received', 'sent', 'offer'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} className={tab === s ? 'tab on' : 'tab'} onClick={() => go(s)}>
            {s === 'received' ? 'Received' : s === 'sent' ? 'Sent' : 'Your offer'}
          </button>
        ))}
      </div>
      {tab === 'offer' ? <Offer myHandle={myHandle} /> : <Box box={tab} />}
    </>
  );
}

function Box({ box }: { box: 'received' | 'sent' }) {
  const [items, setItems] = useState<Consultation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setItems(null); setErr(null);
    api.consultations(box).then((r) => { if (alive) setItems(r.items); }, (e) => { if (alive) setErr(errorMessage(e)); });
    return () => { alive = false; };
  }, [box]);
  if (err) return <ErrorNote message={err} />;
  if (!items) return <Loading />;
  if (!items.length) {
    return (
      <p className="empty">
        {box === 'received'
          ? 'No requests yet. Switch on your offer and a Book button appears on your portfolio.'
          : <>You have not asked anyone yet. <Link href="/members">Members</Link> who consult carry a &quot;consults&quot; tag.</>}
      </p>
    );
  }
  return <ul className="consults">{items.map((c) => <ConsultCard key={c.id} c={c} />)}</ul>;
}

function Offer({ myHandle }: { myHandle: string }) {
  const [o, setO] = useState<MyConsultOffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.myConsultOffer().then(setO, (e) => setErr(errorMessage(e))); }, []);
  if (err) return <ErrorNote message={err} />;
  if (!o) return <Loading />;
  return (
    <>
      <OfferEditor initial={o} onSaved={setO} />
      {o.active && <p className="muted small">See it as others do: <Link href={`/u/${myHandle}`}>your portfolio</Link>.</p>}
    </>
  );
}
