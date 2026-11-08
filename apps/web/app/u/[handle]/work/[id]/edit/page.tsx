'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Project } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ProjectForm } from '@/components/Project';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';

export default function EditProjectPage() {
  useTitle('Edit project');
  return <SeatedShell>{() => <Body />}</SeatedShell>;
}

function Body() {
  const params = useParams<{ handle: string; id: string }>();
  const handle = decodeURIComponent(params.handle);
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.project(handle, params.id).then(setP, (e) => setErr(errorMessage(e))); }, [handle, params.id]);

  if (err) return <><ErrorNote message={err} /><p><Link href={`/u/${handle}`}>Back to @{handle}</Link></p></>;
  if (!p) return <Loading />;
  if (!p.mine) return <p>Only @{p.handle} can edit this project. <Link href={`/u/${handle}/work/${p.id}`}>Back</Link></p>;
  return <ProjectForm handle={p.handle} initial={p} />;
}
