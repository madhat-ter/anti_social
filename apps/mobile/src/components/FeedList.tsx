/**
 * The feed (apps/web/src/components/Feed.tsx, RFC §10.11 and §10.23). Never ranked: what is new
 * since your last visit sits above a line (mixed by the server unless you chose "Newest first"),
 * with a few rows at their own time and a busy poster's extra posts folded. At the line, the
 * "caught up" card, and the feed stops; older posts come only when asked for.
 *
 * A visit lasts while the app is used: it restarts after half an hour away (as a browser tab does
 * on the site). The phone keeps it in memory only.
 */
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { FEED, foldBusy, mixRand, type FeedItem } from '@anti/shared';
import { api, type FeedEventRow, type FeedThreadRow, type FeedVisit, type Post } from '@/lib/api';
import { dayLabel, eventTime, firstName } from '@/lib/format';
import { LIST_PERF } from '@/lib/lists';
import type { Paged } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { Avatar } from './Avatar';
import { PostCard, replaceIn } from './PostCard';
import { Btn, ErrorNote, Loading, Text, Touch, Win } from './ui';

type Stored = { since: string; capped: boolean; visitId: number | null; at: number; mix?: { seed: number; until: string } | null };
const GAP_MS = FEED.visitGapMinutes * 60_000;
const visits = new Map<string, Stored>();

/** one visit per scope; a new one starts after half an hour with no feed activity */
export function useFeedVisit(handle: string, scope: 'feed' | 'monologues' = 'feed') {
  const key = `${scope}:${handle}`;
  const [visit, setVisit] = useState<FeedVisit | null>(null);

  const params = useCallback((): { visit?: boolean; since?: string; seed?: number; until?: string } => {
    const s = visits.get(key);
    if (!s || Date.now() - s.at >= GAP_MS) return { visit: true };
    return s.mix ? { since: s.since, seed: s.mix.seed, until: s.mix.until } : { since: s.since };
  }, [key]);

  const got = useCallback((v: FeedVisit) => {
    const prev = visits.get(key);
    const visitId = v.visitId ?? prev?.visitId ?? null;
    visits.set(key, { since: v.since, capped: v.capped, visitId, at: Date.now(), mix: v.mix ?? null });
    setVisit({ ...v, visitId });
  }, [key]);

  /** reading keeps the visit alive */
  const touch = useCallback(() => {
    const s = visits.get(key);
    if (s) s.at = Date.now();
  }, [key]);

  /** pull to refresh starts a new visit (fresh line, fresh mix) */
  const restart = useCallback(() => { visits.delete(key); }, [key]);

  return { visit, params, got, touch, restart };
}

export function sinceLabel(v: FeedVisit): string {
  if (v.capped) return 'this past week';
  const d = new Date(v.since);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = dayLabel(v.since);
  if (day === 'Today' || day === 'Yesterday') return `${day.toLowerCase()}, ${time}`;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const localDay = (iso: string) => new Date(iso).toDateString();
type Row = { kind: 'thread'; at: string; row: FeedThreadRow } | { kind: 'event'; at: string; row: FeedEventRow };
const itemTime = (x: FeedItem<Post>) => (x.kind === 'post' ? x.post.createdAt : x.posts[0]!.createdAt);

type Draw =
  | { type: 'post'; key: string; at: string; post: Post }
  | { type: 'fold'; key: string; at: string; fold: Extract<FeedItem<Post>, { kind: 'fold' }>; open: boolean }
  | { type: 'row'; key: string; at: string; row: Row }
  | { type: 'day'; key: string; label: string }
  | { type: 'end'; key: string; inline: boolean };

function EndCard({ visit, nothingNew, olderToShow, onShowOlder, what }: {
  visit: FeedVisit; nothingNew: boolean; olderToShow: boolean; onShowOlder: () => void; what: 'feed' | 'monologues';
}) {
  const when = sinceLabel(visit);
  const ev = visit.nextEvent;
  return (
    <Win title="The end" bodyStyle={{ alignItems: 'center', gap: 10 }}>
      <Text v="h2" accessibilityRole="header">{nothingNew ? 'Nothing new.' : 'You’re caught up.'}</Text>
      <Text v="meta" style={{ textAlign: 'center' }}>
        {what === 'monologues'
          ? nothingNew ? `No new monologues since ${when}.` : `That’s every monologue since ${when}.`
          : nothingNew ? `Nothing new since ${when}. That’s the whole feed.` : `That’s everything since ${when}.`}
      </Text>
      {ev && (
        <Text v="meta" style={{ textAlign: 'center' }}>
          Coming up: <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => router.push({ pathname: '/collab/event/[id]', params: { id: ev.id } })}>{ev.title}</Text>, {eventTime(ev.startsAt)}.{' '}
          {ev.imGoing ? 'You’re going.' : ev.going > 0 ? `${ev.going} going.` : ''}
        </Text>
      )}
      <Text v="poster" style={{ fontSize: 34, lineHeight: 34 }}>Go outside.</Text>
      {olderToShow && <Btn label={what === 'monologues' ? 'Show older monologues' : 'Show older posts'} onPress={onShowOlder} />}
    </Win>
  );
}

function LineRow({ row }: { row: Row }) {
  const { c } = useTheme();
  const go = () => row.kind === 'thread'
    ? router.push({ pathname: '/p/[id]', params: { id: row.row.rootId, focus: '' } })
    : router.push({ pathname: '/collab/event/[id]', params: { id: row.row.id } });
  const person = row.kind === 'thread' ? row.row.author : row.row.host;
  let text: string;
  if (row.kind === 'thread') {
    const r = row.row;
    const who = r.author ? `${firstName(r.author.displayName)}’s post` : 'A post';
    const day = dayLabel(r.postedAt);
    text = `${who} from ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}: ${r.repliers} people replied since you were here`;
  } else {
    const r = row.row;
    text = `${r.host ? firstName(r.host.displayName) : 'Someone'} is hosting ${r.title} · ${eventTime(r.startsAt)}${r.going > 0 ? ` · ${r.going} going` : ''} · ${r.joinMode === 'approve' ? 'Ask to join' : 'RSVP'}`;
  }
  return (
    <Touch onPress={go} accessibilityRole="link" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink, padding: 10 }}>
      {person && <Avatar seed={person.handle} gender={person.gender} size={28} />}
      <Text v="small" style={{ flex: 1 }}>{text}</Text>
    </Touch>
  );
}

export function FeedList({ p, visit, mine, empty, what = 'feed', caughtUp, header, onRefresh, onScroll }: {
  p: Paged<Post>; visit: FeedVisit | null; mine: string; empty: string;
  what?: 'feed' | 'monologues';
  caughtUp?: (through: string, visitId: number | null) => Promise<unknown>;
  header?: ReactElement;
  onRefresh: () => void;
  onScroll?: () => void;
}) {
  const { c } = useTheme();
  const [older, setOlder] = useState(false);
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const caught = useRef<string | null>(null);
  const items = p.items;
  const since = visit ? Date.parse(visit.since) : Number.NEGATIVE_INFINITY;
  const newer = (iso: string) => Date.parse(iso) > since;
  const above = visit ? items.filter((x) => newer(x.createdAt)) : items;
  const below = visit ? items.filter((x) => !newer(x.createdAt)) : [];
  const reached = !!visit && (below.length > 0 || !p.hasMore);
  const fresh = above.filter((x) => x.author?.handle !== mine).length;
  const mix = visit?.mix ?? null;
  const newest = items.reduce<string | null>((m, x) => (m === null || Date.parse(x.createdAt) > Date.parse(m) ? x.createdAt : m), null);

  const onSeen = useCallback(() => {
    if (!visit || !newest || caught.current === newest) return;
    caught.current = newest;
    (caughtUp ?? api.caughtUp)(newest, visit.visitId).catch(() => { caught.current = null; });
  }, [visit, newest, caughtUp]);

  const draw = useMemo(() => {
    const rowKey = (row: Row) => `${row.kind}:${row.kind === 'thread' ? row.row.rootId : row.row.id}`;
    const span = Math.max(1, visit?.newPosts ?? 1);
    const rows = visit
      ? [...visit.threads.map((row) => ({ kind: 'thread' as const, at: row.at, row })),
         ...visit.events.map((row) => ({ kind: 'event' as const, at: row.at, row }))]
        .filter((r) => newer(r.at))
        .map((r) => ({ ...r, slot: mix ? 1 + Math.floor(mixRand(mix.seed, rowKey(r)) * span) : 0 }))
        .sort((a, b) => (mix ? a.slot - b.slot : 0) || Date.parse(b.at) - Date.parse(a.at))
      : [];
    const out: Draw[] = [];
    let r = 0;
    const flushRows = (next: { at: string; index: number } | null) => {
      const due = (row: (typeof rows)[number]) => next === null || (mix ? row.slot <= next.index : Date.parse(row.at) > Date.parse(next.at));
      while (r < rows.length && due(rows[r]!)) {
        const row = rows[r++]!;
        out.push({ type: 'row', key: rowKey(row), at: row.at, row });
      }
    };
    const push = (list: FeedItem<Post>[], withRows: boolean) => {
      for (const [index, x] of list.entries()) {
        if (withRows) flushRows({ at: itemTime(x), index });
        if (x.kind === 'post') { out.push({ type: 'post', key: x.post.id, at: x.post.createdAt, post: x.post }); continue; }
        const open = openFolds.has(x.key);
        out.push({ type: 'fold', key: `fold:${x.key}`, at: itemTime(x), fold: x, open });
        if (open) for (const post of x.posts) out.push({ type: 'post', key: post.id, at: post.createdAt, post });
      }
    };
    push(foldBusy(above, mine, localDay), true);
    if (visit && reached) flushRows(null);
    const lineAt = out.length;
    if (older || !visit) push(foldBusy(visit ? below : [], mine, localDay), false);

    // day headers, except in the mixed part (it is not in time order)
    const withDays: Draw[] = [];
    let last = '';
    out.forEach((d, i) => {
      if (visit && reached && older && i === lineAt && items.length > 0) withDays.push({ type: 'end', key: 'end', inline: true });
      if (d.type !== 'day' && d.type !== 'end') {
        const day = mix && i < lineAt ? '' : dayLabel(d.at);
        if (day !== '' && day !== last) withDays.push({ type: 'day', key: `day:${day}:${i}`, label: day });
        last = day;
      }
      withDays.push(d);
    });
    if (visit && reached && items.length > 0 && (!older || lineAt === out.length)) withDays.push({ type: 'end', key: 'end', inline: older });
    return withDays;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, visit, older, openFolds, mine, reached]);

  const setItems = p.setItems;
  const onChange = useCallback((np: Post) => setItems((cur) => replaceIn(cur, np)), [setItems]);
  const toggleFold = (key: string) => setOpenFolds((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: Draw | null }[] }) => {
    if (viewableItems.some((v) => v.item?.type === 'end')) seenRef.current();
  }).current;
  const seenRef = useRef(onSeen);
  seenRef.current = onSeen;

  const render = ({ item: d }: { item: Draw }) => {
    switch (d.type) {
      case 'post': return <PostCard framed post={d.post} onChange={onChange} />;
      case 'row': return <LineRow row={d.row} />;
      case 'day': return <Text v="h2" accessibilityRole="header" style={{ fontSize: 22, paddingTop: 6 }}>{d.label}</Text>;
      case 'fold': {
        const f = d.fold;
        const name = f.posts[0]?.author ? firstName(f.posts[0].author.displayName) : f.handle;
        const day = dayLabel(f.posts[0]!.createdAt);
        const when = day === 'Today' ? 'today' : day === 'Yesterday' ? 'yesterday' : `on ${day}`;
        return (
          <Touch onPress={() => toggleFold(f.key)} accessibilityRole="button" accessibilityState={{ expanded: d.open }}
            style={{ borderWidth: 2, borderColor: c.ink, padding: 10, alignItems: 'center' }}>
            <Text v="ui">{d.open ? 'Hide' : `${f.posts.length} more from ${name} ${when}`}</Text>
          </Touch>
        );
      }
      case 'end': return visit ? (
        <EndCard visit={visit} nothingNew={above.length === 0} what={what}
          olderToShow={!d.inline && (below.length > 0 || p.hasMore)} onShowOlder={() => setOlder(true)} />
      ) : null;
    }
  };

  const loadMore = () => { if (!visit || !reached || older) p.loadMore(); };
  return (
    <FlatList
      data={draw}
      keyExtractor={(d) => d.key}
      renderItem={render}
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
      onScrollBeginDrag={onScroll}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={onRefresh} tintColor={c.ink} />}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          {header}
          {visit && fresh > 0 && !p.loading && (
            <Text v="meta">{fresh} new since {sinceLabel(visit)}{mix ? ' · mixed, newest on top' : ''}</Text>
          )}
        </View>
      }
      ListEmptyComponent={p.loading ? <Loading /> : p.error ? <ErrorNote message={p.error} /> : <Text muted>{empty}</Text>}
      ListFooterComponent={p.loadingMore ? <Loading what="Loading more" /> : undefined}
      {...LIST_PERF}
    />
  );
}
