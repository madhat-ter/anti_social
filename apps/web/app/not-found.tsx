import Link from 'next/link';
import { AlertIcon, Win } from '@/components/retro';

export default function NotFound() {
  return (
    <div className="stack">
      <h1>Not found</h1>
      <Win title="Error" as="div" bodyClassName="dlg-body">
        <AlertIcon />
        <div className="stack dlg-main">
          <p className="dlg-msg">This page left the network. It may have been deleted, or the link is wrong.</p>
          <div className="row dlg-actions">
            <Link className="btn default" href="/">Back to the feed</Link>
          </div>
        </div>
      </Win>
    </div>
  );
}
