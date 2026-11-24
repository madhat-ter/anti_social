/**
 * An activity or a project (apps/web/app/collab/[id]/page.tsx): what it is, how often it meets or
 * which roles it needs, the team, the one join button, its meetups and its updates. Hosts manage
 * it on the website.
 */
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isUnderAdultAge, localToday, MEET_SAFE_NOTE } from '@anti/shared';
import { collabJoinable, collabStatusLabel, KIND_LABEL } from '@web/lib/collab';
import { api, errorMessage, mediaSource, type Post } from '@/lib/api';
import { eventTime } from '@/lib/format';
import { openSite } from '@/lib/links';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Image } from 'expo-image';
import { Avatar } from '@/components/Avatar';
import { Composer } from '@/components/Composer';
import { JoinButton } from '@/components/JoinButton';
import { NameMarks } from '@/components/Marks';
import { PostCard, replaceIn } from '@/components/PostCard';
import { Btn, ErrorNote, Loading, Row, RuleHeading, Tag, Text, Touch, Win } from '@/components/ui';

export default function CollabScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['collab', id], queryFn: () => api.collab(id) });
  const ups = usePaged<Post>(['collab-updates', id], (cur) => api.collabUpdates(id, cur));
  const reload = useCallback(async () => {
    await q.refetch();
    void qc.invalidateQueries({ queryKey: ['collab', 'mine'] });
  }, [q, qc]);

  if (q.isPending) return <Loading />;
  if (!q.data) return <View style={{ padding: 16 }}><ErrorNote message={errorMessage(q.error)} /></View>;
  const k = q.data;
  const inTeam = !!k.my.role;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void reload(); void ups.refresh(); }} tintColor={c.ink} />}>
      {k.cover && <Image source={mediaSource(k.cover.url)} style={{ width: '100%', aspectRatio: Math.max(1.2, k.cover.width / Math.max(1, k.cover.height)), borderWidth: 2, borderColor: c.ink }} contentFit="cover" />}
      <Win title={KIND_LABEL[k.kind]}>
        <Row wrap gap={6}>
          <Tag label={KIND_LABEL[k.kind]} />
          <Tag label={collabStatusLabel(k)} dashed />
          {k.hidden && <Tag label="hidden after reports" danger />}
        </Row>
        <Text v="poster" accessibilityRole="header" style={{ fontSize: 34, lineHeight: 34 }}>{k.title}</Text>
        {k.kind === 'activity' && k.meets ? <Text v="bold">{k.meets}</Text> : null}
        {k.kind === 'activity' && k.meets && isUnderAdultAge(me.birthday, localToday()) ? <Text v="small" red>{MEET_SAFE_NOTE}</Text> : null}
        {k.kind === 'project' && k.slots.length > 0 && (
          <View style={{ gap: 4 }}>
            {k.slots.map((s, i) => <Text key={i} v="small">{s.role}: {s.handle ? `@${s.handle}` : <Text v="small" red>open</Text>}</Text>)}
          </View>
        )}
        <Text v="meta">{k.teamCount}{k.teamMax !== null ? ` of ${k.teamMax}` : ''} in the team</Text>
        {k.priceNote && <Text v="small">Cost: {k.priceNote}</Text>}
        <JoinButton
          j={collabJoinable(k)}
          join={async () => { await api.joinCollab(k.id); await reload(); }}
          ask={async (note) => { await api.joinCollab(k.id, note); await reload(); }}
          leave={async () => { await api.leaveCollab(k.id); await reload(); }}
          withdraw={async () => { await api.withdrawCollabRequest(k.id); await reload(); }}
        />
        {k.my.invited && !inTeam && (
          <Row gap={8}>
            <Btn small kind="primary" label="Accept the invite" onPress={() => void api.answerCollabInvite(k.id, true).then(reload)} />
            <Btn small label="Not for me" onPress={() => void api.answerCollabInvite(k.id, false).then(reload)} />
          </Row>
        )}
        {k.canManage && <Btn small label="Manage on the website" onPress={() => void openSite(`/collab/${k.id}`)} />}
      </Win>

      {k.description ? <Text selectable>{k.description}</Text> : null}
      {k.requirements ? <View style={{ gap: 4 }}><Text v="ui">Bring / know</Text><Text>{k.requirements}</Text></View> : null}

      <RuleHeading>Team</RuleHeading>
      {k.team.map((t) => (
        <Touch key={t.handle} onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: t.handle } })}
          style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <Avatar seed={t.handle} gender={t.gender} size={36} />
          <Text v="small" style={{ flex: 1 }}>{t.displayName}{t.slot ? ` · ${t.slot}` : ''}</Text>
          <NameMarks admin={t.admin} verified={t.verified} size={12} />
          {t.role !== 'member' && <Tag label={t.role === 'host' ? 'host' : 'co-host'} />}
        </Touch>
      ))}

      {k.meetups.length > 0 && (
        <View style={{ gap: 8 }}>
          <RuleHeading>Meetups</RuleHeading>
          {k.meetups.map((m) => (
            <Touch key={m.id} onPress={() => router.push({ pathname: '/collab/event/[id]', params: { id: m.id } })}
              style={{ borderWidth: 2, borderStyle: m.past ? 'dashed' : 'solid', borderColor: c.ink, padding: 10, gap: 2 }}>
              <Text v="bold">{m.title}</Text>
              <Text v="meta">{eventTime(m.startsAt)} · {m.goingCount} going{m.audience === 'team' ? ' · team only' : ''}</Text>
            </Touch>
          ))}
        </View>
      )}

      <RuleHeading>Updates</RuleHeading>
      {inTeam && <Composer collabId={k.id} title="update.txt" placeholder="Tell the team…" submitLabel="Post update" onCreated={(p) => ups.setItems((cur) => [p, ...cur])} />}
      {ups.loading ? <Loading /> : ups.items.length === 0 ? <Text muted>No updates yet.</Text>
        : ups.items.map((p) => <PostCard key={p.id} framed context="event" post={p} onChange={(np) => ups.setItems((cur) => replaceIn(cur, np))} />)}
      {ups.hasMore && <Btn label="Older updates" busy={ups.loadingMore} onPress={ups.loadMore} />}
    </ScrollView>
  );
}
