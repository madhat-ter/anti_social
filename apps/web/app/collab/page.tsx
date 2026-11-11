'use client';
/**
 * RFC §10.21: the Collab page. One place holding events, activities and projects: what is yours
 * (when there is anything), what is coming up, what fits your interests, then one list with chips.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type AnEvent, type CollabPageItem, type CollabSummary, type Interest, type Me, type MyCollab } from '@/lib/api';
import { interestsCached } from '@/lib/interests';
import { usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { Loading } from '@/components/retro';
import { CollabItemCard } from '@/components/Collab';
import { ListStatus, PagedFooter } from '@/components/Paged';
import { WatchOnly, useReadOnly } from '@/components/Visitor';

export default function CollabPage() {
  useTitle('Collab');
  return <SeatedShell>{(me) => <CollabHome me={me} />}</SeatedShell>;
}

const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'event', label: 'Events' },
  { key: 'activity', label: 'Activities' },
  { key: 'project', label: 'Projects' },
] as const;

function CollabHome({ me }: { me: Me }) {
  const readOnly = useReadOnly();
  const [intro, setIntro] = useState(!me.collabIntroSeen);
  const [mine, setMine] = useState<MyCollab | null>(null);
  const [upcoming, setUpcoming] = useState<AnEvent[] | null>(null);
  const [forYou, setForYou] = useState<CollabSummary[] | null>(null);
  const [all, setAll] = useState<Interest[]>([]);
  const [kind, setKind] = useState<(typeof CHIPS)[number]['key']>('all');
  const [interest, setInterest] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { interestsCached().then(setAll, () => {}); }, []);
  useEffect(() => {
    if (readOnly) return;
    api.myCollab().then(setMine, () => setMine({ hosting: [], in: [], going: [], waiting: [] }));
  }, [readOnly]);
  useEffect(() => {
    api.events('upcoming', null, 5).then((p) => setUpcoming(p.items), () => setUpcoming([]));
    api.collabs('for-you').then((p) => setForYou(p.items.slice(0, 6)), () => setForYou([]));
  }, []);

  const p = usePaged<CollabPageItem>(`collab:${kind}:${interest}:${done ? 1 : 0}`, (c) =>
    api.collabPage({ kind, interest: interest || null, done, cursor: c }));

  async function dismissIntro() {
    setIntro(false);
    await api.dismissCollabIntro().catch(() => {});
  }

  const yoursShown = !!mine && (mine.hosting.length > 0 || mine.in.length > 0 || mine.going.length > 0 || mine.waiting.length > 0);

  return (
    <>
      <div className="row between">
        <h1>Collab</h1>
        {readOnly
          ? <WatchOnly>Start something</WatchOnly>
          : <Link className="btn primary" href="/collab/new">+ Start</Link>}
      </div>
      <p className="muted">Events, activities and projects: a picnic on Saturday, a Sunday run club, a zine made together. Join one, or start your own.</p>

      {intro && (
        <div className="banner" role="status">
          Events and Collabs are one place now.{' '}
          <button type="button" className="btn" onClick={() => void dismissIntro()}>Got it</button>
        </div>
      )}

      {yoursShown && (
        <section className="stack yours" aria-label="Yours">
          <h2 className="section-h">Yours</h2>
          {mine!.waiting.length > 0 && (
            <ul className="chips waiting-chips" aria-label="Waiting on you">
              {mine!.waiting.map((w) => (
                <li key={`${w.type}:${w.id}`}>
                  <Link className="chip on" href={w.type === 'event' ? `/collab/event/${w.id}` : `/collab/${w.id}`}>
                    {w.count} {w.count === 1 ? 'request' : 'requests'} · {w.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ul className="collabs">
            {[...mine!.hosting, ...mine!.in, ...mine!.going].map((it) => <CollabItemCard key={`${it.type}:${it.id}`} item={it} />)}
          </ul>
        </section>
      )}

      <section className="stack">
        <h2 className="section-h">Coming up</h2>
        {upcoming === null ? <Loading /> : upcoming.length === 0
          ? <p className="muted">Nothing coming up. <Link href="/collab/new?kind=event">Start one?</Link></p>
          : (
            <ul className="collabs">
              {upcoming.map((e) => (
                <CollabItemCard key={e.id} item={{ type: 'event', createdAt: e.startsAt, ...e }} />
              ))}
            </ul>
          )}
      </section>

      {forYou && forYou.length > 0 && (
        <section className="stack">
          <h2 className="section-h">For you</h2>
          <ul className="collabs">
            {forYou.map((c) => <CollabItemCard key={c.id} item={{ type: 'collab', ...c }} />)}
          </ul>
        </section>
      )}

      <div className="row between collab-bar">
        <div className="tabs" role="tablist" aria-label="Kinds">
          {CHIPS.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={kind === c.key} className={kind === c.key ? 'tab on' : 'tab'}
              onClick={() => setKind(c.key)}>
              {c.label}
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

      <ListStatus p={p} count={p.items.length} empty={done ? 'Nothing here yet.' : 'Nothing yet. Start the first one.'} />
      {p.items.length > 0 && <ul className="collabs">{p.items.map((it) => <CollabItemCard key={`${it.type}:${it.id}`} item={it} />)}</ul>}
      <PagedFooter p={p} />

      {done
        ? <p><button type="button" className="link-btn" onClick={() => setDone(false)}>Back to what is on</button></p>
        : <p><button type="button" className="link-btn" onClick={() => setDone(true)}>Past and finished</button></p>}
    </>
  );
}
