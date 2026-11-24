/**
 * RFC §10.13: the 6-digit PIN (as apps/web/src/components/Pin.tsx). One field, the number pad,
 * dots with a Show toggle. `ChoosePin` chooses or changes one; the recovery code is shown once.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { PIN_LENGTH, PIN_RULES, pinProblem } from '@anti/shared';
import { ApiError, errorMessage } from '@/lib/api';
import { FONT, useTheme } from '@/lib/theme';
import { AlertIcon } from './Icons';
import { Btn, ErrorNote, Field, Row, Text, Win } from './ui';
import { Screen } from './Screen';

export function PinField({ label, value, onChange, onComplete, autoFocus, newPin }: {
  label: string; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean;
  /** choosing a new one (the phone's password manager offers to save it) */
  newPin?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      <Field
        style={{ flex: 1 }} label={label} value={value} autoFocus={autoFocus}
        secureTextEntry={!show} keyboardType="number-pad" maxLength={PIN_LENGTH}
        textContentType={newPin ? 'newPassword' : 'password'} autoComplete={newPin ? 'new-password' : 'current-password'}
        inputStyle={{ fontFamily: FONT.ui, fontSize: 22, letterSpacing: 6 }}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, '').slice(0, PIN_LENGTH);
          onChange(v);
          if (v.length === PIN_LENGTH && v !== value) onComplete?.(v);
        }}
      />
      <Btn label={show ? 'Hide' : 'Show'} onPress={() => setShow((s) => !s)} accessibilityLabel={show ? 'Hide PIN' : 'Show PIN'} />
    </View>
  );
}

/** What a failed PIN request means, in words (a rest ends at a time on the viewer's clock). */
export function pinError(e: unknown): string {
  if (e instanceof ApiError && e.error === 'pin_resting') {
    const at = e.detail?.match(/\d{4}-\d\d-\d\dT[\d:.]+Z/)?.[0];
    const time = at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'a little later';
    return `This account is resting until ${time}. Too many wrong PINs.`;
  }
  return errorMessage(e);
}

export const PIN_RULE_LINE = `After ${PIN_RULES.triesBeforeRest} wrong tries, the account rests for ${PIN_RULES.restMinutes} minutes.`;

export function ChoosePin({ needCurrent, birthday, submitLabel, submit, left }: {
  needCurrent?: boolean; birthday?: string | null; submitLabel: string;
  submit: (pin: string, current?: string) => Promise<void>;
  /** a Back or Cancel button beside the main one */
  left?: ReactNode;
}) {
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    const p = pinProblem(pin, birthday);
    if (p) { setErr(p); return; }
    if (pin !== again) { setErr('The two PINs are not the same.'); return; }
    setBusy(true); setErr(null);
    try { await submit(pin, needCurrent ? current : undefined); }
    catch (x) { setErr(pinError(x)); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 14 }}>
      {needCurrent && <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
      <PinField label="New PIN" value={pin} onChange={setPin} autoFocus={!needCurrent} newPin />
      <PinField label="The same PIN again" value={again} onChange={setAgain} newPin />
      <Text v="small" muted>Six digits you will remember and nobody would guess: not 123456, not your birthday.</Text>
      <ErrorNote message={err} />
      <Row style={{ justifyContent: left ? 'space-between' : 'flex-end' }}>
        {left}
        <Btn
          kind="primary" label={busy ? 'Saving…' : submitLabel} busy={busy} onPress={() => void go()}
          disabled={pin.length < PIN_LENGTH || again.length < PIN_LENGTH || (!!needCurrent && current.length < PIN_LENGTH)}
        />
      </Row>
    </View>
  );
}

export function RecoveryCodeStep({ code, onDone }: { code: string; onDone: () => void }) {
  const { c } = useTheme();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Screen top>
      <Text v="poster" accessibilityRole="header">Save your recovery code</Text>
      <Win title="recovery_code.txt">
        <Row style={{ alignItems: 'flex-start' }} gap={14}>
          <AlertIcon />
          <Text style={{ flex: 1 }}>If you forget your PIN, this code lets you choose a new one (an admin can also help). It is shown once. Write it down or put it in a password manager.</Text>
        </Row>
        <View style={{ backgroundColor: c.ink, padding: 16 }}>
          <Text v="ui" selectable accessibilityLabel="Recovery code" style={{ color: c.paper, fontSize: 20, lineHeight: 30, letterSpacing: 1.5 }}>{code}</Text>
        </View>
        <Pressable
          onPress={() => setSaved((s) => !s)} accessibilityRole="checkbox" accessibilityState={{ checked: saved }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
        >
          <View style={{ width: 22, height: 22, borderWidth: 2, borderColor: c.ink, backgroundColor: saved ? c.ink : c.paper, alignItems: 'center', justifyContent: 'center' }}>
            {saved && <Text v="ui" style={{ color: c.paper, fontSize: 14, lineHeight: 16 }}>✓</Text>}
          </View>
          <Text>I saved it somewhere safe</Text>
        </Pressable>
        <Row style={{ justifyContent: 'flex-end' }}>
          <Btn label={copied ? 'Copied' : 'Copy'} onPress={async () => { await Clipboard.setStringAsync(code); setCopied(true); }} />
          <Btn kind="primary" label="Continue" disabled={!saved} onPress={onDone} />
        </Row>
      </Win>
    </Screen>
  );
}
