'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage, type PfStyle, type Project, type ProjectSummary } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ProjectView } from '@/components/Project';
import { ErrorNote } from '@/components/ui';
import { Loading } from '@/components/retro';

export default function ProjectPage() {
  useTitle('Project');
  return <SeatedShell>{() => <Body />}</SeatedShell>;
}

function Body() {
  const params = useParams<{ handle: string; id: string }>();
  const handle = decodeURIComponent(params.handle);
  const [p, setP] = useState<Project | null>(null);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [style, setStyle] = useState<PfStyle>({ font: 'archivo', bg: 'paper', accent: 'red' });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setP(null); setErr(null);
    Promise.all([api.project(handle, params.id), api.projects(handle)]).then(
      ([proj, l]) => { if (alive) { setP(proj); setList(l.items); setStyle(l.style); } },
      (e) => { if (alive) setErr(errorMessage(e)); },
    );
    return () => { alive = false; };
  }, [handle, params.id]);

  if (err) return <><ErrorNote message={err} /><p><Link href={`/u/${handle}`}>Back to @{handle}</Link></p></>;
  if (!p) return <Loading />;
  return <ProjectView project={p} siblings={list} style={style} />;
}
