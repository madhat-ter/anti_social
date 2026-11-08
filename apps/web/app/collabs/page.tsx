'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorMessage, type CollabSummary, type Interest } from '@/lib/api';
import { interestsCached } from '@/lib/interests';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';
import { CollabCard } from '@/components/Collabs';

export default function CollabsPage() {
  useTitle('Collabs');
  return <SeatedShell>{(me) => <CollabsList hasInterests={(me.interests ?? []).length > 0} />}</SeatedShell>;
}

function CollabsList({ hasInterests }: { hasInterests: boolean }) {
  const [tab, setTab] = useState<'for-you' | 'all'>(hasInterests ? 'for-you' : 'all');
  const [interest, setInterest] = useState('');
  const [all, setAll] = useState<Interest[]>([]);
  const [items, setItems] = useState<CollabSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { interestsCached().then(setAll, () => {}); }, []);
  useEffect(() => {
    let alive = true;
    setItems(null); setErr(null);
    api.collabs(tab, interest || null).then((r) => { if (alive) setItems(r.items); }, (e) => { if (alive) setErr(errorMessage(e)); });
    return () => { alive = false; };
  }, [tab, interest]);

  return (
    <>
      <div className="row between">
        <h1>Collabs</h1>
        <Link className="btn primary" href="/collabs/new">Start a collab</Link>
      </div>
      <p className="muted">Projects and activities people here do together: a zine, a band, a cleanup, a short film. Join one, or start your own and find your people.</p>
      <div className="row between collab-bar">
        <div className="tabs" role="tablist">
          {(['for-you', 'all'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={tab === s} className={tab === s ? 'tab on' : 'tab'} onClick={() => setTab(s)}>
              {s === 'for-you' ? 'For you' : 'All'}
            </button>
          ))}
        </div>
        <label className="inline">Interest
          <select value={interest} onChange={(e) => setInterest(e.target.value)}>
            <option value="">Any</option>
            {all.map((i) => <option key={i.slug} value={i.slug}>{i.label}</option>)}
          </select>
        </label>
      </div>
      <ErrorNote message={err} />
      {!items ? (err ? null : <Loading />) : items.length === 0 ? (
        <p className="empty">
          {tab === 'for-you'
            ? hasInterests
              ? <>Nothing recruiting that matches your interests right now. <button type="button" className="link-btn" onClick={() => setTab('all')}>See all collabs</button>, or start one.</>
              : <>Pick your interests in <Link href="/settings#interests">Settings</Link> and collabs that match show up here.</>
            : 'No collabs yet. Start the first one.'}
        </p>
      ) : (
        <ul className="collabs">{items.map((c) => <CollabCard key={c.id} c={c} />)}</ul>
      )}
    </>
  );
}
