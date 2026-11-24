/**
 * The feed (apps/web/app/home.tsx): the post box on top (with Record while it is empty, RFC
 * §10.26), a birthday line on someone's day, then the list with its line and its end.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, type Post } from '@/lib/api';
import { usePaged } from '@/lib/paged';
import { useMe } from '@/lib/session';
import { Composer } from '@/components/Composer';
import { FeedList, useFeedVisit } from '@/components/FeedList';
import { isBirthdayToday } from '@/components/Marks';
import { Lurker } from '@/components/Lurker';
import { Text } from '@/components/ui';

function BirthdayLine() {
  const q = useQuery({ queryKey: ['members', 'all'], queryFn: () => api.members(null, 100), staleTime: 10 * 60_000 });
  const list = (q.data?.items ?? []).filter((m) => isBirthdayToday(m.birthday));
  if (list.length === 0) return null;
  return (
    <Text v="small" accessibilityLiveRegion="polite">
      <Text v="bold" style={{ fontSize: 14 }}>Birthday today: </Text>
      {list.map((m, i) => (
        <Text key={m.handle} v="small" onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: m.handle } })} style={{ textDecorationLine: 'underline' }}>
          {i > 0 ? ', ' : ''}{m.displayName}
        </Text>
      ))}
    </Text>
  );
}

export default function FeedScreen() {
  const me = useMe();
  const fv = useFeedVisit(me.handle);
  const p = usePaged<Post>(['feed'], async (c) => {
    const page = await api.feed(c, 20, c ? {} : fv.params());
    if (page.visit) fv.got(page.visit);
    return page;
  });
  const refresh = useCallback(() => { fv.restart(); void p.refresh(); }, [fv, p]);

  return (
    <FeedList
      p={p} visit={fv.visit} mine={me.handle}
      empty="Nothing here yet. Say something: the room is quiet until someone does."
      onRefresh={refresh} onScroll={fv.touch}
      header={
        <View style={{ gap: 14 }}>
          <Lurker />
          <Composer record onCreated={(post) => p.setItems((cur) => [post, ...cur])} />
          <BirthdayLine />
        </View>
      }
    />
  );
}

