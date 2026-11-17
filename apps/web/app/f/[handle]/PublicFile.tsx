'use client';
/** RFC §10.24: the share page's body. Always light, whatever the viewer chose inside anti. */
import Link from 'next/link';
import { useEffect } from 'react';
import { FileDrawer } from '@/components/File';

export function PublicFile({ handle }: { handle: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const was = root.getAttribute('data-theme');
    root.removeAttribute('data-theme');
    return () => { if (was) root.setAttribute('data-theme', was); };
  }, []);
  return (
    <div className="stack file-public">
      <FileDrawer handle={handle} pub />
      <p className="muted small file-public-foot">
        This File lives on <Link href="/">anti</Link>, a small network of a hundred seats. You need an invite to get in.
      </p>
    </div>
  );
}
