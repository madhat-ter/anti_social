'use client';
/** RFC §10.24: a member's File, as everyone inside sees it. */
import { useParams } from 'next/navigation';
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { FileDrawer } from '@/components/File';

export default function MemberFilePage() {
  const { handle } = useParams<{ handle: string }>();
  useTitle(`${handle}’s File`);
  return <SeatedShell>{() => <FileDrawer handle={decodeURIComponent(handle)} />}</SeatedShell>;
}
