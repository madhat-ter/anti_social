/**
 * Settings (apps/web/app/settings/page.tsx): only what is a setting (RFC §10.26). Appearance (light
 * unless you choose dark, RFC §10.14), feed order (RFC §10.23), your PIN (RFC §10.13), sign out,
 * and deleting the account. Passkeys, payments and contact details stay on the website.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Me } from '@/lib/api';
import { openSite } from '@/lib/links';
import { useMe, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { ChoosePin } from '@/components/Pin';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, Field, LinkText, Row, RuleHeading, Text, Touch } from '@/components/ui';

function Choice({ on, label, says, onPress }: { on: boolean; label: string; says?: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Touch onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.ink }} />}
      </View>
      <Text style={{ flex: 1 }}><Text v="bold">{label}</Text>{says ? <Text v="meta"> {says}</Text> : null}</Text>
    </Touch>
  );
}

export default function SettingsScreen() {
  const me = useMe();
  const { signOut } = useSession();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinDone, setPinDone] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);

  const save = async (b: Parameters<typeof api.updateMe>[0]) => {
    setErr(null);
    const was = qc.getQueryData<Me>(['me']);
    if (was) qc.setQueryData<Me>(['me'], { ...was, ...b } as Me);
    try { qc.setQueryData(['me'], await api.updateMe(b)); }
    catch (e) { if (was) qc.setQueryData(['me'], was); setErr(errorMessage(e)); }
  };

  const theme = me.theme === 'dark' ? 'dark' : 'light';
  const order = me.feedOrder === 'newest' ? 'newest' : 'mixed';

  return (
    <Screen>
      <RuleHeading>Appearance</RuleHeading>
      <View>
        <Choice on={theme === 'light'} label="Light" onPress={() => void save({ theme: 'light' })} />
        <Choice on={theme === 'dark'} label="Dark" onPress={() => void save({ theme: 'dark' })} />
      </View>
      <Text v="meta">Saved to your account, so it follows you to every device. Anti stays light until you choose Dark here, even if your phone is set to dark.</Text>

      <RuleHeading>Feed</RuleHeading>
      <View>
        <Choice on={order === 'mixed'} label="Mixed" says="The newest post on top, the rest of what’s new mixed, so no one fills your screen." onPress={() => void save({ feedOrder: 'mixed' })} />
        <Choice on={order === 'newest'} label="Newest first" says="Everything in the order it was posted." onPress={() => void save({ feedOrder: 'newest' })} />
      </View>
      <Text v="meta">It takes effect the next time you open the feed. Likes never move a post either way.</Text>
      <ErrorNote message={err} />

      <RuleHeading>PIN</RuleHeading>
      <Text>You sign in with your handle, <Text v="bold">@{me.handle}</Text>, and a 6-digit PIN. Changing it signs you out on every other device.</Text>
      {pinDone && <Text accessibilityLiveRegion="polite">Your PIN is changed. Other devices are signed out.</Text>}
      {pinOpen
        ? <ChoosePin needCurrent={me.pinSet !== false} birthday={me.birthday} submitLabel="Change PIN"
            submit={async (pin, current) => { await api.setPin(pin, current); setPinOpen(false); setPinDone(true); }}
            left={<Btn label="Cancel" onPress={() => setPinOpen(false)} />} />
        : <Row><Btn label="Change PIN" onPress={() => { setPinOpen(true); setPinDone(false); }} /></Row>}

      <RuleHeading>More</RuleHeading>
      <Text v="meta">Passkeys, payments and your contact details are on the website.</Text>
      <Row><LinkText label="Open Settings on tryanti.social" onPress={() => void openSite('/settings')} /></Row>

      <RuleHeading>Account</RuleHeading>
      <Row><Btn label="Sign out" onPress={() => void signOut()} /></Row>
      <Text v="bold" style={{ paddingTop: 8 }}>Delete account</Text>
      <Text v="meta">This is permanent. Type {me.handle} to confirm.</Text>
      <Field value={confirm} onChangeText={setConfirm} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Type your handle to confirm" />
      <ErrorNote message={delErr} />
      <Row>
        <Btn danger label="Delete my account" disabled={confirm !== me.handle}
          onPress={async () => {
            try { await api.deleteMe(); await api.forget(); await signOut(); } catch (e) { setDelErr(errorMessage(e)); }
          }} />
      </Row>
    </Screen>
  );
}
