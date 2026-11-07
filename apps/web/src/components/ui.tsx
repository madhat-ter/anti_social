'use client';
import { useState } from 'react';
import { AlertIcon, Win } from './retro';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch { /* clipboard unavailable */ }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}

/** Shows a one-time secret with copy button and required acknowledgement. */
export function RecoveryCodeStep({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack">
      <h1>Save your recovery code</h1>
      <Win title="recovery_code.txt" bodyClassName="stack">
        <div className="dlg-body">
          <AlertIcon />
          <p>This is the only way back in if you lose every passkey. It is shown once. Write it down or put it in a password manager.</p>
        </div>
        <p className="code" aria-label="Recovery code">{code}</p>
        <div className="row between">
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I saved it somewhere safe
          </label>
          <div className="row">
            <CopyButton text={code} />
            <button className="btn primary" disabled={!saved} onClick={onDone}>Continue</button>
          </div>
        </div>
      </Win>
    </div>
  );
}
