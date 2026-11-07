'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type EventDetail } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { EventForm } from '@/components/Events';
import { ErrorNote } from '@/components/ui';

export default function EditEventPage() {
  return <SeatedShell>{() => <Edit />}</SeatedShell>;
}

function Edit() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.event(id).then(setEv, (e) => setErr(errorMessage(e))); }, [id]);

  if (err) return <ErrorNote message={err} />;
  if (!ev) return <p className="muted" role="status">Loading...</p>;
  if (!ev.canEdit) return <p>This event can no longer be edited. <Link href={`/events/${id}`}>Back</Link></p>;
  return (
    <>
      <p><Link href={`/events/${id}`}>Back to the event</Link></p>
      <h1>Edit event</h1>
      <p className="muted">Changing the time or place notifies everyone who RSVP&apos;d.</p>
      <EventForm initial={ev} submitLabel="Save changes" onSubmit={async (b) => {
        await api.updateEvent(id, b);
        router.push(`/events/${id}`);
      }} />
    </>
  );
}
