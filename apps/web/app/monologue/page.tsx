'use client';
/**
 * RFC §10.22: the Monologue tab. The feed's rules (newest first, a "new since" line of its own,
 * an end card), only monologues, filtered by kind. The only way in to record one is "+ Record".
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { MONOLOGUE, type MonologueKind } from '@anti/shared';
import { api, type Me, type Post } from '@/lib/api';
import { usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { FeedList, useFeedVisit } from '@/components/Feed';
import { WatchOnly, useReadOnly } from '@/components/Visitor';

export default function MonologuePage() {
  useTitle('Monologue');
  return <SeatedShell>{(me) => <Monologues me={me} />}</SeatedShell>;
}

const CHIPS: { key: MonologueKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'song', label: 'Songs' },
  { key: 'thought', label: 'Thoughts' },
  { key: 'yap', label: 'Yaps' },
];

function Monologues({ me }: { me: Me }) {
  const readOnly = useReadOnly();
  const [kind, setKind] = useState<MonologueKind | 'all'>('all');
  const fv = useFeedVisit(me.handle, 'monologue');
  const p = usePaged<Post>(`monologues:${kind}`, async (c) => {
    const page = await api.monologues(c, 20, { kind: kind === 'all' ? null : kind, ...(c ? {} : fv.params()) });
    if (page.visit) fv.got(page.visit);
    return page;
  });
  const caughtUp = useCallback((through: string) => api.monologuesCaughtUp(through), []);

  return (
    <>
      <div className="row between">
        <h1>Monologue</h1>
        {readOnly
          ? <WatchOnly>Record</WatchOnly>
          : <Link className="btn primary" href="/monologue/new">+ Record</Link>}
      </div>
      <p className="muted">
        Say one thing well. A song, a thought, a yap: {MONOLOGUE.maxSeconds / 60} minutes at most, in your own voice.
      </p>
      <div className="tabs mono-chips" role="tablist" aria-label="Kinds">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={kind === c.key} className={kind === c.key ? 'tab on' : 'tab'}
            onClick={() => setKind(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <FeedList
        p={p} visit={fv.visit} mine={me.handle} readOnly={readOnly} what="monologues" caughtUp={caughtUp}
        empty={kind === 'all'
          ? 'No monologues yet. Record the first one: a song, a thought, or just a yap.'
          : `No ${CHIPS.find((c) => c.key === kind)!.label.toLowerCase()} yet.`}
      />
    </>
  );
}
