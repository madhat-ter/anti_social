/**
 * An event (apps/web/app/collab/event/[id]/page.tsx): when and where, who hosts, what it is, who
 * is going, the one join button, and its updates. A member aged 13–17 sees the one safety line on
 * in-person pages (RFC §10.28). Hosts manage it on the website.
 */
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isUnderAdultAge, localToday, MEET_SAFE_NOTE } from '@anti/shared';
import { eventJoinable, eventWhen, spotsText } from '@web/lib/collab';
import { api, errorMessage, type EventDetail, type Post } from '@/lib/api';
import { openSite } from '@/lib/links';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { Composer } from '@/components/Composer';
import { JoinButton } from '@/components/JoinButton';
import { NameMarks } from '@/components/Marks';
import { PostCard, replaceIn } from '@/components/PostCard';
import { Btn, ErrorNote, Loading, Row, RuleHeading, Tag, Text, Touch, Win } from '@/components/ui';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { c } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api.event(id) });
  const ups = usePaged<Post>(['event-updates', id], (cur) => api.eventUpdates(id, cur));
  const reload = useCallback(async () => {
    await q.refetch();
    void qc.invalidateQueries({ queryKey: ['collab'] });
  }, [q, qc]);

  if (q.isPending) return <Loading />;
  if (!q.data) return <View style={{ padding: 16 }}><ErrorNote message={errorMessage(q.error)} /></View>;
  const e: EventDetail = q.data;
  const where = e.location ?? (e.locationHidden ? (e.locationRsvpOnly ? 'The place is shown to people going.' : 'The place is shown to the team.') : null);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { void reload(); void ups.refresh(); }} tintColor={c.ink} />}>
      <Stack.Screen options={{ title: 'Event' }} />
      <Win title="event">
        <Row wrap gap={6}>
          <Tag label="event" on />
          {e.audience === 'team' && <Tag label="team only" />}
          {e.cancelledAt && <Tag label="cancelled" danger />}
        </Row>
        <Text v="poster" accessibilityRole="header" style={{ fontSize: 34, lineHeight: 34 }}>{e.title}</Text>
        <Text v="bold">{eventWhen(e.startsAt, e.endsAt)}</Text>
        {where && <Text>{where}</Text>}
        {isUnderAdultAge(me.birthday, localToday()) && <Text v="small" red>{MEET_SAFE_NOTE}</Text>}
        {e.collab && (
          <Text v="meta">Part of <Text v="meta" style={{ textDecorationLine: 'underline' }} onPress={() => router.push({ pathname: '/collab/[id]', params: { id: e.collab!.id } })}>{e.collab.title}</Text></Text>
        )}
        {e.host && (
          <Touch onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: e.host!.handle } })} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Avatar seed={e.host.handle} gender={e.host.gender} size={30} />
            <Text v="small">Hosted by {e.host.displayName}</Text>
            <NameMarks admin={e.host.admin} verified={e.host.verified} size={12} />
          </Touch>
        )}
        <Text v="meta">{spotsText(e)}</Text>
        {e.priceNote && <Text v="small">Cost: {e.priceNote}</Text>}
        {!e.cancelledAt && (
          <JoinButton
            j={eventJoinable(e)}
            join={async () => { await api.rsvp(e.id); await reload(); }}
            ask={async (note) => { await api.askToCome(e.id, note); await reload(); }}
            leave={async () => { await api.leaveEvent(e.id); await reload(); }}
            withdraw={async () => { await api.withdrawEventRequest(e.id); await reload(); }}
          />
        )}
        {e.invited && !e.my && (
          <Btn small label="Not for me" onPress={() => void api.declineEventInvite(e.id).then(reload)} />
        )}
        {(e.canManage || e.canEdit) && <Btn small label="Manage on the website" onPress={() => void openSite(`/collab/event/${e.id}`)} />}
      </Win>

      {e.description ? <Text selectable>{e.description}</Text> : null}
      {e.requirements ? <View style={{ gap: 4 }}><Text v="ui">Bring / know</Text><Text>{e.requirements}</Text></View> : null}

      {e.going.length > 0 && (
        <View style={{ gap: 10 }}>
          <RuleHeading>Going</RuleHeading>
          <Row wrap gap={10}>
            {e.going.map((g) => (
              <Touch key={g.handle} onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: g.handle } })} accessibilityLabel={g.displayName}>
                <Avatar seed={g.handle} gender={g.gender} size={40} />
              </Touch>
            ))}
          </Row>
        </View>
      )}

      <RuleHeading>Updates</RuleHeading>
      {e.canPostUpdate && <Composer eventId={e.id} title="update.txt" placeholder="Tell everyone going…" submitLabel="Post update" onCreated={(p) => ups.setItems((cur) => [p, ...cur])} />}
      {ups.loading ? <Loading /> : ups.items.length === 0 ? <Text muted>No updates yet.</Text>
        : ups.items.map((p) => <PostCard key={p.id} framed context="none" post={p} onChange={(np) => ups.setItems((cur) => replaceIn(cur, np))} />)}
      {ups.hasMore && <Btn label="Older updates" busy={ups.loadingMore} onPress={ups.loadMore} />}
    </ScrollView>
  );
}
