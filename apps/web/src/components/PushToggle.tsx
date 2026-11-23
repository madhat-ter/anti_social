'use client';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { isIos, pushIsOn, pushKey, pushSupported, turnOffPush, turnOnPush } from '@/lib/push-client';
import { ErrorNote } from './ui';

type State = 'loading' | 'unsupported' | 'disabled-server' | 'denied' | 'off' | 'on';

/** "Notifications on this device": Web Push subscribe/unsubscribe for the current browser. */
export function PushToggle() {
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) { setState('unsupported'); return; }
      const k = await pushKey();
      if (!k) { setState('disabled-server'); return; }
      setKey(k);
      if (Notification.permission === 'denied') { setState('denied'); return; }
      setState((await pushIsOn()) ? 'on' : 'off');
    })().catch((e) => { setErr(errorMessage(e)); setState('off'); });
  }, []);

  async function enable() {
    if (!key) return;
    setBusy(true); setErr(null);
    try {
      const perm = await turnOnPush(key);
      setState(perm === 'granted' ? 'on' : perm === 'denied' ? 'denied' : 'off');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setErr(null);
    try {
      await turnOffPush();
      setState('off');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-sec" aria-labelledby="push">
      <h2 id="push">Notifications on this device</h2>
      {state === 'loading' && <p className="muted">Checking...</p>}
      {state === 'unsupported' && (
        <p className="muted">
          {isIos()
            ? 'On iPhone, notifications work once anti is on your Home Screen: tap Share, then Add to Home Screen, open anti from there, and turn them on here.'
            : 'This browser does not support push notifications.'}
        </p>
      )}
      {state === 'disabled-server' && <p className="muted">Push notifications are not switched on for this server yet.</p>}
      {state === 'denied' && <p className="muted">Notifications are blocked for this site in your browser settings.</p>}
      {(state === 'off' || state === 'on') && (
        <>
          <p className="muted">Replies, mentions, invites and event changes. Likes stay in the app.</p>
          <div className="row">
            {state === 'off'
              ? <button className="btn primary" onClick={enable} disabled={busy}>Turn on</button>
              : <><span>On for this device.</span><button className="btn" onClick={disable} disabled={busy}>Turn off</button></>}
          </div>
        </>
      )}
      <ErrorNote message={err} />
    </section>
  );
}
