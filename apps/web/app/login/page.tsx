'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote } from '@/components/ui';
import { Win } from '@/components/retro';

/** A 1-bit key, drawn to match the alert icon. */
function KeyIcon() {
  return (
    <svg viewBox="0 0 32 32" width={34} height={34} aria-hidden="true" className="alert-icon">
      <circle cx="10" cy="16" r="6.5" fill="var(--paper)" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="10" cy="16" r="2" fill="currentColor" />
      <path d="M16.5 16 H29 M24 16 V21 M28 16 V20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" fill="none" />
    </svg>
  );
}

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true); setErr(null);
    try {
      const ch = await api.loginOptions();
      const response = await startAuthentication({ optionsJSON: ch.options as any });
      await api.loginVerify({ challengeId: ch.challengeId, response });
      router.push('/'); router.refresh();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <h1>Sign in</h1>
      <Win title="sign_in" bodyClassName="stack">
        <div className="dlg-body">
          <KeyIcon />
          <div className="stack dlg-main">
            <p className="dlg-msg">Your passkey is saved on your device. No handle, no password: just unlock it.</p>
            <ErrorNote message={err} />
            <div className="row dlg-actions">
              <button className="btn default" onClick={signIn} disabled={busy}>{busy ? 'Waiting for your device…' : 'Sign in with passkey'}</button>
            </div>
          </div>
        </div>
      </Win>
      <p className="muted">Lost your device? <Link href="/recover">Use your recovery code</Link>. Not a member yet? <Link href="/join">Join with an invite</Link>.</p>
    </div>
  );
}
