'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { validateHandle, DISPLAY_NAME_MAX } from '@anti/shared';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote, RecoveryCodeStep } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Win } from '@/components/retro';

const STEPS = ['Invite code', 'Your handle', 'Passkey'] as const;

function Steps({ at }: { at: number }) {
  return (
    <ol className="steps" aria-label={`Step ${at} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i + 1 === at ? 'on' : i + 1 < at ? 'done' : undefined} aria-current={i + 1 === at ? 'step' : undefined}>
          <span className="steps-n">{i + 1}</span><span className="steps-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}

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

  const previewSeed = handle.trim() && !validateHandle(handle.trim()) ? handle.trim() : null;

  return (
    <div className="stack">
      <h1>Join</h1>
      <Win title="join.app" bodyClassName="stack">
        <Steps at={step} />

        {step === 1 && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => {
            const r = await api.checkInvite(code);
            if (!r.valid) throw Object.assign(new Error('That invite code is not valid, or has already been used.'), { name: 'Invalid' });
            setWouldWaitlist(r.wouldWaitlist); setStep(2);
          }); }}>
            <p>Someone already inside sent you a code. It works once and expires after a week.</p>
            <label>Invite code
              <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} required />
            </label>
            <ErrorNote message={err} />
            <div className="row between">
              <p className="muted">Already a member? <Link href="/login">Sign in</Link></p>
              <button className="btn primary" disabled={busy || !code.trim()}>Check code</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form className="stack" onSubmit={(e) => { e.preventDefault();
            const v = validateHandle(handle);
            if (v) { setErr(v); return; }
            if (!displayName.trim()) { setErr('Choose a display name.'); return; }
            setErr(null); setStep(3);
          }}>
            {wouldWaitlist
              ? <p className="banner">All seats are taken. You will join the waitlist and get a seat when one opens.</p>
              : <p>A seat is free. It is yours once you create a passkey.</p>}
            <div className="you">
              <div className="you-face">
                <Avatar seed={previewSeed} size={104} label={previewSeed ? `Your face, made from @${previewSeed}` : 'No handle yet'} />
                <p className="ui muted">{previewSeed ? 'This is you.' : 'Type a handle to meet your face.'}</p>
              </div>
              <div className="stack grow">
                <label>Handle
                  <input value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required aria-describedby="handle-help" />
                </label>
                <p id="handle-help" className="muted small">3 to 20 letters, numbers or underscores. You can never change it, and your face is drawn from it.</p>
                <label>Display name
                  <input value={displayName} maxLength={DISPLAY_NAME_MAX} onChange={(e) => setDisplayName(e.target.value)} required />
                </label>
              </div>
            </div>
            <ErrorNote message={err} />
            <div className="row between">
              <button type="button" className="btn" onClick={() => { setErr(null); setStep(1); }}>Back</button>
              <button className="btn primary">Continue</button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="stack">
            <div className="you">
              <div className="you-face"><Avatar seed={handle} size={104} /></div>
              <div className="stack grow">
                <p><strong>{displayName}</strong> <span className="ui muted">@{handle}</span></p>
                <p>Create a passkey to finish. Your device will ask for your fingerprint, face or PIN. There is no password, and no email.</p>
              </div>
            </div>
            <ErrorNote message={err} />
            <div className="row between">
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
      </Win>
    </div>
  );
}
