'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Collab } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';
import { CollabForm } from '@/components/Collabs';

export default function EditCollabPage() {
  useTitle('Edit collab');
  return <SeatedShell>{() => <Edit />}</SeatedShell>;
}

function Edit() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Collab | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.collab(id).then(setC, (e) => setErr(errorMessage(e))); }, [id]);
  if (err) return <ErrorNote message={err} />;
  if (!c) return <Loading />;
  if (!c.canManage) return <p className="muted">Only the host and co-hosts can edit this. <Link href={`/collab/${id}`}>Back</Link></p>;
  return (
    <>
      <p><Link href={`/collab/${id}`}>Back to the collab</Link></p>
      <h1>Edit {c.kind}</h1>
      <p className="muted">
        Activity ↔ project can be switched below; an event never changes kind, and nothing that has finished may switch.
        {c.kind === 'activity' ? ' A group of more than 20 cannot become a project.' : ''}
      </p>
      <CollabForm kind={c.kind} initial={c} submitLabel="Save" onSubmit={async (b) => {
        await api.updateCollab(id, b);
        router.push(`/collab/${id}`);
      }} />
      <p className="muted small">Kind and team size are under More options.</p>
    </>
  );
}
