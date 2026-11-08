'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { CollabForm } from '@/components/Collabs';

export default function NewCollabPage() {
  useTitle('Start a collab');
  const router = useRouter();
  return (
    <SeatedShell>
      {() => (
        <>
          <p><Link href="/collabs">Back to collabs</Link></p>
          <h1>Start a collab</h1>
          <p className="muted">A project or activity you want to do with others. You host it; you can make teammates co-hosts later.</p>
          <CollabForm submitLabel="Start it" onSubmit={async (b) => {
            const c = await api.createCollab(b);
            router.push(`/collabs/${c.id}`);
          }} />
        </>
      )}
    </SeatedShell>
  );
}
