/** RFC §10.13: your handle and your 6-digit PIN (as apps/web/app/login/page.tsx). */
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { KeyIcon } from '@/components/Icons';
import { PinField, PIN_RULE_LINE, pinError } from '@/components/Pin';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, Field, LinkText, Row, Text, Win } from '@/components/ui';

export default function Login() {
  const { signedIn } = useSession();
  const [handle, setHandle] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = useRef('');

  async function signIn(h = handle, p = pin) {
    const hh = h.trim().replace(/^@/, '');
    if (busy || !hh || p.length < 6 || sent.current === `${hh}|${p}`) return;
    sent.current = `${hh}|${p}`;
    setBusy(true); setErr(null);
    try {
      await api.pinLogin({ handle: hh, pin: p });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await signedIn();
    } catch (e) {
      setErr(pinError(e)); setPin(''); sent.current = '';
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <Text v="poster" accessibilityRole="header">Sign in</Text>
      <Win title="sign_in">
        <Row style={{ alignItems: 'flex-start' }} gap={14}>
          <KeyIcon />
          <View style={{ flex: 1, gap: 14 }}>
            <Field
              label="Handle" value={handle} onChangeText={setHandle} placeholder="@yourhandle" autoFocus
              autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username"
            />
            <PinField label="PIN" value={pin} onChange={setPin} onComplete={(v) => void signIn(handle, v)} />
            <Text v="small" muted>{PIN_RULE_LINE}</Text>
            <ErrorNote message={err} />
            <Row style={{ justifyContent: 'flex-end' }}>
              <Btn kind="default" label={busy ? 'Signing in…' : 'Sign in'} busy={busy} disabled={!handle.trim() || pin.length < 6} onPress={() => void signIn()} />
            </Row>
          </View>
        </Row>
      </Win>
      <View style={{ gap: 8 }}>
        <LinkText label="Forgot your PIN?" onPress={() => router.push('/recover')} />
        <Text>Not a member yet? <LinkText label="Join with an invite" onPress={() => router.replace('/join')} />.</Text>
      </View>
    </Screen>
  );
}
