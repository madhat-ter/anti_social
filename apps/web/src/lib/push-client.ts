/**
 * Web Push on this device, shared by Settings (PushToggle) and the feed's ask card (PushAsk,
 * RFC §10.31). Browsers show their "Allow notifications?" box only after a tap, and a "Block" there
 * can never be asked again, so nothing here runs on its own: `turnOnPush` is called from a click.
 */
import { api } from '@/lib/api';

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** This browser can do Web Push at all (iPhone Safari can only from the Home Screen). */
export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** An iPhone or iPad (iPadOS reports itself as a Mac with a touch screen). */
export const isIos = () =>
  typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Opened from the Home Screen, as an app (not in a browser tab). */
export const isStandalone = () =>
  typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** The server's public key, or null when push is off on the server. */
export async function pushKey(): Promise<string | null> {
  const cfg = await api.pushConfig().catch(() => null);
  return cfg?.enabled && cfg.publicKey ? cfg.publicKey : null;
}

/** Is this device already subscribed? */
export async function pushIsOn(): Promise<boolean> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return !!(await reg?.pushManager.getSubscription());
}

/**
 * Asks the browser (from a tap), then subscribes this device and tells the server.
 * Returns what the person chose: 'granted' (now on), 'denied' (blocked for good), 'default' (closed the box).
 */
export async function turnOnPush(key: string): Promise<NotificationPermission> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const j = sub.toJSON();
  await api.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh!, auth: j.keys!.auth! } });
  return 'granted';
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}
