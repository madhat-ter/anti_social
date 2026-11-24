/** "Forgot your PIN?": handle, the recovery code or an admin's one-hour code, a new PIN (apps/web/app/recover/page.tsx). */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AlertIcon } from '@/components/Icons';
import { ChoosePin, RecoveryCodeStep } from '@/components/Pin';
import { Screen } from '@/components/Screen';
import { Field, Row, Text, Win } from '@/components/ui';

export default function Recover() {
  const { signedIn } = useSession();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  if (newCode) return <RecoveryCodeStep code={newCode} onDone={() => void signedIn()} />;

  return (
    <Screen>
      <Text v="poster" accessibilityRole="header">Forgot your PIN?</Text>
      <Win title="new_pin">
        <Row style={{ alignItems: 'flex-start' }} gap={14}>
          <AlertIcon />
          <Text style={{ flex: 1 }}>
            Use the recovery code you saved when you joined, or ask an admin for a reset code (it works for an hour). Either one
            lets you choose a new PIN, unlocks your account and signs you out on every other device.
          </Text>
        </Row>
        <Field label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} textContentType="username" />
        <Field label="Recovery code or admin’s reset code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX…" />
        <ChoosePin submitLabel="Set my new PIN" submit={async (pin) => {
          if (!handle.trim() || !code.trim()) throw new Error('Fill in your handle and the code first.');
          const r = await api.pinReset({ handle: handle.trim().replace(/^@/, ''), code, pin });
          if (r.recoveryCode) setNewCode(r.recoveryCode); else await signedIn();
        }} />
      </Win>
    </Screen>
  );
}
