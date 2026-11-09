'use client';
/**
 * RFC §10.11: the home feed. Newest first and never ranked; what this adds is a frozen line where
 * you left off, and an end. Above the line: what is new since your last visit, with a few rows
 * placed at their own time (a conversation on an older post, a new event), and a busy poster's
 * extra posts folded into one row. At the line: the "caught up" card, and the feed stops (nothing
 * loads on its own below it). Older posts come only when you ask for them.
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FEED, foldBusy, type FeedItem } from '@anti/shared';
import { api, type FeedEventRow, type FeedThreadRow, type FeedVisit, type Post } from '@/lib/api';
import type { usePaged } from '@/lib/hooks';
import { ListStatus, PagedFooter } from './Paged';
import { PostCard, replaceIn } from './PostCard';
import { dayLabel } from './PostList';
import { eventTime } from './Events';
import { Avatar } from './Avatar';
import { Win } from './retro';

type Stored = { since: string; capped: boolean; visitId: number | null; at: number };
const GAP_MS = FEED.visitGapMinutes * 60_000;
const keyFor = (handle: string) => `anti:feed-visit:${handle}`;

function read(handle: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(keyFor(handle));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch { return null; }
}
function write(handle: string, s: Stored) {
  try { sessionStorage.setItem(keyFor(handle), JSON.stringify(s)); } catch { /* private mode: the visit just restarts */ }
}

/**
 * One visit per tab: a new one starts when the feed opens after half an hour with no feed
 * activity; until then a reload keeps the same line, so nothing you have not read is skipped.
 */
export function useFeedVisit(handle: string) {
  const [visit, setVisit] = useState<FeedVisit | null>(null);
  const stored = useRef<Stored | null>(null);

  /** what the first page asks for: resume a live visit, or start one */
  const params = useCallback((): { visit?: boolean; since?: string } => {
    const s = read(handle);
    stored.current = s;
    return s && Date.now() - s.at < GAP_MS ? { since: s.since } : { visit: true };
  }, [handle]);

  const got = useCallback((v: FeedVisit) => {
    const visitId = v.visitId ?? stored.current?.visitId ?? null;
    const s: Stored = { since: v.since, capped: v.capped, visitId, at: Date.now() };
    stored.current = s;
    write(handle, s);
    setVisit({ ...v, visitId });
  }, [handle]);

  // reading the feed keeps the visit alive
  useEffect(() => {
    const touch = () => {
      if (document.visibilityState !== 'visible' || !stored.current) return;
      stored.current = { ...stored.current, at: Date.now() };
      write(handle, stored.current);
    };
    const t = setInterval(touch, 60_000);
    window.addEventListener('scroll', touch, { passive: true });
    return () => { clearInterval(t); window.removeEventListener('scroll', touch); };
  }, [handle]);

  return { visit, params, got };
}

/** "Tue 9:14 pm", or "this past week" when the line sits at the week's edge */
export function sinceLabel(v: FeedVisit): string {
  if (v.capped) return 'this past week';
  const d = new Date(v.since);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = dayLabel(v.since);
  if (day === 'Today' || day === 'Yesterday') return `${day.toLowerCase()}, ${time}`;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** the viewer's local day: the same boundary the day headers draw */
const localDay = (iso: string) => new Date(iso).toDateString();
const firstName = (s: string) => s.split(/\s+/)[0] || s;

/** The card at the line. Once it has been on screen, everything above it counts as read. */
function EndCard({ visit, nothingNew, olderToShow, onShowOlder, onSeen }: {
  visit: FeedVisit; nothingNew: boolean; olderToShow: boolean; onShowOlder: () => void; onSeen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (!seen.current && entries.some((e) => e.isIntersecting)) { seen.current = true; onSeen(); }
    }, { threshold: 0.6 });
    io.observe(node);
    return () => io.disconnect();
  }, [onSeen]);
  const when = sinceLabel(visit);
  const ev = visit.nextEvent;
  return (
    <div ref={ref} className="feed-end" role="status">
      <Win title="The end" as="div" bodyClassName="feed-end-body">
        <p className="feed-end-head">{nothingNew ? 'Nothing new.' : 'You’re caught up.'}</p>
        <p className="meta">
          {nothingNew
            ? <>Nothing new since {when}. That&rsquo;s the whole feed.</>
            : <>That&rsquo;s everything since {when}.</>}
        </p>
        {ev && (
          <p className="meta feed-end-event">
            <Link href={`/events/${ev.id}`}>{ev.title}</Link>, {eventTime(ev.startsAt, null)}.{' '}
            {ev.imGoing ? 'You’re going.' : <>{ev.going > 0 ? `${ev.going} going. ` : ''}<Link href={`/events/${ev.id}`}>RSVP</Link></>}
          </p>
        )}
        <p className="feed-end-out">Go outside.</p>
        {olderToShow && <button type="button" className="btn" onClick={onShowOlder}>Show older posts</button>}
        <Link href="/feed-rules" className="small">How the feed works</Link>
      </Win>
    </div>
  );
}

function ThreadLine({ row }: { row: FeedThreadRow }) {
  const who = row.author ? `${firstName(row.author.displayName)}’s post` : 'A post';
  const day = dayLabel(row.postedAt);
  return (
    <Link href={`/p/${row.rootId}`} className="feed-row">
      {row.author && <Avatar seed={row.author.handle} gender={row.author.gender} size={28} />}
      <span>
        {who} from {day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}: {row.repliers} people replied since you were here
      </span>
    </Link>
  );
}

function EventLine({ row }: { row: FeedEventRow }) {
  return (
    <Link href={`/events/${row.id}`} className="feed-row">
      {row.host && <Avatar seed={row.host.handle} gender={row.host.gender} size={28} />}
      <span>
        {row.host ? firstName(row.host.displayName) : 'Someone'} is hosting <b>{row.title}</b>
        {' · '}{eventTime(row.startsAt, null)}{row.going > 0 ? ` · ${row.going} going` : ''}
        {' · '}<span className="feed-row-act">{row.joinMode === 'approve' ? 'Ask to join' : 'RSVP'}</span>
      </span>
    </Link>
  );
}

function FoldRow({ fold, open, onToggle }: { fold: Extract<FeedItem<Post>, { kind: 'fold' }>; open: boolean; onToggle: () => void }) {
  const name = fold.posts[0]?.author ? firstName(fold.posts[0].author.displayName) : fold.handle;
  const day = dayLabel(fold.posts[0]!.createdAt);
  const when = day === 'Today' ? 'today' : day === 'Yesterday' ? 'yesterday' : `on ${day}`;
  return (
    <button type="button" className="feed-fold" aria-expanded={open} onClick={onToggle}>
      {open ? 'Hide' : `${fold.posts.length} more from ${name} ${when}`}
    </button>
  );
}

type Row = { kind: 'thread'; at: string; row: FeedThreadRow } | { kind: 'event'; at: string; row: FeedEventRow };
const itemTime = (x: FeedItem<Post>) => (x.kind === 'post' ? x.post.createdAt : x.posts[0]!.createdAt);

/**
 * The list itself. Day headers as in PostList; `interlude` (the pick window on phones) after the
 * `after`-th post. `mine` is the viewer's handle: your own posts are never new to you, never folded.
 */
export function FeedList({ p, visit, mine, readOnly, empty, interlude }: {
  p: ReturnType<typeof usePaged<Post>>; visit: FeedVisit | null; mine: string; readOnly: boolean; empty: string;
  interlude?: { after: number; node: ReactNode };
}) {
  const [older, setOlder] = useState(false);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const caught = useRef<string | null>(null);
  const items = p.items;
  const since = visit ? Date.parse(visit.since) : Number.NEGATIVE_INFINITY;
  const newer = (iso: string) => Date.parse(iso) > since;
  const above = visit ? items.filter((x) => newer(x.createdAt)) : items;
  const below = visit ? items.filter((x) => !newer(x.createdAt)) : [];
  /** the line is reached once a post at or under it is loaded, or there are no more pages */
  const reached = !!visit && (below.length > 0 || !p.hasMore);
  const fresh = above.filter((x) => x.author?.handle !== mine).length;

  const newest = items[0]?.createdAt ?? null;
  const onSeen = useCallback(() => {
    if (readOnly || !visit || !newest || caught.current === newest) return;
    caught.current = newest;
    api.caughtUp(newest, visit.visitId).catch(() => { caught.current = null; });
  }, [readOnly, visit, newest]);

  const toggle = (key: string) => setOpenFolds((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // rows only live above the line, at their own time (newest first, like everything else)
  const rows: Row[] = visit
    ? [...visit.threads.map((row) => ({ kind: 'thread' as const, at: row.at, row })),
       ...visit.events.map((row) => ({ kind: 'event' as const, at: row.at, row }))]
      .filter((r) => newer(r.at))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];

  const folded = foldBusy(above, mine, localDay);
  const tail = older || !visit ? foldBusy(visit ? below : [], mine, localDay) : [];

  // one flat run of things to draw, so day headers and the interlude can count across it
  type Draw = { key: string; at: string; node: ReactNode; post?: boolean };
  const draw: Draw[] = [];
  let r = 0;
  const flushRows = (before: string | null) => {
    while (r < rows.length && (before === null || Date.parse(rows[r]!.at) > Date.parse(before))) {
      const row = rows[r++]!;
      draw.push({
        key: `${row.kind}:${row.kind === 'thread' ? row.row.rootId : row.row.id}`, at: row.at,
        node: row.kind === 'thread' ? <ThreadLine row={row.row} /> : <EventLine row={row.row} />,
      });
    }
  };
  const card = (post: Post) => (
    <PostCard post={post} onChange={(np) => p.setItems((cur) => replaceIn(cur, np))} />
  );
  const pushItems = (list: FeedItem<Post>[], withRows: boolean) => {
    for (const x of list) {
      if (withRows) flushRows(itemTime(x));
      if (x.kind === 'post') {
        draw.push({ key: x.post.id, at: x.post.createdAt, node: card(x.post), post: true });
        continue;
      }
      const open = openFolds.has(x.key);
      draw.push({ key: `fold:${x.key}`, at: itemTime(x), node: <FoldRow fold={x} open={open} onToggle={() => toggle(x.key)} /> });
      if (open) for (const post of x.posts) draw.push({ key: post.id, at: post.createdAt, node: card(post), post: true });
    }
  };
  pushItems(folded, true);
  if (visit && reached) flushRows(null);
  const lineAt = draw.length;
  pushItems(tail, false);

  const n = items.length;
  const postsDrawn = draw.filter((d) => d.post).length;
  const interAt = interlude ? Math.min(interlude.after, postsDrawn) : -1;
  let seenPosts = 0;
  let last = '';
  const endCard = (inline: boolean) => visit && (
    <EndCard
      visit={visit} nothingNew={above.length === 0}
      olderToShow={!inline && (below.length > 0 || p.hasMore)}
      onShowOlder={() => setOlder(true)} onSeen={onSeen}
    />
  );

  return (
    <>
      <ListStatus p={p} count={n} empty={empty} />
      {interlude && n === 0 && !p.loading && !p.error && interlude.node}
      {visit && fresh > 0 && !p.loading && (
        <p className="feed-since meta">{fresh} new since {sinceLabel(visit)}</p>
      )}
      <div className="posts">
        {draw.map((d, i) => {
          const day = dayLabel(d.at);
          const header = day !== last;
          last = day;
          if (d.post) seenPosts++;
          return (
            <Fragment key={d.key}>
              {visit && reached && older && i === lineAt && endCard(true)}
              {header && <h2 className="day-h">{day}</h2>}
              {d.node}
              {d.post && seenPosts === interAt && <div className="interlude">{interlude!.node}</div>}
            </Fragment>
          );
        })}
        {visit && reached && older && lineAt === draw.length && n > 0 && endCard(true)}
      </div>
      {visit && reached && !older && n > 0 && endCard(false)}
      {/* above the line the feed keeps loading on its own; past it, only when asked */}
      {(!visit || !reached) && <PagedFooter p={p} />}
      {visit && reached && older && <PagedFooter p={p} auto={false} label="Show older posts" />}
    </>
  );
}
