/**
 * The header (AGENTS.md: the wordmark only, plus on phones the File button and the bell; nothing
 * else goes here without asking the owner). "anti" in the poster face with the red dot.
 */
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { openSite } from '@/lib/links';
import { FONT, useTheme } from '@/lib/theme';
import { TabIcon } from './Icons';
import { Badge, Text } from './ui';

/** unread notifications, checked every minute while the app is open */
export function useUnread() {
  return useQuery({ queryKey: ['unread'], queryFn: () => api.unreadCount(), refetchInterval: 60_000, staleTime: 20_000 }).data?.unreadCount ?? 0;
}

export function Wordmark({ size = 30 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }} accessibilityRole="header" accessibilityLabel="anti">
      <Text style={{ fontFamily: FONT.poster, fontSize: size, lineHeight: size * 1.02, textTransform: 'uppercase' }}>anti</Text>
      <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: c.signal, marginLeft: size * 0.07, marginBottom: size * 0.12 }} />
    </View>
  );
}

function HeadBtn({ icon, label, onPress, badge }: { icon: 'file' | 'bell'; label: string; onPress: () => void; badge?: number }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: 40, height: 40, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.ink : c.paper })}>
      {({ pressed }) => (
        <>
          <TabIcon name={icon} color={pressed ? c.paper : c.ink} fill={pressed ? c.ink : c.paper} />
          <Badge n={badge ?? 0} />
        </>
      )}
    </Pressable>
  );
}

export function TopBar() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useUnread();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: c.paper, borderBottomWidth: 2, borderColor: c.ink }}>
      <View style={{ height: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={() => router.navigate('/')} accessibilityLabel="anti, home" style={{ flex: 1 }}>
          <Wordmark />
        </Pressable>
        <HeadBtn icon="file" label="Your File" onPress={() => void openSite('/file')} />
        <HeadBtn icon="bell" label={unread > 0 ? `Notifications, ${unread > 99 ? '99+' : unread} unread` : 'Notifications'} badge={unread}
          onPress={() => router.push('/notifications')} />
      </View>
    </View>
  );
}
