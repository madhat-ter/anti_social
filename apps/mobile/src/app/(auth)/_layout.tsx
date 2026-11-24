import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function AuthLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false, headerTintColor: c.ink, headerTitle: '', headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: c.paper }, contentStyle: { backgroundColor: c.paper },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
