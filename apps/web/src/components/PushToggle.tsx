'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { ErrorNote } from './ui';

type State = 'loading' | 'unsupported' | 'disabled-server' | 'denied' | 'off' | 'on';

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** "Notifications on this device": Web Push subscribe/unsubscribe for the current browser. */
export function PushToggle() {
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState('unsupported'); return; }
      const cfg = await api.pushConfig().catch(() => null);
      if (!cfg?.enabled || !cfg.publicKey) { setState('disabled-server'); return; }
      setKey(cfg.publicKey);
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch((e) => { setErr(errorMessage(e)); setState('off'); });
  }, []);

  async function enable() {
    if (!key) return;
    setBusy(true); setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const j = sub.toJSON();
      await api.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh!, auth: j.keys!.auth! } });
      setState('on');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setErr(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setState('off');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="push">
      <h2 id="push">Notifications on this device</h2>
      {state === 'loading' && <p className="muted">Checking...</p>}
      {state === 'unsupported' && <p className="muted">This browser does not support push notifications. On iPhone, add anti to your Home Screen first.</p>}
      {state === 'disabled-server' && <p className="muted">Push notifications are not switched on for this server yet.</p>}
      {state === 'denied' && <p className="muted">Notifications are blocked for this site in your browser settings.</p>}
      {(state === 'off' || state === 'on') && (
        <>
          <p className="muted">Replies, seat changes and event updates. Likes stay in the app.</p>
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
