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
import { CheckoutNotice } from '@/components/Billing';
import { Avatar } from '@/components/Avatar';
import { AlertIcon, Loading, Win } from '@/components/retro';

/** One face per seat. The whole network fits on one screen. */
const SEATS = Array.from({ length: 100 }, (_, i) => `seat-${i + 1}`);

function Landing() {
  return (
    <div className="hero">
      <h1 className="hero-type" aria-label="Anti social.">
        <span className="solid" aria-hidden="true">Anti</span>
        <span className="outline" aria-hidden="true">Social<span className="stop">.</span></span>
      </h1>

      <p className="hero-sub">
        A small network that would rather you went outside. You need an invite to get in, and there are
        only a hundred seats. No messages, no algorithm, no follower counts.
      </p>

      <Win title="Alert" as="div" bodyClassName="dlg-body">
        <AlertIcon />
        <div className="stack dlg-main">
          <p className="dlg-msg">Are you sure you want to delete &ldquo;Social Life&rdquo;?</p>
          <div className="row dlg-actions">
            <Link className="btn" href="/login">Sign in</Link>
            <Link className="btn default" href="/join">Join with an invite</Link>
          </div>
        </div>
      </Win>

      <section className="seats" aria-label="The hundred seats">
        <div className="seat-grid" aria-hidden="true">
          {SEATS.map((s) => <Avatar key={s} seed={s} size={44} />)}
        </div>
        <p className="seats-caption">Every face is a seat. When someone stops showing up, their seat goes to the next person waiting.</p>
      </section>

      <ul className="rules">
        <li><b>No DMs</b><span>Replies are public. If you want to talk, host an event and meet.</span></li>
        <li><b>No algorithm</b><span>One feed, newest first. You will reach the end of it.</span></li>
        <li><b>Show up</b><span>Disappear for 30 days and your seat goes to someone who will.</span></li>
      </ul>
    </div>
  );
}

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

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={errorMessage(error)} />;

  if (!me) return <Landing />;

  if (me.state === 'active' || me.state === 'flagged_lurker') {
    return (
      <SeatedShell me={me}>
        {/* refresh after posting so a flagged member's progress updates */}
        {() => (
          <>
            <CheckoutNotice refresh={refresh} />
            <FeedView onPosted={() => { if (me.state === 'flagged_lurker') void refresh(); }} />
          </>
        )}
      </SeatedShell>
    );
  }

  return (
    <StatusView refresh={refresh}>
      <div className="stack">
        <div className="status-head">
          <Avatar seed={me.handle} size={64} />
          <div>
            <h1>{me.displayName}</h1>
            <p className="ui muted">@{me.handle}</p>
          </div>
        </div>
        <CheckoutNotice refresh={refresh} />
        {me.state === 'waitlisted' && <WaitlistCard me={me} />}
        {me.state === 'archived' && <ArchivedCard me={me} refresh={refresh} />}
        <AccountUpdates />
        <div className="row"><Link href="/settings">Settings</Link></div>
      </div>
    </StatusView>
  );
}
