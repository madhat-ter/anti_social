'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

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
      <div className="card stack">
        <button className="btn primary" onClick={signIn} disabled={busy}>Sign in with passkey</button>
        <ErrorNote message={err} />
        <p className="muted">Lost your passkey? <Link href="/recover">Use your recovery code</Link>. No account? <Link href="/join">Join with an invite</Link>.</p>
      </div>
    </div>
  );
}
