'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote, RecoveryCodeStep } from '@/components/ui';

export default function Recover() {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (newCode) return <RecoveryCodeStep code={newCode} onDone={() => { router.push('/'); router.refresh(); }} />;

  return (
    <div className="stack">
      <h1>Recover your account</h1>
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try {
          const ch = await api.recoverOptions({ handle: handle.trim().replace(/^@/, ''), recoveryCode: code });
          const response = await startRegistration({ optionsJSON: ch.options as any });
          const res = await api.recoverVerify({ challengeId: ch.challengeId, response });
          setNewCode(res.recoveryCode);
        } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
      }}>
        <p className="muted">Recovering removes all existing passkeys and sessions, and registers a new passkey on this device.</p>
        <label>Handle
          <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>Recovery code
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required />
        </label>
        <ErrorNote message={err} />
        <button className="btn primary" disabled={busy}>Recover and create passkey</button>
      </form>
    </div>
  );
}
