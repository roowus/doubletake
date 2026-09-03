import { api } from './api';

/** Push support for this browser: Notification + PushManager + a registered service worker. */
export function pushSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function b64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesToB64(buf: ArrayBuffer | null): string {
  return buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : '';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
}

/** Current browser subscription, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return (await registration()).pushManager.getSubscription();
}

/**
 * Ask for permission, subscribe with the server's VAPID key and register the endpoint.
 * A key change on the server (new instance, restored DB) invalidates the old subscription,
 * so we resubscribe when the applicationServerKey differs.
 */
export async function enablePush(vapidPublicKey: string): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await registration();
  const key = b64ToBytes(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const have = sub.options.applicationServerKey;
    const same = have && bytesToB64(have) === bytesToB64(key.buffer);
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub)
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth)
    throw new Error('Browser returned an incomplete subscription.');
  await api.pushSubscribe({
    kind: 'webpush',
    endpoint: j.endpoint,
    keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
  });
  return sub;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.pushUnsubscribe(endpoint).catch(() => {});
}

/** Whether the server knows this browser's subscription (i.e. push is fully enabled). */
export async function pushEnabled(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub || Notification.permission !== 'granted') return false;
  const known = await api.pushSubscriptions().catch(() => []);
  return known.some((s) => s.endpoint === sub.endpoint);
}
