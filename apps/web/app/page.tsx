'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Me, Post } from '@/lib/api';
import { usePaged, useMe, useTitle } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';
import { SeatedShell } from '@/components/Shell';
import { Composer } from '@/components/Composer';
import { PostList } from '@/components/PostList';
import { AccountUpdates, ArchivedCard, usePollMe, WaitlistCard } from '@/components/Lifecycle';
import { CheckoutNotice } from '@/components/Billing';
import { Avatar } from '@/components/Avatar';
import { Welcome, wasWelcomed } from '@/components/Welcome';
import { Checklist } from '@/components/Checklist';
import { BirthdayLine } from '@/components/Birthday';
import { PickWindow, useWide } from '@/components/Picks';
import { AlertIcon, Loading, Win } from '@/components/retro';
import { NameMarks } from '@/components/Marks';
import { VisitorCodeForm, WatchOnlyNote, useReadOnly } from '@/components/Visitor';

/** One face per seat. The whole network fits on one screen. */
const SEATS = Array.from({ length: 100 }, (_, i) => `seat-${i + 1}`);

/**
 * Seats fill in a scattered but fixed order: i*37 mod 100 visits every seat once
 * (37 and 100 share no factor), so it looks random but is the same every load.
 */
const seatDelay = (i: number) => 700 + ((i * 37) % 100) * 11; // ms: 0.7s → 1.8s

function Landing() {
  return (
    <div className="hero boot">
      <h1 className="hero-type" aria-label="Anti social.">
        <span className="solid" aria-hidden="true">Anti</span>
        <span className="outline" aria-hidden="true">Social<span className="stop">.</span></span>
      </h1>

      <p className="hero-sub">
        A small network that would rather you went outside. You need an invite to get in, and there are
        only a hundred seats. No messages, no algorithm, no follower counts.
      </p>

      <div className="zoom">
        {/* System 6 window-open "zoom rects" */}
        <span className="zoom-rect" aria-hidden="true" />
        <span className="zoom-rect" aria-hidden="true" />
        <span className="zoom-rect" aria-hidden="true" />
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
      </div>

      {/* RFC §10.8: an admin's one-hour pass; the link form of it lands on /visit/<code> */}
      <div className="visit-entry"><VisitorCodeForm compact /></div>

      <section className="seats" aria-label="The hundred seats">
        <div className="seat-grid" aria-hidden="true">
          {SEATS.map((s, i) => (
            <span key={s} className="seat" style={{ '--d': `${seatDelay(i)}ms` } as React.CSSProperties}>
              <Avatar seed={s} size={44} />
            </span>
          ))}
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
  useTitle('Feed');
  const wide = useWide();
  const readOnly = useReadOnly();
  const p = usePaged<Post>('feed', (c) => api.feed(c));
  useEffect(() => {
    if (window.location.hash !== '#compose') return;
    const ta = document.querySelector<HTMLTextAreaElement>('#compose textarea');
    ta?.focus();
  }, []);
  return (
    <>
      <h1 className="sr-only">Feed</h1>
      {wide === false && <BirthdayLine />}
      {/* a visitor on a phone gets one line where the composer would be: the first screen is posts, not a dead box */}
      {readOnly && <div className="phone-only"><WatchOnlyNote banner /></div>}
      <div id="compose" className={readOnly ? 'wide-only' : undefined}>
        <Composer
          collapsible
          onCreated={(post) => {
            p.setItems((cur) => [post, ...cur.filter((x) => x.id !== post.id)]);
            onPosted();
          }}
        />
      </div>
      {/* phones: the pick window sits after the first few posts, not before the first one */}
      <PostList
        p={p}
        empty="It is quiet in here. Write the first post: the other seats will see it next time they come in."
        interlude={wide === false ? { after: 3, node: <PickWindow className="feed-pick" /> } : undefined}
      />
    </>
  );
}

/** First the house rules (once per device); after that, the "Finish your profile" checklist (RFC §10.3). */
function Intro({ me, refreshKey }: { me: Me; refreshKey: number }) {
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  useEffect(() => { setWelcomed(wasWelcomed(me.handle)); }, [me.handle]);
  if (welcomed === null) return null;
  return welcomed ? <Checklist me={me} refreshKey={refreshKey} /> : <Welcome me={me} onDone={() => setWelcomed(true)} />;
}

/** Waitlisted / archived users see only their status (RFC §5.1, §5.3). */
function StatusView({ refresh, children }: { refresh: () => Promise<void>; children: ReactNode }) {
  usePollMe(refresh);
  return <>{children}</>;
}

export default function Home() {
  const { me, loading, error, refresh } = useMe();
  const [posted, setPosted] = useState(0);

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={errorMessage(error)} />;

  if (!me) return <Landing />;

  if (me.state === 'active' || me.state === 'flagged_lurker') {
    return (
      <SeatedShell me={me}>
        {/* refresh after posting so a flagged member's progress updates */}
        {(m) => (
          <>
            {!m.visitor && <Intro me={m} refreshKey={posted} />}
            <CheckoutNotice refresh={refresh} />
            <FeedView onPosted={() => { setPosted((n) => n + 1); if (me.state === 'flagged_lurker') void refresh(); }} />
          </>
        )}
      </SeatedShell>
    );
  }

  return (
    <StatusView refresh={refresh}>
      <div className="stack">
        <div className="status-head">
          <Avatar seed={me.handle} gender={me.gender} size={64} />
          <div>
            <h1>{me.displayName}<NameMarks admin={me.role === 'ops'} verified={!!me.verifiedAt} size=".8em" /></h1>
            <p className="meta">@{me.handle}</p>
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
