/**
 * The five tabs along the bottom, as the site's phone bar (PhoneBar.tsx, RFC §10.26): the four
 * rooms (Feed, Collab, Monologue, Members) and "You", straight to your own profile. A lit tab is
 * ink with paper lines.
 */
import { Pressable, View } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMe } from '@/lib/session';
import { FONT, useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { TabIcon, type IconName } from '@/components/Icons';
import { TopBar } from '@/components/TopBar';
import { Text } from '@/components/ui';

const ROOMS: Record<string, { label: string; icon: IconName | 'you' }> = {
  index: { label: 'Feed', icon: 'feed' },
  collab: { label: 'Collab', icon: 'collabs' },
  monologue: { label: 'Monologue', icon: 'tape' },
  members: { label: 'Members', icon: 'members' },
  you: { label: 'You', icon: 'you' },
};

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const me = useMe();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 2, backgroundColor: c.ink, borderTopWidth: 2, borderColor: c.ink, paddingBottom: insets.bottom }}>
      {state.routes.map((route, i) => {
        const room = ROOMS[route.name];
        if (!room) return null;
        const on = state.index === i;
        const ink = on ? c.paper : c.ink;
        const bg = on ? c.ink : c.paper;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={room.label}
            onPress={() => { if (!on) { void Haptics.selectionAsync(); navigateToTab(route.key); } }}
            style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6, backgroundColor: bg, borderWidth: on ? 2 : 0, borderColor: c.paper }}
          >
            {room.icon === 'you'
              ? <Avatar seed={me.handle} gender={me.gender} size={26} />
              : <TabIcon name={room.icon} size={22} color={ink} fill={bg} />}
            <Text style={{ fontFamily: FONT.ui, fontSize: 11.5, lineHeight: 13, color: ink }} numberOfLines={1}>{room.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ header: () => <TopBar />, sceneStyle: { backgroundColor: c.paper } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="collab" />
      <Tabs.Screen name="monologue" />
      <Tabs.Screen name="members" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
