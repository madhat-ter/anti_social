/**
 * A member's profile (apps/web/app/u/[handle]/page.tsx): the face, the name with its marks, the
 * headline and about, interests, their monologue shelf and their posts. Your own profile is the
 * "You" tab (RFC §10.26): Edit profile, and your drawers as a row of links on top (MeLinks).
 * The portfolio, picks and projects stay on the website for now.
 */
import { useCallback } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ageOn, CONSULT_MIN_AGE, localToday } from '@anti/shared';
import { api, errorMessage, type Me, type Post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { openSite } from '@/lib/links';
import { LIST_PERF } from '@/lib/lists';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from './Avatar';
import { BirthdayTag, NameMarks } from './Marks';
import { PostCard, replaceIn } from './PostCard';
import { TapeCard } from './Tape';
import { Btn, ErrorNote, Loading, Row, RuleHeading, Tag, Text } from './ui';

export const isAdult = (me: Pick<Me, 'birthday'>) => {
  if (!me.birthday) return false;
  const a = ageOn(me.birthday, localToday());
  return a !== null && a >= CONSULT_MIN_AGE;
};

/** RFC §10.26: your drawers, one tap from your profile */
function MeLinks({ me }: { me: Me }) {
  const { c } = useTheme();
  const waiting = useQuery({ queryKey: ['consult-waiting'], queryFn: () => api.consultWaiting(), enabled: isAdult(me), refetchInterval: 120_000 }).data?.waiting ?? 0;
  const links: { label: string; go: () => void }[] = [
    { label: 'Pet Corner', go: () => void openSite('/pets') },
    ...(isAdult(me) ? [{ label: waiting > 0 ? `Consultations (${waiting})` : 'Consultations', go: () => void openSite('/consultations') }] : []),
    { label: 'Settings', go: () => router.push('/settings') },
    ...(me.role === 'ops' ? [{ label: 'Admin', go: () => void openSite('/admin') }] : []),
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {links.map((l) => (
        <Btn key={l.label} small label={l.label} onPress={l.go} style={{ borderColor: c.ink }} />
      ))}
    </ScrollView>
  );
}

function Shelf({ handle }: { handle: string }) {
  const q = useQuery({ queryKey: ['shelf', handle], queryFn: () => api.memberMonologues(handle) });
  const tapes = (q.data?.items ?? []).filter((p) => p.monologue && !p.deleted);
  if (tapes.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <RuleHeading>Monologues</RuleHeading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {tapes.map((p) => (
          <View key={p.id} style={{ width: 260 }}>
            <TapeCard id={p.id} mono={p.monologue!} who={p.author?.displayName} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function Profile({ handle, own }: { handle: string; own?: boolean }) {
  const me = useMe();
  const { c } = useTheme();
  const mine = own || me.handle.toLowerCase() === handle.toLowerCase();
  const mq = useQuery({ queryKey: ['member', handle], queryFn: () => api.member(handle) });
  const posts = usePaged<Post>(['u', handle], (cur) => api.memberPosts(handle, cur));
  const setPostItems = posts.setItems;
  const onChange = useCallback((np: Post) => setPostItems((cur) => replaceIn(cur, np)), [setPostItems]);
  const m = mq.data;

  if (mq.isPending) return <Loading />;
  if (!m) return <View style={{ padding: 16 }}><ErrorNote message={errorMessage(mq.error)} /></View>;

  const header = (
    <View style={{ gap: 14 }}>
      {mine && <MeLinks me={me} />}
      <Row gap={14} style={{ alignItems: 'flex-start' }}>
        <View style={{ borderWidth: 2, borderColor: c.ink, padding: 4 }}>
          <Avatar seed={m.handle} gender={m.gender} size={92} label={`${m.displayName}'s face`} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Row wrap gap={6}>
            <Text v="poster" style={{ fontSize: 32, lineHeight: 32, flexShrink: 1 }} accessibilityRole="header">{m.displayName}</Text>
            <NameMarks admin={m.role === 'ops'} verified={m.verified} size={18} />
          </Row>
          <Text v="meta">@{m.handle}</Text>
          {m.headline ? <Text v="bold">{m.headline}</Text> : null}
          <Row wrap gap={6}>
            <BirthdayTag b={m.birthday} />
            {m.openToWork && <Tag label="open to work" />}
            {m.state === 'archived' && <Tag label="archived" />}
            {m.state === 'flagged_lurker' && mine && <Tag label="seat at risk" danger />}
          </Row>
        </View>
      </Row>
      {m.bio ? <Text selectable>{m.bio}</Text> : mine ? <Text muted>Nothing about you yet. Edit profile to add a line.</Text> : null}
      {m.interests.length > 0 && <Row wrap gap={6}>{m.interests.map((i) => <Tag key={i} label={i.replace(/-/g, ' ')} dashed />)}</Row>}
      <Text v="meta">
        {m.activatedAt ? `Seated ${fmtDate(m.activatedAt)}` : 'Waiting for a seat'}
        {m.invitedBy ? ' · invited by ' : ''}
        {m.invitedBy && <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: m.invitedBy!.handle } })}>@{m.invitedBy.handle}</Text>}
        {` · ${m.postCount} ${m.postCount === 1 ? 'post' : 'posts'}`}
      </Text>
      <Row wrap gap={8}>
        {mine && <Btn small kind="primary" label="Edit profile" onPress={() => router.push('/edit-profile')} />}
        <Btn small label="Portfolio" onPress={() => void openSite(`/u/${m.handle}`)} />
        <Btn small label={mine ? 'Your File' : 'File'} onPress={() => void openSite(mine ? '/file' : `/file/${m.handle}`)} />
      </Row>
      <Shelf handle={m.handle} />
      <RuleHeading>Posts</RuleHeading>
    </View>
  );

  return (
    <FlatList
      data={posts.items}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PostCard framed post={item} onChange={onChange} />}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      ListHeaderComponent={header}
      ListEmptyComponent={posts.loading ? <Loading /> : posts.error ? <ErrorNote message={posts.error} /> : <Text muted>{mine ? 'You have not posted yet.' : 'No posts yet.'}</Text>}
      ListFooterComponent={posts.loadingMore ? <Loading what="Loading more" /> : undefined}
      onEndReached={posts.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={mq.isRefetching || posts.refreshing} onRefresh={() => { void mq.refetch(); void posts.refresh(); }} tintColor={c.ink} />}
      {...LIST_PERF}
    />
  );
}
