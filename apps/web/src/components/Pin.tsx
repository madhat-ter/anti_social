'use client';
/**
 * RFC §10.13: the 6-digit PIN. One field (paste and password managers work), the number keypad on
 * phones, dots with a "show" toggle. `ChoosePin` is the form for choosing or changing one;
 * `PinGate` stands in front of the app for members who joined with a passkey and have no PIN yet.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { PIN_LENGTH, PIN_RULES, pinProblem } from '@anti/shared';
import { api, ApiError, errorMessage, type Me } from '@/lib/api';
import { ErrorNote } from './ui';
import { Win } from './retro';

export function PinField({ label, value, onChange, autoComplete, autoFocus, onComplete, describedBy }: {
  label: string; value: string; onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password'; autoFocus?: boolean;
  /** called when the sixth digit is typed (sign-in submits there) */
  onComplete?: (v: string) => void; describedBy?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="pin-field">
      <label htmlFor={id}>{label}</label>
      <span className="pin-row">
        <input
          id={id} className="pin-input" type={show ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]*"
          maxLength={PIN_LENGTH} minLength={PIN_LENGTH} autoComplete={autoComplete} autoFocus={autoFocus} required
          value={value} aria-describedby={describedBy} spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
            onChange(v);
            if (v.length === PIN_LENGTH && v !== value) onComplete?.(v);
          }}
        />
        <button type="button" className="btn pin-show" aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
      </span>
    </div>
  );
}

/** What a failed PIN request means, in words (a rest ends at a time on the viewer's clock). */
export function pinError(e: unknown): string {
  if (e instanceof ApiError && e.error === 'pin_resting') {
    const at = e.detail?.match(/\d{4}-\d\d-\d\dT[\d:.]+Z/)?.[0];
    const time = at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'a little later';
    return `This account is resting until ${time}. Too many wrong PINs.`;
  }
  return errorMessage(e);
}

export const PIN_RULE_LINE = `After ${PIN_RULES.triesBeforeRest} wrong tries, the account rests for ${PIN_RULES.restMinutes} minutes.`;

/**
 * Choosing (or changing) a PIN: the new one twice, and the current one when `needCurrent`.
 * `submit` does the saving (the join form posts it with the invite; Settings calls /me/pin).
 */
export function ChoosePin({ needCurrent, birthday, submitLabel, submit, children }: {
  needCurrent?: boolean; birthday?: string | null; submitLabel: string;
  submit: (pin: string, current?: string) => Promise<void>;
  /** a Back or Cancel button, drawn on the left of the main one */
  children?: ReactNode;
}) {
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const helpId = useId();
  async function go(e: FormEvent) {
    e.preventDefault();
    const p = pinProblem(pin, birthday);
    if (p) { setErr(p); return; }
    if (pin !== again) { setErr('The two PINs are not the same.'); return; }
    setBusy(true); setErr(null);
    try { await submit(pin, needCurrent ? current : undefined); }
    catch (x) { setErr(pinError(x)); }
    finally { setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={go}>
      {needCurrent && <PinField label="Current PIN" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />}
      <PinField label="New PIN" value={pin} onChange={setPin} autoComplete="new-password" autoFocus={!needCurrent} describedBy={helpId} />
      <PinField label="The same PIN again" value={again} onChange={setAgain} autoComplete="new-password" />
      <p id={helpId} className="muted small">Six digits you will remember and nobody would guess: not 123456, not your birthday.</p>
      <ErrorNote message={err} />
      {/* `children`: a Back or Cancel button, beside the main one */}
      <div className={children ? 'row between' : 'row'}>
        {children}
        <button className="btn primary" disabled={busy || pin.length < PIN_LENGTH || again.length < PIN_LENGTH || (needCurrent && current.length < PIN_LENGTH)}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Members who joined with a passkey choose a PIN once, before anything else (RFC §10.13). */
export function PinGate({ me }: { me: Me }) {
  return (
    <div className="stack pin-gate">
      <h1>Choose a PIN</h1>
      <Win title="pin.txt" bodyClassName="stack">
        <p>
          Anti now signs you in with your handle, <strong>@{me.handle}</strong>, and a 6-digit PIN. Choose yours once and you
          are done. Your passkey keeps working too, if you like it.
        </p>
        <ChoosePin birthday={me.birthday} submitLabel="Save my PIN" submit={async (pin) => {
          await api.setPin(pin);
          window.location.reload();
        }} />
      </Win>
    </div>
  );
}
