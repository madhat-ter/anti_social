'use client';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Post } from '@/lib/api';
import { usePaged, useMe } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';
import { SeatedShell } from '@/components/Shell';
import { Composer } from '@/components/Composer';
import { PostList } from '@/components/PostList';
import { AccountUpdates, ArchivedCard, usePollMe, WaitlistCard } from '@/components/Lifecycle';

function FeedView({ onPosted }: { onPosted: () => void }) {
  const p = usePaged<Post>('feed', (c) => api.feed(c));
  useEffect(() => {
    if (window.location.hash !== '#compose') return;
    const ta = document.querySelector<HTMLTextAreaElement>('#compose textarea');
    ta?.focus();
  }, []);
  return (
    <>
      <h1 className="sr-only">Feed</h1>
      <div id="compose">
        <Composer
          onCreated={(post) => {
            p.setItems((cur) => [post, ...cur.filter((x) => x.id !== post.id)]);
            onPosted();
          }}
        />
      </div>
      <PostList p={p} empty="Nothing here yet. Be the first to post." />
    </>
  );
}

/** Waitlisted / archived users see only their status (RFC §5.1, §5.3). */
function StatusView({ refresh, children }: { refresh: () => Promise<void>; children: ReactNode }) {
  usePollMe(refresh);
  return <>{children}</>;
}

export default function Home() {
  const { me, loading, error, refresh } = useMe();

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <ErrorNote message={errorMessage(error)} />;

  if (!me) {
    return (
      <div className="stack">
        <h1>A small, quiet network.</h1>
        <p className="muted">Invite-only, one hundred seats, passkeys instead of passwords.</p>
        <div className="row">
          <Link className="btn primary" href="/join">Join with an invite</Link>
          <Link className="btn" href="/login">Sign in with passkey</Link>
        </div>
      </div>
    );
  }

  if (me.state === 'active' || me.state === 'flagged_lurker') {
    return (
      <SeatedShell me={me}>
        {/* refresh after posting so a flagged member's progress updates */}
        {() => <FeedView onPosted={() => { if (me.state === 'flagged_lurker') void refresh(); }} />}
      </SeatedShell>
    );
  }

  return (
    <StatusView refresh={refresh}>
      <div className="stack">
        <h1>@{me.handle}</h1>
        {me.state === 'waitlisted' && <WaitlistCard me={me} />}
        {me.state === 'archived' && <ArchivedCard me={me} refresh={refresh} />}
        <AccountUpdates />
        <div className="row"><Link href="/settings">Settings</Link></div>
      </div>
    </StatusView>
  );
}
