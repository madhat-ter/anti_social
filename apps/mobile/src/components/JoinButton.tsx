/**
 * The one join button (RFC §10.21): its words follow the rules in @web/lib/collab (joinLabel).
 * One tap does the job; asking to join takes an optional note first; leaving is one tap too.
 */
import { useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { joinLabel, type Joinable } from '@web/lib/collab';
import { errorMessage } from '@/lib/api';
import { Btn, ErrorNote, Field, Row } from './ui';

export function JoinButton({ j, join, ask, leave, withdraw }: {
  j: Joinable;
  join: () => Promise<unknown>;
  ask: (note?: string) => Promise<unknown>;
  leave?: () => Promise<unknown>;
  withdraw?: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const l = joinLabel(j);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (asking) {
    return (
      <View style={{ gap: 10 }}>
        <Field label="A note for the host (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Row gap={8}>
          <Btn kind="primary" label={busy ? 'Asking…' : 'Send'} busy={busy} onPress={() => void run(async () => { await ask(note.trim() || undefined); setAsking(false); setNote(''); })} />
          <Btn label="Cancel" onPress={() => setAsking(false)} />
        </Row>
        <ErrorNote message={err} />
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Row gap={8} wrap>
        {l.mode === 'join' || l.mode === 'waitlist' ? <Btn kind="primary" label={l.text} busy={busy} onPress={() => void run(join)} />
          : l.mode === 'ask' ? <Btn kind="primary" label={l.text} onPress={() => setAsking(true)} />
          : <Btn label={l.text} disabled />}
        {l.leave && leave && <Btn label={l.leave} busy={busy} onPress={() => void run(leave)} />}
        {l.mode === 'asked' && withdraw && <Btn label="Take it back" busy={busy} onPress={() => void run(withdraw)} />}
      </Row>
      <ErrorNote message={err} />
    </View>
  );
}
