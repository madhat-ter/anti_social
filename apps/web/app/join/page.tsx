'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { validateHandle, DISPLAY_NAME_MAX } from '@anti/shared';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote, RecoveryCodeStep } from '@/components/ui';

export default function Join() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [wouldWaitlist, setWouldWaitlist] = useState(false);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [recovery, setRecovery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (step === 4) return <RecoveryCodeStep code={recovery} onDone={() => { router.push('/'); router.refresh(); }} />;

  return (
    <div className="stack">
      <h1>Join</h1>
      <p className="muted">Step {step} of 3</p>

      {step === 1 && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const r = await api.checkInvite(code);
          if (!r.valid) throw Object.assign(new Error('That invite code is not valid, or has already been used.'), { name: 'Invalid' });
          setWouldWaitlist(r.wouldWaitlist); setStep(2);
        }); }}>
          <label>Invite code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" required />
          </label>
          <ErrorNote message={err} />
          <button className="btn primary" disabled={busy || !code.trim()}>Check code</button>
          <p className="muted">Already a member? <Link href="/login">Sign in</Link></p>
        </form>
      )}

      {step === 2 && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault();
          const v = validateHandle(handle);
          if (v) { setErr(v); return; }
          if (!displayName.trim()) { setErr('Choose a display name.'); return; }
          setErr(null); setStep(3);
        }}>
          {wouldWaitlist
            ? <p className="banner">All seats are taken. You will join the waitlist and be seated when a spot opens.</p>
            : <p className="muted">A seat is available.</p>}
          <label>Handle (permanent)
            <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" autoCapitalize="none" required />
          </label>
          <label>Display name
            <input value={displayName} maxLength={DISPLAY_NAME_MAX} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <ErrorNote message={err} />
          <div className="row">
            <button type="button" className="btn" onClick={() => { setErr(null); setStep(1); }}>Back</button>
            <button className="btn primary">Continue</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="card stack">
          <p>Create a passkey for <strong>@{handle}</strong>. You will use your device (fingerprint, face, or PIN) instead of a password.</p>
          <ErrorNote message={err} />
          <div className="row">
            <button className="btn" onClick={() => { setErr(null); setStep(2); }} disabled={busy}>Back</button>
            <button className="btn primary" disabled={busy} onClick={() => run(async () => {
              const ch = await api.registerOptions({ code, handle, displayName: displayName.trim() });
              const response = await startRegistration({ optionsJSON: ch.options as any });
              const res = await api.registerVerify({ challengeId: ch.challengeId, response });
              setRecovery(res.recoveryCode); setStep(4);
            })}>Create passkey</button>
          </div>
        </div>
      )}
    </div>
  );
}
