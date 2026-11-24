/** Seated members: the tabs, and the pages pushed over them (a thread, a profile, a collab, …). */
import { Stack } from 'expo-router';
import { FONT, useTheme } from '@/lib/theme';

export default function AppLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false, headerTintColor: c.ink, headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: c.paper }, contentStyle: { backgroundColor: c.paper },
        headerTitleStyle: { fontFamily: FONT.ui, fontSize: 17, color: c.ink },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="p/[id]" options={{ title: 'Thread' }} />
      <Stack.Screen name="u/[handle]" options={{ title: '' }} />
      <Stack.Screen name="collab/[id]" options={{ title: 'Collab' }} />
      <Stack.Screen name="collab/event/[id]" options={{ title: 'Event' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Edit profile', presentation: 'modal' }} />
      <Stack.Screen name="record" options={{ title: 'Record a monologue', presentation: 'modal' }} />
    </Stack>
  );
}
