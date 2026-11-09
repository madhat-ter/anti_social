'use client';
import { useTitle } from '@/lib/hooks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage, type Me } from '@/lib/api';
import { ErrorNote } from '@/components/ui';
import { Win } from '@/components/retro';
import { ChoosePin, PIN_RULE_LINE, PinField, pinError } from '@/components/Pin';

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

/** RFC §10.13: your handle and your 6-digit PIN. A passkey still works for anyone who keeps one. */
export default function Login() {
  useTitle('Sign in');
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** signed in with a passkey but no PIN yet: choose one here, once */
  const [needPin, setNeedPin] = useState<Me | null>(null);
  const sent = useRef('');

  const home = () => { router.push('/'); router.refresh(); };

  async function signIn(h = handle, p = pin) {
    if (busy || !h.trim() || p.length < 6 || sent.current === `${h}|${p}`) return;
    sent.current = `${h}|${p}`;
    setBusy(true); setErr(null);
    try {
      await api.pinLogin({ handle: h.trim(), pin: p });
      home();
    } catch (e) { setErr(pinError(e)); setPin(''); sent.current = ''; } finally { setBusy(false); }
  }

  async function passkey() {
    setBusy(true); setErr(null);
    try {
      const ch = await api.loginOptions();
      const response = await startAuthentication({ optionsJSON: ch.options as any });
      await api.loginVerify({ challengeId: ch.challengeId, response });
      const me = await api.me();
      if (me && me.pinSet === false) setNeedPin(me); else home();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (needPin) {
    return (
      <div className="stack">
        <h1>Choose a PIN</h1>
        <Win title="pin.txt" bodyClassName="stack">
          <p>From now on you sign in with your handle, <strong>@{needPin.handle}</strong>, and a 6-digit PIN. Choose it once.</p>
          <ChoosePin birthday={needPin.birthday} submitLabel="Save my PIN" submit={async (p) => { await api.setPin(p); home(); }} />
        </Win>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Sign in</h1>
      <Win title="sign_in" bodyClassName="stack">
        <form className="dlg-body" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
          <KeyIcon />
          <div className="stack dlg-main">
            <label>Handle
              <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="@yourhandle" autoFocus />
            </label>
            <PinField label="PIN" value={pin} onChange={setPin} autoComplete="current-password" onComplete={(v) => void signIn(handle, v)} />
            <p className="muted small">{PIN_RULE_LINE}</p>
            <ErrorNote message={err} />
            <div className="row dlg-actions">
              <button className="btn default" disabled={busy || !handle.trim() || pin.length < 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </div>
          </div>
        </form>
      </Win>
      <p className="muted">
        <Link href="/recover">Forgot your PIN?</Link>
        {' · '}<button type="button" className="linklike" onClick={() => void passkey()} disabled={busy}>Use a passkey</button>
        {' · '}Not a member yet? <Link href="/join">Join with an invite</Link>.
      </p>
    </div>
  );
}
