/** Joining with an invite: code, handle and name, a PIN, then the recovery code (apps/web/app/join/page.tsx). */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { validateHandle, DISPLAY_NAME_MAX } from '@anti/shared';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/Avatar';
import { ChoosePin, RecoveryCodeStep } from '@/components/Pin';
import { Screen } from '@/components/Screen';
import { Btn, ErrorNote, Field, LinkText, Row, Text, Win } from '@/components/ui';

const STEPS = ['Invite code', 'Your handle', 'Your PIN'] as const;

function Steps({ at }: { at: number }) {
  const { c } = useTheme();
  return (
    <Row gap={6} wrap accessibilityLabel={`Step ${at} of ${STEPS.length}`}>
      {STEPS.map((s, i) => {
        const on = i + 1 === at;
        return (
          <Row key={s} gap={5}>
            <View style={{ width: 22, height: 22, borderWidth: 2, borderColor: c.ink, backgroundColor: on ? c.ink : i + 1 < at ? c.panel : c.paper, alignItems: 'center', justifyContent: 'center' }}>
              <Text v="ui" style={{ fontSize: 12, lineHeight: 14, color: on ? c.paper : c.ink }}>{i + 1}</Text>
            </View>
            <Text v="ui" style={{ fontSize: 13, color: on ? c.ink : c.gray }}>{s}</Text>
          </Row>
        );
      })}
    </Row>
  );
}

export default function Join() {
  const { signedIn } = useSession();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [wouldWaitlist, setWouldWaitlist] = useState(false);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [recovery, setRecovery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the token is saved already; going in waits until the recovery code is put away
  if (step === 4) return <RecoveryCodeStep code={recovery} onDone={() => void signedIn()} />;

  const h = handle.trim();
  const previewSeed = h && !validateHandle(h) ? h : null;

  return (
    <Screen>
      <Text v="poster" accessibilityRole="header">Join</Text>
      <Win title="join.app">
        <Steps at={step} />

        {step === 1 && (
          <View style={{ gap: 14 }}>
            <Text>Someone already inside sent you a code. It works once and expires after a week.</Text>
            <Field label="Invite code" value={code} onChangeText={setCode} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} autoFocus />
            <ErrorNote message={err} />
            <Row style={{ justifyContent: 'space-between' }} wrap>
              <LinkText label="I already have a seat" onPress={() => router.replace('/login')} small />
              <Btn kind="primary" label="Check code" busy={busy} disabled={!code.trim()} onPress={async () => {
                setBusy(true); setErr(null);
                try {
                  const r = await api.checkInvite(code);
                  if (!r.valid) setErr('That invite code is not valid, or has already been used.');
                  else { setWouldWaitlist(r.wouldWaitlist); setStep(2); }
                } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
              }} />
            </Row>
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: 14 }}>
            <Text>{wouldWaitlist
              ? 'All seats are taken. You will join the waitlist and get a seat when one opens.'
              : 'A seat is free. It is yours once you choose a PIN.'}</Text>
            <Row style={{ alignItems: 'flex-start' }} gap={14}>
              <View style={{ alignItems: 'center', width: 110, gap: 6 }}>
                <Avatar seed={previewSeed} size={104} label={previewSeed ? `Your face, made from @${previewSeed}` : 'No handle yet'} />
                <Text v="meta" style={{ textAlign: 'center', fontSize: 12, lineHeight: 15 }}>{previewSeed ? 'A first sketch. It finishes when you set up your profile.' : 'Type a handle to meet your face.'}</Text>
              </View>
              <View style={{ flex: 1, gap: 12 }}>
                <Field label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} />
                <Text v="small" muted>3 to 20 letters, numbers or underscores. You can&apos;t change it later. Your face is drawn from it, and from the gender you pick in a moment.</Text>
                <Field label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={DISPLAY_NAME_MAX} />
              </View>
            </Row>
            <ErrorNote message={err} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Btn label="Back" onPress={() => { setErr(null); setStep(1); }} />
              <Btn kind="primary" label="Continue" onPress={() => {
                const v = validateHandle(h);
                if (v) { setErr(v); return; }
                if (!displayName.trim()) { setErr('Choose a display name.'); return; }
                setErr(null); setStep(3);
              }} />
            </Row>
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: 14 }}>
            <Row style={{ alignItems: 'flex-start' }} gap={14}>
              <Avatar seed={h} size={84} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text><Text v="bold">{displayName}</Text> <Text v="ui" muted>@{h}</Text></Text>
                <Text>Choose a 6-digit PIN to finish. You sign in with your handle, <Text v="bold">@{h}</Text>, and this PIN.</Text>
              </View>
            </Row>
            <ChoosePin
              submitLabel="Join"
              left={<Btn label="Back" onPress={() => { setErr(null); setStep(2); }} />}
              submit={async (pin) => {
                const res = await api.join({ code, handle: h, displayName: displayName.trim(), pin });
                setRecovery(res.recoveryCode); setStep(4);
              }}
            />
          </View>
        )}
      </Win>
    </Screen>
  );
}
