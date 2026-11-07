'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { SeatedShell } from '@/components/Shell';
import { EventForm } from '@/components/Events';

export default function NewEventPage() {
  const router = useRouter();
  return (
    <SeatedShell>
      {() => (
        <>
          <p><Link href="/events">Back to events</Link></p>
          <h1>Host an event</h1>
          <p className="muted">Anyone with a seat can host. Once a member you confirm actually came, hosting counts as taking part.</p>
          <EventForm submitLabel="Create event" onSubmit={async (b) => {
            const e = await api.createEvent(b);
            router.push(`/events/${e.id}`);
          }} />
        </>
      )}
    </SeatedShell>
  );
}
