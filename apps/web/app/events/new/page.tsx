'use client';
import { useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Collab } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { EventForm } from '@/components/Events';

export default function NewEventPage() {
  useTitle('Host an event');
  return <SeatedShell>{() => <NewEvent />}</SeatedShell>;
}

/** `?collab=<id>`: a meetup for that collab (RFC §10.5), team-only unless they open it up. */
function NewEvent() {
  const router = useRouter();
  const [collab, setCollab] = useState<Collab | null>(null);
  const [audience, setAudience] = useState<'team' | 'anyone'>('team');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('collab');
    if (id) api.collab(id).then((c) => { if (c.my.role) setCollab(c); }, () => {});
  }, []);
  return (
    <>
      <p>{collab ? <Link href={`/collabs/${collab.id}`}>Back to {collab.title}</Link> : <Link href="/events">Back to events</Link>}</p>
      <h1>{collab ? 'Plan a meetup' : 'Host an event'}</h1>
      {collab ? (
        <div className="stack">
          <p className="muted">A time and place for the team of <strong>{collab.title}</strong> to meet and work on it. The team gets a notification.</p>
          <fieldset className="stack meetup-audience">
            <legend>Who can see it</legend>
            <label className="check"><input type="radio" name="audience" checked={audience === 'team'} onChange={() => setAudience('team')} /> Only the team</label>
            <label className="check"><input type="radio" name="audience" checked={audience === 'anyone'} onChange={() => setAudience('anyone')} /> Anyone: it shows in Events too</label>
          </fieldset>
        </div>
      ) : (
        <p className="muted">Anyone with a seat can host. Once a member you confirm actually came, hosting counts as taking part.</p>
      )}
      <EventForm submitLabel={collab ? 'Plan it' : 'Create event'} onSubmit={async (b) => {
        const e = await api.createEvent(collab ? { ...b, collabId: collab.id, audience } : b);
        router.push(`/events/${e.id}`);
      }} />
    </>
  );
}
