'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote, RecoveryCodeStep } from '@/components/ui';
import { AlertIcon, Win } from '@/components/retro';

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
      <Win title="recover" as="div" bodyClassName="stack">
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr(null);
          try {
            const ch = await api.recoverOptions({ handle: handle.trim().replace(/^@/, ''), recoveryCode: code });
            const response = await startRegistration({ optionsJSON: ch.options as any });
            const res = await api.recoverVerify({ challengeId: ch.challengeId, response });
            setNewCode(res.recoveryCode);
          } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
        }}>
          <div className="dlg-body">
            <AlertIcon />
            <p>Recovering signs you out everywhere and removes your old passkeys. You will create a new passkey on this device and get a new recovery code.</p>
          </div>
          <label>Handle
            <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>Recovery code
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required />
          </label>
          <ErrorNote message={err} />
          <div className="row dlg-actions">
            <button className="btn default" disabled={busy}>Recover and create passkey</button>
          </div>
        </form>
      </Win>
    </div>
  );
}
