'use client';
/** RFC §10.24: your own File, with the tools to make cards and arrange the pages. */
import { useTitle } from '@/lib/hooks';
import { SeatedShell } from '@/components/Shell';
import { FileDrawer } from '@/components/File';

export default function MyFilePage() {
  useTitle('File');
  return (
    <SeatedShell>
      {(me) => (me.visitor
        ? <p className="muted">Visitors have no File of their own. Open a member&rsquo;s profile to see theirs.</p>
        : <FileDrawer handle={me.handle} />)}
    </SeatedShell>
  );
}
