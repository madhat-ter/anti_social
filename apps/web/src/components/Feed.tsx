'use client';
/**
 * RFC §10.11: the home feed. Never ranked; what this adds is a frozen line where
 * you left off, and an end. Above the line: what is new since your last visit, with a few rows
 * placed at their own time (a conversation on an older post, a new event), and a busy poster's
 * extra posts folded into one row. At the line: the "caught up" card, and the feed stops (nothing
 * loads on its own below it). Older posts come only when you ask for them.
 *
 * RFC §10.23: by default the new posts above the line come mixed by the server (the newest on top,
 * then a seeded mix that keeps one person's posts apart); the list keeps that order, drops the day
 * headers there and gives the rows seeded places. Under the line, and for members who chose
 * "Newest first", everything stays in time order.
 */
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FEED, foldBusy, mixRand, type FeedItem } from '@anti/shared';
import { api, type FeedEventRow, type FeedThreadRow, type FeedVisit, type Post } from '@/lib/api';
import type { usePaged } from '@/lib/hooks';
import { ListStatus, PagedFooter } from './Paged';
import { PostCard, replaceIn } from './PostCard';
import { dayLabel } from './PostList';
import { eventTime } from './Events';
import { Avatar } from './Avatar';
import { Win } from './retro';

/** `mix` (RFC §10.23): the visit's seed and start, so a reload brings back the same mix */
type Stored = { since: string; capped: boolean; visitId: number | null; at: number; mix?: { seed: number; until: string } | null };
const GAP_MS = FEED.visitGapMinutes * 60_000;
/** RFC §10.22: the Monologue page keeps its own line, so its visit is stored apart (scope) */
const keyFor = (handle: string, scope = 'feed') => `anti:${scope === 'feed' ? 'feed' : scope}-visit:${handle}`;

function read(handle: string, scope?: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(keyFor(handle, scope));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch { return null; }
}
function write(handle: string, s: Stored, scope?: string) {
  try { sessionStorage.setItem(keyFor(handle, scope), JSON.stringify(s)); } catch { /* private mode: the visit just restarts */ }
}

/**
 * One visit per tab: a new one starts when the feed opens after half an hour with no feed
 * activity; until then a reload keeps the same line, so nothing you have not read is skipped.
 */
export function useFeedVisit(handle: string, scope = 'feed') {
  const [visit, setVisit] = useState<FeedVisit | null>(null);
  const stored = useRef<Stored | null>(null);

  /** what the first page asks for: resume a live visit, or start one */
  const params = useCallback((): { visit?: boolean; since?: string; seed?: number; until?: string } => {
    const s = read(handle, scope);
    stored.current = s;
    if (!s || Date.now() - s.at >= GAP_MS) return { visit: true };
    return s.mix ? { since: s.since, seed: s.mix.seed, until: s.mix.until } : { since: s.since };
  }, [handle, scope]);

  const got = useCallback((v: FeedVisit) => {
    const visitId = v.visitId ?? stored.current?.visitId ?? null;
    const s: Stored = { since: v.since, capped: v.capped, visitId, at: Date.now(), mix: v.mix ?? null };
    stored.current = s;
    write(handle, s, scope);
    setVisit({ ...v, visitId });
  }, [handle, scope]);

  // reading the feed keeps the visit alive
  useEffect(() => {
    const touch = () => {
      if (document.visibilityState !== 'visible' || !stored.current) return;
      stored.current = { ...stored.current, at: Date.now() };
      write(handle, stored.current, scope);
    };
    const t = setInterval(touch, 60_000);
    window.addEventListener('scroll', touch, { passive: true });
    return () => { clearInterval(t); window.removeEventListener('scroll', touch); };
  }, [handle, scope]);

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
function EndCard({ visit, nothingNew, olderToShow, onShowOlder, onSeen, what }: {
  visit: FeedVisit; nothingNew: boolean; olderToShow: boolean; onShowOlder: () => void; onSeen: () => void;
  what: 'feed' | 'monologues';
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
          {what === 'monologues'
            ? nothingNew
              ? <>No new monologues since {when}.</>
              : <>That&rsquo;s every monologue since {when}.</>
            : nothingNew
              ? <>Nothing new since {when}. That&rsquo;s the whole feed.</>
              : <>That&rsquo;s everything since {when}.</>}
        </p>
        {ev && (
          <p className="meta feed-end-event">
            {/* RFC §10.21: the feed's end card says the same thing as the Collab page's strip */}
            Coming up: <Link href={`/collab/event/${ev.id}`}>{ev.title}</Link>, {eventTime(ev.startsAt, null)}.{' '}
            {ev.imGoing ? 'You’re going.' : <>{ev.going > 0 ? `${ev.going} going. ` : ''}<Link href={`/collab/event/${ev.id}`}>RSVP</Link></>}
          </p>
        )}
        <p className="feed-end-out">Go outside.</p>
        {olderToShow && <button type="button" className="btn" onClick={onShowOlder}>{what === 'monologues' ? 'Show older monologues' : 'Show older posts'}</button>}
        {what === 'feed' && <Link href="/feed-rules" className="small">How the feed works</Link>}
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
    <Link href={`/collab/event/${row.id}`} className="feed-row">
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
 * The list itself. Day headers as in PostList; `interludes` (the pick window, Pet Corner) are
 * inserted after their `after`-th post on phones. `mine` is the viewer's handle: your own posts are
 * never new to you, never folded.
 */
export function FeedList({ p, visit, mine, readOnly, empty, interludes, what = 'feed', caughtUp }: {
  p: ReturnType<typeof usePaged<Post>>; visit: FeedVisit | null; mine: string; readOnly: boolean; empty: string;
  interludes?: { after: number; node: ReactNode }[];
  /** RFC §10.22: the same list on the Monologue page (its own words, its own line) */
  what?: 'feed' | 'monologues';
  /** where reaching the end is recorded; the feed's own by default */
  caughtUp?: (through: string, visitId: number | null) => Promise<unknown>;
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
  /** RFC §10.23: this visit's new posts came mixed (newest on top, then the seeded mix) */
  const mix = visit?.mix ?? null;

  // in a mix the first item is not always the newest, so look for it
  const newest = items.reduce<string | null>((m, x) => (m === null || Date.parse(x.createdAt) > Date.parse(m) ? x.createdAt : m), null);
  const onSeen = useCallback(() => {
    if (readOnly || !visit || !newest || caught.current === newest) return;
    caught.current = newest;
    (caughtUp ?? api.caughtUp)(newest, visit.visitId).catch(() => { caught.current = null; });
  }, [readOnly, visit, newest, caughtUp]);

  const toggle = (key: string) => setOpenFolds((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rowKey = (row: Row) => `${row.kind}:${row.kind === 'thread' ? row.row.rootId : row.row.id}`;
  // rows only live above the line, at their own time (newest first, like everything else);
  // in a mix (RFC §10.23) each gets a fixed place among the new posts, drawn from the visit's
  // seed, never above the newest post
  const span = Math.max(1, visit?.newPosts ?? 1);
  const rows: (Row & { slot: number })[] = visit
    ? [...visit.threads.map((row) => ({ kind: 'thread' as const, at: row.at, row })),
       ...visit.events.map((row) => ({ kind: 'event' as const, at: row.at, row }))]
      .filter((r) => newer(r.at))
      .map((r) => ({ ...r, slot: mix ? 1 + Math.floor(mixRand(mix.seed, rowKey(r)) * span) : 0 }))
      .sort((a, b) => (mix ? a.slot - b.slot : 0) || Date.parse(b.at) - Date.parse(a.at))
    : [];

  const folded = foldBusy(above, mine, localDay);
  const tail = older || !visit ? foldBusy(visit ? below : [], mine, localDay) : [];

  // one flat run of things to draw, so day headers and the interlude can count across it
  type Draw = { key: string; at: string; node: ReactNode; post?: boolean };
  const draw: Draw[] = [];
  let r = 0;
  /** rows due before the next item: by time, or (mixed) by place; `null`: all that are left */
  const flushRows = (next: { at: string; index: number } | null) => {
    const due = (row: (typeof rows)[number]) =>
      next === null || (mix ? row.slot <= next.index : Date.parse(row.at) > Date.parse(next.at));
    while (r < rows.length && due(rows[r]!)) {
      const row = rows[r++]!;
      draw.push({
        key: rowKey(row), at: row.at,
        node: row.kind === 'thread' ? <ThreadLine row={row.row} /> : <EventLine row={row.row} />,
      });
    }
  };
  const card = (post: Post) => (
    <PostCard framed post={post} onChange={(np) => p.setItems((cur) => replaceIn(cur, np))} />
  );
  const pushItems = (list: FeedItem<Post>[], withRows: boolean) => {
    for (const [index, x] of list.entries()) {
      if (withRows) flushRows({ at: itemTime(x), index });
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
  // where each interlude lands; one that asks for more posts than there are falls to the end
  const interAt = new Map<number, ReactNode[]>();
  for (const it of interludes ?? []) {
    const at = Math.min(it.after, postsDrawn);
    interAt.set(at, [...(interAt.get(at) ?? []), it.node]);
  }
  let seenPosts = 0;
  let last = '';
  const endCard = (inline: boolean) => visit && (
    <EndCard
      visit={visit} nothingNew={above.length === 0} what={what}
      olderToShow={!inline && (below.length > 0 || p.hasMore)}
      onShowOlder={() => setOlder(true)} onSeen={onSeen}
    />
  );

  return (
    <>
      <ListStatus p={p} count={n} empty={empty} />
      {n === 0 && !p.loading && !p.error && (interludes ?? []).map((it, i) => <Fragment key={`i${i}`}>{it.node}</Fragment>)}
      {visit && fresh > 0 && !p.loading && (
        <p className="feed-since meta">
          {fresh} new since {sinceLabel(visit)}
          {/* RFC §10.23: say it out loud, and where the rules are */}
          {mix && <> · <Link href="/feed-rules#mixed">mixed, newest on top</Link></>}
        </p>
      )}
      <div className="posts cards">
        {draw.map((d, i) => {
          // the mixed part has no day headers (it is not in time order); each card shows its time
          const day = mix && i < lineAt ? '' : dayLabel(d.at);
          const header = day !== '' && day !== last;
          last = day;
          if (d.post) seenPosts++;
          return (
            <Fragment key={d.key}>
              {visit && reached && older && i === lineAt && endCard(true)}
              {header && <h2 className="day-h">{day}</h2>}
              {d.node}
              {d.post && interAt.get(seenPosts)?.filter((x) => x != null).map((node, j) => <div className="interlude" key={j}>{node}</div>)}
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
