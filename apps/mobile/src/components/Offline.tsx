import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/lib/session';
import { AlertIcon } from './Icons';
import { Btn, Text, Win } from './ui';
import { Screen } from './Screen';

/** Signed in, but the server can't be reached and nothing is saved on the phone yet. */
export function Offline() {
  const { refreshMe, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <Screen top style={{ justifyContent: 'center', flexGrow: 1 }}>
      <Win title="No connection">
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <AlertIcon />
          <Text style={{ flex: 1 }}>anti can&rsquo;t reach tryanti.social right now. Check your signal, then try again.</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Btn label="Sign out" onPress={() => void signOut()} />
          <Btn label="Try again" kind="default" busy={busy} onPress={async () => { setBusy(true); try { await refreshMe(); } finally { setBusy(false); } }} />
        </View>
      </Win>
    </Screen>
  );
}
