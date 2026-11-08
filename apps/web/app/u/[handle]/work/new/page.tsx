'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { ProjectForm } from '@/components/Project';

export default function NewProjectPage() {
  useTitle('New project');
  return <SeatedShell>{(me) => <Body myHandle={me.handle} />}</SeatedShell>;
}

function Body({ myHandle }: { myHandle: string }) {
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(params.handle);
  if (handle.toLowerCase() !== myHandle.toLowerCase()) {
    return <p>Only @{handle} can add to this portfolio. <Link href={`/u/${handle}`}>Back</Link></p>;
  }
  return <ProjectForm handle={myHandle} initial={null} />;
}
