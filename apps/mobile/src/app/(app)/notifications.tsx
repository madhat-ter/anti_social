/**
 * The bell (RFC §10.20, apps/web/app/notifications/page.tsx). The words and where each one leads
 * come from @web/lib/notifications; what the app has a screen for opens in the app, the rest on
 * the website. The ones on screen are marked read as they load.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { describe, notificationHref, WARNINGS } from '@web/lib/notifications';
import { api, errorMessage, type Notification, type NotificationPage } from '@/lib/api';
import { fmtDate, relativeTime } from '@/lib/format';
import { LIST_PERF } from '@/lib/lists';
import { go } from '@/lib/links';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { AlertIcon } from '@/components/Icons';
import { Btn, Dot, ErrorNote, Loading, Text, Touch } from '@/components/ui';

export default function NotificationsScreen() {
  const me = useMe();
  const { c } = useTheme();
  const qc = useQueryClient();
  const p = usePaged<Notification, NotificationPage>(['notifications'], (cur) => api.notifications(cur));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const marked = useRef(new Set<string>());

  useEffect(() => {
    const ids = p.items.filter((n) => !n.readAt && !marked.current.has(n.id)).map((n) => n.id);
    if (!ids.length) return;
    ids.forEach((id) => marked.current.add(id));
    api.markRead(ids).then(
      (r) => qc.setQueryData(['unread'], { unreadCount: r.unreadCount }),
      () => { ids.forEach((id) => marked.current.delete(id)); },
    );
  }, [p.items, qc]);

  async function markAll() {
    setBusy(true); setErr(null);
    try {
      const r = await api.markRead();
      qc.setQueryData(['unread'], { unreadCount: r.unreadCount });
      const now = new Date().toISOString();
      p.setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const anyUnread = p.items.some((n) => !n.readAt);
  return (
    <FlatList
      data={p.items}
      keyExtractor={(n) => n.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={() => { marked.current.clear(); void p.refresh(); }} tintColor={c.ink} />}
      onEndReached={p.loadMore}
      onEndReachedThreshold={0.6}
      ListHeaderComponent={
        <View style={{ alignItems: 'flex-end', paddingBottom: 12, gap: 8 }}>
          <Btn small label="Mark all read" onPress={() => void markAll()} disabled={busy || !anyUnread} />
          <ErrorNote message={err} />
        </View>
      }
      ListEmptyComponent={p.loading ? <Loading /> : p.error ? <ErrorNote message={p.error} /> : <Text muted>No notifications yet.</Text>}
      ListFooterComponent={p.loadingMore ? <Loading what="Loading more" /> : undefined}
      {...LIST_PERF}
      renderItem={({ item: n }) => {
        const href = notificationHref(n, me.handle);
        const unread = !n.readAt;
        return (
          <Touch
            onPress={href ? () => go(href) : undefined} disabled={!href} accessibilityRole={href ? 'link' : 'text'}
            accessibilityLabel={`${unread ? 'Unread: ' : ''}${describe(n)}, ${relativeTime(n.createdAt)}`}
            style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.hair, backgroundColor: unread ? c.highlight : undefined }}
          >
            <View style={{ width: 40, alignItems: 'center' }}>
              {n.actor ? <Avatar seed={n.actor.handle} gender={n.actor.gender ?? null} size={40} />
                : WARNINGS.has(n.kind) ? <AlertIcon size={28} /> : <View style={{ paddingTop: 8 }}><Dot size={16} /></View>}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text v={unread ? 'bold' : 'body'} style={{ fontSize: 16, lineHeight: 22 }}>{describe(n)}</Text>
              {n.post?.snippet ? <Text v="meta" numberOfLines={2}>{n.post.snippet}</Text> : null}
              <Text v="meta" accessibilityLabel={fmtDate(n.createdAt)}>{relativeTime(n.createdAt)}</Text>
            </View>
          </Touch>
        );
      }}
    />
  );
}
