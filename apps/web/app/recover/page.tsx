'use client';
import { useTitle } from '@/lib/hooks';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { RecoveryCodeStep } from '@/components/ui';
import { AlertIcon, Win } from '@/components/retro';
import { ChoosePin } from '@/components/Pin';

/**
 * RFC §10.13, "Forgot your PIN?": your handle, then your recovery code or the one-hour code an
 * admin gave you, then a new PIN. Either one unlocks the account and signs you out everywhere;
 * the recovery code also removes passkeys and is replaced by a new one, shown once.
 */
export default function Recover() {
  useTitle('Forgot your PIN');
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const home = () => { router.push('/'); router.refresh(); };

  if (newCode) return <RecoveryCodeStep code={newCode} onDone={home} />;

  return (
    <div className="stack">
      <h1>Forgot your PIN?</h1>
      <Win title="new_pin" as="div" bodyClassName="stack">
        <div className="dlg-body">
          <AlertIcon />
          <p>
            Use the recovery code you saved when you joined, or ask an admin for a reset code (it works for an hour). Either one
            lets you choose a new PIN, unlocks your account and signs you out on every other device.
          </p>
        </div>
        <label>Handle
          <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label>Recovery code or admin&rsquo;s reset code
          <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required placeholder="XXXX-XXXX…" />
        </label>
        <ChoosePin submitLabel="Set my new PIN" submit={async (pin) => {
          if (!handle.trim() || !code.trim()) throw new Error('Fill in your handle and the code first.');
          const r = await api.pinReset({ handle: handle.trim().replace(/^@/, ''), code, pin });
          if (r.recoveryCode) setNewCode(r.recoveryCode); else home();
        }} />
      </Win>
    </div>
  );
}
