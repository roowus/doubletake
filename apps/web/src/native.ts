import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { api, getToken } from './api';
import { navigate } from './router';

/**
 * Native (Capacitor) glue. Everything here is a no-op on the plain web build, where the PWA
 * is served by the Doubletake server itself and same-origin URLs just work.
 *
 * On Android the WebView loads the bundled PWA from `https://localhost` (iOS:
 * `capacitor://localhost`), so:
 * - the server URL is stored at pairing time and prefixed onto every API call (`apiBase`);
 * - the device token and server URL are mirrored into Capacitor Preferences, which is the
 *   `CapacitorStorage` SharedPreferences group that the native `ShareReceiverActivity` reads
 *   (on iOS `SceneDelegate` copies the same keys into the App Group for the Share Extension);
 * - push goes through FCM (`@capacitor/push-notifications`) instead of Web Push on Android;
 *   iOS has no push in v1 (ADR 0027).
 *
 * Keys mirror `apps/mobile/android/.../Pairing.kt` and `apps/mobile/ios/.../Pairing.swift`.
 */
export const KEY_SERVER_URL = 'doubletake.serverUrl';
export const KEY_TOKEN = 'doubletake.token';
export const KEY_PENDING_SHARE = 'doubletake.pendingShare';
const KEY_FCM_TOKEN = 'doubletake.fcmToken';
const CHANNEL_ID = 'doubletake';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): string {
  return Capacitor.getPlatform();
}

/** Server origin used by API calls on native; empty on the web (same origin). */
export function apiBase(): string {
  if (!isNative()) return '';
  return (localStorage.getItem(KEY_SERVER_URL) ?? '').replace(/\/+$/, '');
}

export function setServerUrl(url: string | null): void {
  if (!isNative()) return;
  const clean = url?.trim().replace(/\/+$/, '') ?? '';
  if (clean) localStorage.setItem(KEY_SERVER_URL, clean);
  else localStorage.removeItem(KEY_SERVER_URL);
  void (clean
    ? Preferences.set({ key: KEY_SERVER_URL, value: clean })
    : Preferences.remove({ key: KEY_SERVER_URL }));
}

/** Mirror the device token for the native share sheet (called from `setToken`). */
export function mirrorToken(token: string | null): void {
  if (!isNative()) return;
  void (token
    ? Preferences.set({ key: KEY_TOKEN, value: token })
    : Preferences.remove({ key: KEY_TOKEN }));
}

/** Normalise a typed or scanned pairing input: accepts `https://host/?code=X` or `{url, code}`. */
export function parsePairingInput(raw: string): { url?: string; code?: string } {
  const s = raw.trim();
  if (!s) return {};
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as { url?: string; code?: string };
      return { ...(j.url ? { url: j.url } : {}), ...(j.code ? { code: j.code } : {}) };
    } catch {
      return {};
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const code = u.searchParams.get('code');
      return { url: u.origin, ...(code ? { code } : {}) };
    } catch {
      return {};
    }
  }
  return { code: s.toUpperCase() };
}

export interface PendingShare {
  url?: string;
  text?: string;
  title?: string;
}

/** A share stashed by `ShareReceiverActivity` while the device was unpaired. Consumed once. */
export async function takePendingShare(): Promise<PendingShare | null> {
  if (!isNative()) return null;
  const { value } = await Preferences.get({ key: KEY_PENDING_SHARE });
  if (!value) return null;
  await Preferences.remove({ key: KEY_PENDING_SHARE });
  try {
    return JSON.parse(value) as PendingShare;
  } catch {
    return null;
  }
}

/** The channel a native share sheet records: `android_share` or `ios_share` by platform. */
export type NativeShareChannel = 'android_share' | 'ios_share';

export function nativeShareChannel(platform: string = nativePlatform()): NativeShareChannel {
  return platform === 'ios' ? 'ios_share' : 'android_share';
}

export function pendingShareToPath(
  s: PendingShare,
  channel: NativeShareChannel = nativeShareChannel(),
): string {
  const q = new URLSearchParams();
  if (s.url) q.set('url', s.url);
  if (s.text) q.set('text', s.text);
  if (s.title) q.set('title', s.title);
  q.set('channel', channel);
  return `/share?${q.toString()}`;
}

// ---- push (FCM) ----

let listenersInstalled = false;

/** Route notification taps to the chat. Idempotent. */
export function installNativeListeners(): void {
  if (!isNative() || listenersInstalled) return;
  listenersInstalled = true;
  void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action.notification.data ?? {}) as { url?: string; chatId?: string };
    navigate(targetPath(data));
  });
  void PushNotifications.addListener('registration', (t) => {
    onFcmToken(t.value).then(
      () => settleRegistration(null),
      (e) => settleRegistration(e instanceof Error ? e : new Error(String(e))),
    );
  });
  void PushNotifications.addListener('registrationError', (e) => {
    console.warn('FCM registration failed', e);
    settleRegistration(new Error(fcmErrorMessage(e)));
  });
  // Cold start from a notification and resumes both land here; pending shares are handled by App.
  void CapApp.addListener('appUrlOpen', (ev) => {
    try {
      const u = new URL(ev.url);
      navigate(u.pathname + u.search);
    } catch {
      /* ignore */
    }
  });
}

/** `/chat/<id>` from a push payload; the server sends an absolute `url` we only keep the path of. */
export function targetPath(data: { url?: string; chatId?: string }): string {
  if (data.chatId) return `/chat/${data.chatId}`;
  if (data.url) {
    try {
      const u = new URL(data.url, 'https://localhost');
      return u.pathname + u.search;
    } catch {
      /* fall through */
    }
  }
  return '/';
}

async function onFcmToken(token: string): Promise<void> {
  if (!getToken()) return;
  const prev = localStorage.getItem(KEY_FCM_TOKEN);
  if (prev && prev !== token) await api.pushUnsubscribe(prev).catch(() => {});
  await api.pushSubscribe({ kind: 'fcm', endpoint: token });
  localStorage.setItem(KEY_FCM_TOKEN, token);
}

/** Resolves the `enableNativePush` caller once the FCM token is known and posted, or fails. */
let pendingRegistration: { resolve: () => void; reject: (e: Error) => void } | null = null;

function settleRegistration(err: Error | null): void {
  const p = pendingRegistration;
  pendingRegistration = null;
  if (!p) return;
  if (err) p.reject(err);
  else p.resolve();
}

/** Turn the plugin's `registrationError` payload into something a person can act on. */
export function fcmErrorMessage(e: unknown): string {
  const raw = String((e as { error?: unknown })?.error ?? e ?? '');
  if (/SERVICE_NOT_AVAILABLE|Installations Service is unavailable/i.test(raw))
    return 'Google Play services could not reach Firebase (SERVICE_NOT_AVAILABLE). Check that the phone resolves DNS and can reach googleapis.com, then try again.';
  if (/MISSING_INSTANCEID_SERVICE|Google Play services/i.test(raw))
    return 'Google Play services are missing or outdated on this device; FCM needs them.';
  if (/google-services|FirebaseApp|Default FirebaseApp is not initialized/i.test(raw))
    return 'This build has no Firebase config (google-services.json); rebuild the APK with it.';
  return `FCM registration failed: ${raw || 'unknown error'}`;
}

/**
 * Ask for permission, create the channel the server targets, register with FCM and wait until
 * the token has been posted to the server. Rejects with a readable message when Firebase or the
 * server refuse, so the UI never claims "enabled" for a device the server cannot reach.
 */
export async function enableNativePush(timeoutMs = 30_000): Promise<void> {
  installNativeListeners();
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') throw new Error('Notification permission was not granted.');
  await PushNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Doubletake',
    description: 'Research answers are ready',
    importance: 4,
    visibility: 1,
  });
  const done = new Promise<void>((resolve, reject) => {
    pendingRegistration = { resolve, reject };
  });
  const timer = setTimeout(
    () =>
      settleRegistration(
        new Error(`FCM did not return a registration token within ${timeoutMs / 1000}s.`),
      ),
    timeoutMs,
  );
  try {
    await PushNotifications.register();
    await done;
  } finally {
    clearTimeout(timer);
    pendingRegistration = null;
  }
}

export async function disableNativePush(): Promise<void> {
  const prev = localStorage.getItem(KEY_FCM_TOKEN);
  if (prev) await api.pushUnsubscribe(prev).catch(() => {});
  localStorage.removeItem(KEY_FCM_TOKEN);
  await PushNotifications.unregister().catch(() => {});
}

/** Whether the server knows this device's FCM token. */
export async function nativePushEnabled(): Promise<boolean> {
  const t = localStorage.getItem(KEY_FCM_TOKEN);
  if (!t) return false;
  const known = await api.pushSubscriptions().catch(() => []);
  return known.some((s) => s.endpoint === t);
}
