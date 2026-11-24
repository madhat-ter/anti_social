/**
 * A thread (apps/web/app/p/[id]/page.tsx, RFC §10.12): the post on top, heavier and labelled, the
 * replies under it on the thread line, and the reply box at the end. A reply you came for is lit.
 */
import { useCallback, useRef } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Post, type Thread } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Composer } from '@/components/Composer';
import { PostCard } from '@/components/PostCard';
import { ErrorNote, Loading, Text } from '@/components/ui';

export default function ThreadScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const { c } = useTheme();
  const qc = useQueryClient();
  const key = ['thread', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.thread(id) });
  const list = useRef<FlatList<Post>>(null);

  const set = useCallback((fn: (t: Thread) => Thread) => qc.setQueryData<Thread>(key, (t) => (t ? fn(t) : t)), [qc, key]);
  const change = useCallback((p: Post) => set((t) => (t.root.id === p.id ? { ...t, root: p } : { ...t, replies: t.replies.map((r) => (r.id === p.id ? p : r)) })), [set]);

  if (q.isPending) return <Loading />;
  if (!q.data) return <View style={{ padding: 16 }}><ErrorNote message={errorMessage(q.error)} /></View>;
  const t = q.data;
  const target = focus || t.focusId;
  const focusAt = target ? t.replies.findIndex((r) => r.id === target) : -1;
  const authorOf = (pid: string | null) => (pid === t.root.id ? t.root.author?.handle : t.replies.find((r) => r.id === pid)?.author?.handle) ?? null;

  return (
    <FlatList
      ref={list}
      data={t.replies}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.ink} />}
      onLayout={() => { if (focusAt > 0) setTimeout(() => list.current?.scrollToIndex({ index: focusAt, viewPosition: 0.3, animated: true }), 250); }}
      onScrollToIndexFailed={() => {}}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <PostCard post={t.root} variant="lead" framed onChange={change} />
          <Text v="h2" accessibilityRole="header" style={{ fontSize: 22 }}>
            {t.replies.length === 0 ? 'No replies yet' : `${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}`}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <PostCard post={item} variant="reply" highlight={item.id === target} onChange={change}
          replyingTo={item.parentId && item.parentId !== t.root.id ? authorOf(item.parentId) : null} />
      )}
      ListFooterComponent={
        t.root.deleted || t.root.hidden ? undefined : (
          <View style={{ paddingTop: 8 }}>
            <Composer parentId={t.root.id} placeholder={t.root.author ? `Reply to @${t.root.author.handle}...` : undefined}
              onCreated={(p) => set((cur) => ({ ...cur, root: { ...cur.root, replyCount: cur.root.replyCount + 1 }, replies: [...cur.replies, p] }))} />
          </View>
        )
      }
    />
  );
}
