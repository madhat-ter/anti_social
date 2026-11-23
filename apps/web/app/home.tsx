'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Me, Post } from '@/lib/api';
import { usePaged, useMe, useTitle } from '@/lib/hooks';
import { ErrorNote } from '@/components/ui';
import { SeatedShell } from '@/components/Shell';
import { Composer } from '@/components/Composer';
import { FeedList, useFeedVisit } from '@/components/Feed';
import { AccountUpdates, ArchivedCard, usePollMe, WaitlistCard } from '@/components/Lifecycle';
import { CheckoutNotice } from '@/components/Billing';
import { Avatar } from '@/components/Avatar';
import { Welcome, wasWelcomed } from '@/components/Welcome';
import { Checklist } from '@/components/Checklist';
import { BirthdayLine } from '@/components/Birthday';
import { PickWindow, RAIL_QUERY, useWide } from '@/components/Picks';
import { PetFeedBlock } from '@/components/Pets';
import { HelloIcon, Loading, Win } from '@/components/retro';
import { SeatAsk } from '@/components/SeatAsk';
import { NameMarks } from '@/components/Marks';
import { About } from '@/components/About';

/** One face per seat. The whole network fits on one screen. */
const SEATS = Array.from({ length: 100 }, (_, i) => `seat-${i + 1}`);

/**
 * Seats fill in a scattered but fixed order: i*37 mod 100 visits every seat once
 * (37 and 100 share no factor), so it looks random but is the same every load.
 */
const seatDelay = (i: number) => 700 + ((i * 37) % 100) * 11; // ms: 0.7s → 1.8s

/** The page for someone not signed in. Exported so page.tsx can send it fully written out (RFC §10.29). */
export function Landing() {
  return (
    <div className="hero boot">
      <h1 className="hero-type" aria-label="Anti social.">
        <span className="solid" aria-hidden="true">Anti</span>
        <span className="outline" aria-hidden="true">Social<span className="stop">.</span></span>
      </h1>

      {/* RFC §10.25: the page speaks to someone who feels alone. Four lines, said one at a time. */}
      <div className="hero-sub">
        <div className="hero-say">
          <p>You may feel there&rsquo;s no one for you.</p>
          <p>We won&rsquo;t pretend: no one is coming to fix everything.</p>
          <p>But you&rsquo;re not the only one feeling this.</p>
          {/* two sentences that break between them, never inside one */}
          <p><span>We have each other.</span> <span>Some days, that&rsquo;s enough to stay.</span></p>
        </div>
      </div>

      <div className="zoom">
        {/* System 6 window-open "zoom rects" */}
        <span className="zoom-rect" aria-hidden="true" />
        <span className="zoom-rect" aria-hidden="true" />
        <span className="zoom-rect" aria-hidden="true" />
        {/* a welcome, not a warning: the old "delete Social Life" joke left with the old message */}
        <Win title="Welcome" as="div" bodyClassName="dlg-body">
          <HelloIcon />
          <div className="stack dlg-main">
            <p className="dlg-msg">There&rsquo;s a seat here for you.</p>
            <div className="row dlg-actions">
              <Link className="btn" href="/login">Sign in</Link>
              <Link className="btn default" href="/join">I have an invite</Link>
            </div>
          </div>
        </Win>
      </div>

      {/* a stranger with nothing in hand, and nobody inside to ask: they can ask us */}
      <SeatAsk />

      <section className="seats" aria-label="The hundred seats">
        <div className="seat-grid" aria-hidden="true">
          {SEATS.map((s, i) => (
            <span key={s} className="seat" style={{ '--d': `${seatDelay(i)}ms` } as React.CSSProperties}>
              {/* half women, half men, scattered the same way the seats fill */}
              <Avatar seed={s} gender={((i * 37) % 100) % 2 ? 'woman' : 'man'} size={44} />
            </span>
          ))}
        </div>
        <p className="seats-caption">Every face is a person. The room is small on purpose, so you get noticed.</p>
      </section>

      {/* the same three rules as before, said as what they do for the person reading */}
      <ul className="rules">
        <li><b>In the open</b><span>No private messages. Everything is said where everyone can see, so no one can corner you.</span></li>
        <li><b>No algorithm</b><span>Nothing here is built to keep you scrolling. One feed, likes never move a post, and you will reach the end.</span></li>
        <li><b>Small on purpose</b><span>A hundred seats, so people know your name. Away for 30 days and your seat passes to someone waiting; you can ask for it back.</span></li>
      </ul>

      {/* RFC §10.29: what anti is and five answers, for people (and search engines) arriving cold */}
      <About />
    </div>
  );
}

/**
 * New posts since the feed loaded, found by the same poll rhythm as the unread count (every 30 s
 * while the tab is in front, and on focus). They wait behind a "3 new posts" pill rather than
 * jumping the list, so nothing moves under a reader's thumb.
 */
function useNewPosts(p: ReturnType<typeof usePaged<Post>>, until: string | null) {
  const [pending, setPending] = useState<Post[]>([]);
  const items = p.items;
  // RFC §10.23: in a mixed visit, posts up to `until` are in the mix (maybe on a later page); only later ones are new
  const after = until ? Date.parse(until) : Number.NEGATIVE_INFINITY;
  useEffect(() => {
    if (p.loading) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const page = await api.feed(null);
        if (!alive) return;
        const have = new Set(items.map((x) => x.id));
        setPending((cur) => {
          const known = new Set([...have, ...cur.map((x) => x.id)]);
          const fresh = page.items.filter((x) => !x.parentId && !known.has(x.id) && Date.parse(x.createdAt) > after);
          return fresh.length ? [...fresh, ...cur] : cur;
        });
      } catch { /* next tick */ }
    };
    const t = setInterval(() => void check(), 30_000);
    window.addEventListener('focus', check);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', check); };
  }, [items, p.loading, after]);
  const show = () => {
    p.setItems((cur) => { const ids = new Set(cur.map((x) => x.id)); return [...pending.filter((x) => !ids.has(x.id)), ...cur]; });
    setPending([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  /** a post you just wrote is not "new" to you */
  const forget = (id: string) => setPending((cur) => cur.filter((x) => x.id !== id));
  return { pending, show, forget };
}

function FeedView({ me, onPosted }: { me: Me; onPosted: () => void }) {
  useTitle('Feed');
  // the side rail (pick window, birthdays) is only on screen from 1180px; narrower, both sit in the feed
  const wide = useWide(RAIL_QUERY);
  // one pet stop per visit, somewhere between the 4th and 10th post (RFC §10.17)
  const [petAfter] = useState(() => 4 + Math.floor(Math.random() * 7));
  const fv = useFeedVisit(me.handle);
  // the first page starts (or resumes) a visit and brings back its "new since" line (RFC §10.11)
  const p = usePaged<Post>('feed', async (c) => {
    const page = await api.feed(c, 20, c ? {} : fv.params());
    if (page.visit) fv.got(page.visit);
    return page;
  });
  const fresh = useNewPosts(p, fv.visit?.mix?.until ?? null);
  useEffect(() => {
    if (window.location.hash !== '#compose') return;
    const ta = document.querySelector<HTMLTextAreaElement>('#compose textarea');
    ta?.focus();
  }, []);
  return (
    <>
      <h1 className="sr-only">Feed</h1>
      {wide === false && <BirthdayLine />}
      <div id="compose">
        <Composer
          collapsible
          record
          onCreated={(post) => {
            p.setItems((cur) => [post, ...cur.filter((x) => x.id !== post.id)]);
            fresh.forget(post.id);
            onPosted();
          }}
        />
      </div>
      {fresh.pending.length > 0 && (
        <button type="button" className="new-posts" onClick={fresh.show} aria-live="polite">
          {fresh.pending.length} new {fresh.pending.length === 1 ? 'post' : 'posts'} <span aria-hidden="true">↑</span>
        </button>
      )}
      {/* without the side rail (phones, tablets): the pick window sits after the first few posts, not before the first one */}
      <FeedList
        p={p}
        visit={fv.visit}
        mine={me.handle}
        empty="It is quiet in here. Write the first post: the other seats will see it next time they come in."
        interludes={wide === false ? [
          { after: 3, node: <PickWindow className="feed-pick" /> },
          { after: petAfter, node: <PetFeedBlock me={me} /> },
        ] : undefined}
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
            <Intro me={m} refreshKey={posted} />
            <CheckoutNotice refresh={refresh} />
            <FeedView me={m} onPosted={() => { setPosted((n) => n + 1); if (me.state === 'flagged_lurker') void refresh(); }} />
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
