/** A member's profile (the page itself is components/Profile.tsx; "You" shows the same for yourself). */
import { Stack, useLocalSearchParams } from 'expo-router';
import { Profile } from '@/components/Profile';

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return (
    <>
      <Stack.Screen options={{ title: `@${handle}` }} />
      <Profile handle={handle} />
    </>
  );
}