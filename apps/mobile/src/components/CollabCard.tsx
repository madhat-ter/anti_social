/**
 * One card for all three kinds (RFC §10.21, apps/web/src/components/Collab.tsx CollabItemCard):
 * an event shows its date on the red dot, a collab its cover or its first letter; then the kind
 * tag and title, one line of what and when, and who started it.
 */
import { View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { cardMeta, KIND_LABEL } from '@web/lib/collab';
import { mediaSource, type CollabPageItem } from '@/lib/api';
import { FONT, useTheme } from '@/lib/theme';
import { NameMarks } from './Marks';
import { Row, Shadowed, Tag, Text, Touch } from './ui';

export function openCollab(item: { type: 'event' | 'collab'; id: string }) {
  if (item.type === 'event') router.push({ pathname: '/collab/event/[id]', params: { id: item.id } });
  else router.push({ pathname: '/collab/[id]', params: { id: item.id } });
}

export function CollabCard({ item }: { item: CollabPageItem }) {
  const { c } = useTheme();
  const kind = item.type === 'event' ? 'event' : item.kind;
  const start = item.type === 'event' ? new Date(item.startsAt) : null;
  const cover = item.type === 'event' ? null : item.cover;
  return (
    <Shadowed offset={3}>
      <Touch onPress={() => openCollab(item)} accessibilityRole="link"
        style={{ flexDirection: 'row', gap: 12, padding: 12, borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper }}>
        {start ? (
          <View style={{ width: 58, alignItems: 'center', gap: 2 }} importantForAccessibility="no-hide-descendants">
            <Text v="ui" style={{ fontSize: 13 }}>{start.toLocaleDateString(undefined, { month: 'short' })}</Text>
            <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: c.signal, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: FONT.poster, fontSize: 28, lineHeight: 30, color: c.signalInk }}>{start.getDate()}</Text>
            </View>
          </View>
        ) : cover ? (
          <Image source={mediaSource(cover.url)} style={{ width: 58, height: 58, borderWidth: 2, borderColor: c.ink }} contentFit="cover" />
        ) : (
          <View style={{ width: 58, height: 58, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Text v="poster" style={{ fontSize: 32, lineHeight: 34 }}>{item.title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Row wrap gap={6}>
            <Tag label={KIND_LABEL[kind]} on={kind === 'event'} />
            {item.type === 'event' && item.audience === 'team' && <Tag label="team only" />}
            {item.type === 'event' && item.cancelledAt && <Tag label="cancelled" danger />}
          </Row>
          <Text v="bold" numberOfLines={2}>{item.title}</Text>
          <Text v="meta" numberOfLines={2}>{cardMeta(item)}</Text>
          {item.host && (
            <Row gap={4}>
              <Text v="meta">by @{item.host.handle}</Text>
              <NameMarks admin={item.host.admin} verified={item.host.verified} size={12} />
            </Row>
          )}
        </View>
      </Touch>
    </Shadowed>
  );
}
