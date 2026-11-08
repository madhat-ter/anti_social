'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, type AnEvent } from '@/lib/api';
import { usePaged, useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ListStatus, PagedFooter } from '@/components/Paged';
import { EventCard } from '@/components/Events';
import { WatchOnly, useReadOnly } from '@/components/Visitor';

export default function EventsPage() {
  useTitle('Events');
  return <SeatedShell>{() => <EventsList />}</SeatedShell>;
}

function EventsList() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const readOnly = useReadOnly();
  const p = usePaged<AnEvent>(`events:${scope}`, (c) => api.events(scope, c));
  return (
    <>
      <div className="row between">
        <h1>Events</h1>
        {readOnly ? <WatchOnly>Host an event</WatchOnly> : <Link className="btn primary" href="/events/new">Host an event</Link>}
      </div>
      <div className="tabs" role="tablist">
        {(['upcoming', 'past'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={scope === s} className={scope === s ? 'tab on' : 'tab'} onClick={() => setScope(s)}>
            {s === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>
      <ListStatus p={p} count={p.items.length} empty={scope === 'upcoming' ? 'Nothing planned yet. Host something small.' : 'No past events.'} />
      {p.items.length > 0 && <ul className="events">{p.items.map((e) => <EventCard key={e.id} e={e} />)}</ul>}
      <PagedFooter p={p} />
    </>
  );
}
