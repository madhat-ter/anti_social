/**
 * Members (apps/web/app/members/page.tsx): the room, one cell per seat; inviting beside the seats
 * it fills (RFC §10.26); the site's only search box, for people and posts; everyone, newest first.
 */
import { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Share, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type InviteInfo, type MemberSummary, type Post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { LIST_PERF } from '@/lib/lists';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { TabIcon } from '@/components/Icons';
import { NameMarks } from '@/components/Marks';
import { PostCard, replaceIn } from '@/components/PostCard';
import { Btn, ErrorNote, Field, LinkText, Loading, Row, RuleHeading, Tag, Text, Touch } from '@/components/ui';

const NEW_DAYS = 21;
const isNew = (m: MemberSummary) => !!m.activatedAt && Date.now() - Date.parse(m.activatedAt) < NEW_DAYS * 86_400_000;

// memo: typing in the search box redraws the screen; the 100 seat cells needn't redraw with it
const Seats = memo(function Seats({ mine }: { mine: string }) {
  const { c } = useTheme();
  const seats = useQuery({ queryKey: ['seats'], queryFn: () => api.seats() }).data;
  const all = useQuery({ queryKey: ['members', 'all'], queryFn: () => api.members(null, 100) }).data?.items ?? [];
  if (!seats) return null;
  const open = seats.cap - seats.used;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }} accessible accessibilityLabel={`${seats.used} of ${seats.cap} seats taken`}>
        {Array.from({ length: seats.cap }, (_, i) => {
          const m = all[i];
          return <View key={i} style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: c.ink, backgroundColor: !m && i >= seats.used ? c.paper : m?.handle === mine ? c.signal : c.ink }} />;
        })}
      </View>
      <Text v="meta"><Text v="bold" style={{ fontSize: 14 }}>{seats.used}</Text> of {seats.cap} seats taken. {open > 0 ? `${open} open.` : 'The room is full; new people wait in line.'}</Text>
    </View>
  );
});

const Invite = memo(function Invite({ full }: { full: boolean }) {
  const [list, setList] = useState<InviteInfo[]>([]);
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => { try { setList(await api.invites()); } catch (e) { setErr(errorMessage(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setErr(null); setBusy(true);
    try { setFresh(await api.createInvite()); await load(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Row wrap>
        <Btn kind="primary" label={busy ? 'Making a code…' : '+ Invite someone'} disabled={busy} onPress={() => void create()} />
        {list.length > 0 && <LinkText small label={`Your invites (${list.length})`} onPress={() => setShown((s) => !s)} />}
      </Row>
      {full && <Text v="meta">The room is full: whoever you invite waits in line.</Text>}
      <ErrorNote message={err} />
      {fresh && (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <Text v="meta">Send this code to the person you are inviting. It is shown only once. Expires {fmtDate(fresh.expiresAt)}.</Text>
          <Text v="ui" selectable style={{ fontSize: 24, lineHeight: 30, letterSpacing: 2 }}>{fresh.code}</Text>
          <Row wrap gap={8}>
            <Btn small label={copied ? 'Copied' : 'Copy'} onPress={() => { void Clipboard.setStringAsync(fresh.code); setCopied(true); }} />
            <Btn small label="Send…" onPress={() => void Share.share({ message: `Here is an invite to anti: ${fresh.code}\nJoin at https://tryanti.social/join` })} />
            <Btn small label="Done" onPress={() => { setFresh(null); setCopied(false); }} />
          </Row>
        </View>
      )}
      {shown && list.map((i, n) => (
        <Row key={n} style={{ justifyContent: 'space-between' }}>
          <Text v="small">Created {fmtDate(i.createdAt)}{'\n'}<Text v="meta">{i.status === 'redeemed' ? `Used by @${i.redeemedBy?.handle ?? 'unknown'}` : i.status === 'open' ? `Expires ${fmtDate(i.expiresAt)}` : i.status}</Text></Text>
          <Tag label={i.status} />
        </Row>
      ))}
    </View>
  );
});

const MemberRow = memo(function MemberRow({ m }: { m: MemberSummary }) {
  const { c } = useTheme();
  return (
    <Touch onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: m.handle } })} accessibilityRole="link"
      style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: c.hair }}>
      <Avatar seed={m.handle} gender={m.gender} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={6} wrap>
          <Text v="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{m.displayName}</Text>
          <NameMarks admin={m.role === 'ops'} verified={m.verified} size={13} />
          {isNew(m) && <Tag label="new" red />}
        </Row>
        <Text v="meta" numberOfLines={1}>@{m.handle}{m.headline ? ` · ${m.headline}` : ''}</Text>
      </View>
    </Touch>
  );
});

export default function MembersScreen() {
  const me = useMe();
  const { c } = useTheme();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const p = usePaged<MemberSummary>(['members', 'list'], (cur) => api.members(cur, 30));
  const seats = useQuery({ queryKey: ['seats'], queryFn: () => api.seats() }).data;
  const found = useQuery({ queryKey: ['search', asked], queryFn: () => api.search(asked), enabled: asked !== '' });
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => { setPosts(found.data?.posts ?? []); }, [found.data]);
  const onPostChange = useCallback((np: Post) => setPosts((cur) => replaceIn(cur, np)), []);

  // a moment after typing stops, the box searches
  useEffect(() => {
    const t = setTimeout(() => setAsked(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const searching = asked !== '';
  const people = searching ? found.data?.members ?? [] : p.items;
  type Item = { kind: 'm'; m: MemberSummary } | { kind: 'p'; post: Post } | { kind: 'h'; label: string };
  const data: Item[] = [
    ...people.map((m) => ({ kind: 'm' as const, m })),
    ...(searching && posts.length ? [{ kind: 'h' as const, label: 'Posts' }, ...posts.map((post) => ({ kind: 'p' as const, post }))] : []),
  ];

  return (
    <FlatList
      data={data}
      keyExtractor={(it, i) => (it.kind === 'm' ? `m:${it.m.handle}` : it.kind === 'p' ? `p:${it.post.id}` : `h:${i}`)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      onEndReached={() => { if (!searching) p.loadMore(); }}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={() => { void p.refresh(); void qc.invalidateQueries({ queryKey: ['seats'] }); }} tintColor={c.ink} />}
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 8 }}>
          <Text v="poster" accessibilityRole="header" style={{ fontSize: 38, lineHeight: 38 }}>Members</Text>
          <Seats mine={me.handle} />
          <Invite full={!!seats && seats.used >= seats.cap} />
          <Row gap={8}>
            <TabIcon name="search" />
            <Field style={{ flex: 1 }} value={q} onChangeText={setQ} placeholder="Search people and posts" accessibilityLabel="Search people and posts"
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => setAsked(q.trim())} clearButtonMode="while-editing" />
          </Row>
          {searching && <RuleHeading>People</RuleHeading>}
          {searching && found.isPending && <Loading what="Searching" />}
        </View>
      }
      renderItem={({ item }) => item.kind === 'm' ? <MemberRow m={item.m} />
        : item.kind === 'h' ? <View style={{ paddingTop: 12 }}><RuleHeading>{item.label}</RuleHeading></View>
        : <View style={{ paddingVertical: 8 }}><PostCard framed post={item.post} onChange={onPostChange} /></View>}
      ListEmptyComponent={
        searching ? (found.isPending ? undefined : <Text muted>Nobody matches. Try another word, or <Text muted style={{ textDecorationLine: 'underline' }} onPress={() => setQ('')}>show everyone</Text>.</Text>)
        : p.loading ? <Loading /> : p.error ? <ErrorNote message={p.error} /> : undefined
      }
      ListFooterComponent={p.loadingMore && !searching ? <Loading what="Loading more" /> : undefined}
      {...LIST_PERF}
    />
  );
}
