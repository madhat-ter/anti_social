/**
 * Collab (RFC §10.21, apps/web/app/collab/page.tsx): events, activities and projects in one place.
 * The start block (+ Event / + Activity / + Project) opens the website's form; Yours, Coming up,
 * then everything, one kind or all.
 */
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, type CollabPageItem } from '@/lib/api';
import { openSite } from '@/lib/links';
import { usePaged } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { CollabCard, openCollab } from '@/components/CollabCard';
import { Btn, Chip, ErrorNote, Loading, Row, RuleHeading, Text } from '@/components/ui';

const KINDS = [
  { key: 'all', label: 'All' }, { key: 'event', label: 'Events' },
  { key: 'activity', label: 'Activities' }, { key: 'project', label: 'Projects' },
] as const;
type Kind = (typeof KINDS)[number]['key'];

export default function CollabScreen() {
  const { c } = useTheme();
  const [kind, setKind] = useState<Kind>('all');
  const mine = useQuery({ queryKey: ['collab', 'mine'], queryFn: () => api.myCollab() });
  const upcoming = useQuery({ queryKey: ['collab', 'upcoming'], queryFn: () => api.events('upcoming', null, 5) });
  const p = usePaged<CollabPageItem>(['collab', 'page', kind], (cur) => api.collabPage({ kind, cursor: cur }));

  const m = mine.data;
  const yours = m ? [...m.hosting, ...m.in, ...m.going] : [];
  const refresh = () => { void mine.refetch(); void upcoming.refetch(); void p.refresh(); };

  const header = (
    <View style={{ gap: 14, paddingBottom: 4 }}>
      <Text v="poster" accessibilityRole="header" style={{ fontSize: 38, lineHeight: 38 }}>Collab</Text>
      <Row gap={8} wrap>
        <Btn small kind="primary" label="+ Event" onPress={() => void openSite('/collab/new?kind=event')} />
        <Btn small kind="primary" label="+ Activity" onPress={() => void openSite('/collab/new?kind=activity')} />
        <Btn small kind="primary" label="+ Project" onPress={() => void openSite('/collab/new?kind=project')} />
      </Row>
      <Text v="meta">Events, activities and projects: a picnic on Saturday, a Sunday run club, a zine made together. Join one, or start your own.</Text>

      {m && (yours.length > 0 || m.waiting.length > 0) && (
        <View style={{ gap: 12 }}>
          <RuleHeading>Yours</RuleHeading>
          {m.waiting.length > 0 && (
            <Row wrap gap={8}>
              {m.waiting.map((w) => (
                <Chip key={`${w.type}:${w.id}`} on label={`${w.count} ${w.count === 1 ? 'request' : 'requests'} · ${w.title}`}
                  onPress={() => openCollab({ type: w.type === 'event' ? 'event' : 'collab', id: w.id })} />
              ))}
            </Row>
          )}
          {yours.map((it) => <CollabCard key={`${it.type}:${it.id}`} item={it} />)}
        </View>
      )}

      <RuleHeading>Coming up</RuleHeading>
      {upcoming.isPending ? <Loading /> : (upcoming.data?.items.length ?? 0) === 0
        ? <Text muted>Nothing coming up. <Text muted style={{ textDecorationLine: 'underline' }} onPress={() => void openSite('/collab/new?kind=event')}>Start one?</Text></Text>
        : upcoming.data!.items.map((e) => <CollabCard key={e.id} item={{ type: 'event', createdAt: e.startsAt, ...e }} />)}

      <RuleHeading>Everything</RuleHeading>
      <Row gap={8} wrap>
        {KINDS.map((k) => <Chip key={k.key} label={k.label} on={kind === k.key} onPress={() => setKind(k.key)} />)}
      </Row>
    </View>
  );

  return (
    <FlatList
      data={p.items}
      keyExtractor={(it) => `${it.type}:${it.id}`}
      renderItem={({ item }) => <CollabCard item={item} />}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
      ListHeaderComponent={header}
      ListEmptyComponent={p.loading ? <Loading /> : p.error ? <ErrorNote message={p.error} /> : <Text muted>Nothing here yet.</Text>}
      ListFooterComponent={p.loadingMore ? <Loading what="Loading more" /> : undefined}
      onEndReached={p.loadMore}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={refresh} tintColor={c.ink} />}
    />
  );
}
