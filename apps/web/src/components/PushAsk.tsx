'use client';
/**
 * RFC §10.31: the feed asks a member, once in a while, to turn notifications on for this device.
 * A card of our own first ("soft ask"); the browser's Allow box appears only after "Turn on" is
 * tapped, since browsers hide or refuse a box that pops up by itself, and a "Block" is forever.
 *
 * The owner's rules: a card in the feed; not on the first day a device is seen, from the next day
 * it comes back; "Not now" asks again in 2 weeks, 3 times at most, then only Settings; on an iPhone
 * in Safari (where push needs the Home Screen) the card gives the steps instead of the button.
 * Everything is remembered per device (push itself is per device), in localStorage.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { isIos, isStandalone, pushIsOn, pushKey, pushSupported, turnOnPush } from '@/lib/push-client';
import { Win } from './retro';
import { ErrorNote } from './ui';

const STORE = 'anti_push_ask';
const SNOOZE_DAYS = 14;
const MAX_NOT_NOW = 3;
type Memory = { first: string; notNow: number; next: number };

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD where the member is
function recall(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (m && typeof m.first === 'string') return { first: m.first, notNow: Number(m.notNow) || 0, next: Number(m.next) || 0 };
  } catch { /* fresh */ }
  const m = { first: today(), notNow: 0, next: 0 };
  localStorage.setItem(STORE, JSON.stringify(m));
  return m;
}
const remember = (m: Memory) => localStorage.setItem(STORE, JSON.stringify(m));

/** Should the card show now? Pure, so the rules can be read (and tested) in one place. */
export function askDue(m: Memory, day: string, now: number): boolean {
  return day !== m.first && m.notNow < MAX_NOT_NOW && now >= m.next;
}

export function PushAsk() {
  const [mode, setMode] = useState<'hidden' | 'ask' | 'iphone'>('hidden');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = recall();
      if (!askDue(m, today(), Date.now())) return;
      const k = await pushKey();
      if (!k || !alive) return;
      if (isIos() && !isStandalone()) { setMode('iphone'); return; }
      if (!pushSupported() || Notification.permission === 'denied') return;
      if (await pushIsOn()) return;
      if (!alive) return;
      setKey(k);
      setMode('ask');
    })().catch(() => {});
    return () => { alive = false; };
  }, []);

  function notNow() {
    const m = recall();
    remember({ ...m, notNow: m.notNow + 1, next: Date.now() + SNOOZE_DAYS * 86_400_000 });
    setMode('hidden');
  }

  async function turnOn() {
    if (!key) return;
    setBusy(true); setErr(null);
    try {
      const perm = await turnOnPush(key);
      if (perm === 'granted') setMode('hidden');
      // blocked in the browser's box: never ask on this device again (Settings explains how to undo)
      else if (perm === 'denied') { remember({ ...recall(), notNow: MAX_NOT_NOW }); setMode('hidden'); }
      else notNow(); // closed the box without choosing: same as "Not now"
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'hidden') return null;
  return (
    <Win title="notifications.txt" as="aside" className="push-ask" onClose={notNow} bodyClassName="stack">
      <p className="push-ask-h">Hear when someone answers</p>
      {mode === 'ask' ? (
        <>
          <p className="muted">Turn on notifications on this device for replies, mentions, invites and event changes. Likes stay quiet.</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={turnOn} disabled={busy}>Turn on</button>
            <button type="button" className="btn" onClick={notNow} disabled={busy}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">On iPhone, notifications work once anti is on your Home Screen:</p>
          <ol className="push-ask-steps">
            <li>Tap <b>Share</b> (the square with an arrow) in Safari.</li>
            <li>Tap <b>Add to Home Screen</b>.</li>
            <li>Open anti from your Home Screen, sign in, and tap <b>Turn on</b>.</li>
          </ol>
          <div className="row">
            <button type="button" className="btn" onClick={notNow}>Not now</button>
          </div>
        </>
      )}
      <p className="muted small">You can change this any time in <Link href="/settings#push">Settings</Link>.</p>
      <ErrorNote message={err} />
    </Win>
  );
}
