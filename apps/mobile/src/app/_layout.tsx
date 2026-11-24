/**
 * The whole app's frame (RFC §10.32): fonts, the saved query cache, who is signed in, the theme,
 * and four doors that open by state: signed out → the welcome and sign-in; signed in but not set
 * up → setup; waiting for a seat (waitlisted, archived) → status; seated → the app.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
// one file per weight in use (the packages' index would ship every weight)
import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_900Black } from '@expo-google-fonts/archivo/900Black';
import { Tiny5_400Regular } from '@expo-google-fonts/tiny5/400Regular';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { persister, queryClient } from '@/lib/query';
import { SessionProvider, useSession } from '@/lib/session';
import { PALETTES, ThemeContext } from '@/lib/theme';
import { TapeProvider } from '@/components/Tape';
import { Offline } from '@/components/Offline';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular, Archivo_500Medium, Archivo_700Bold, Archivo_900Black, Tiny5_400Regular,
    'ArchivoExtraCondensed-Black': require('../../assets/fonts/ArchivoExtraCondensed-Black.ttf'),
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}>
          <SessionProvider>
            <Themed />
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Themed() {
  const { status, me } = useSession();
  // RFC §10.14: the member's own choice; light for everyone else, never the phone's setting
  const name = me?.theme === 'dark' ? 'dark' : 'light';
  const c = PALETTES[name];

  useEffect(() => {
    if (status !== 'starting') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'starting') return null;
  return (
    <ThemeContext.Provider value={{ name, c }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: c.paper }}>
        {status === 'offline' ? <Offline /> : (
          <TapeProvider>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
              <Stack.Protected guard={status === 'signedOut'}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
              <Stack.Protected guard={status === 'setup'}>
                <Stack.Screen name="setup" />
              </Stack.Protected>
              <Stack.Protected guard={status === 'waiting'}>
                <Stack.Screen name="status" />
              </Stack.Protected>
              <Stack.Protected guard={status === 'seated'}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
            </Stack>
          </TapeProvider>
        )}
      </View>
    </ThemeContext.Provider>
  );
}
