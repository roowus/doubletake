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

/**
 * Where the app signs in on a phone unless the owner says otherwise. Every install is hosted
 * (accounts at doubletake.gg) by default; "Use my own server" stores a URL with
 * [setServerUrl] and switches to the self-hosted pairing flow.
 *
 * The native shell reads the same constant (`ShareReceiverActivity.HOSTED_URL` in
 * `apps/mobile/android/.../ShareReceiverActivity.kt`); keep the two in step.
 */
export const HOSTED_URL = 'https://doubletake.gg';

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): string {
  return Capacitor.getPlatform();
}

/**
 * Server origin used by API calls on native; empty on the web (same origin). An empty answer
 * means hosted — the app is talking to the service the bundle's login page was served from.
 */
export function apiBase(): string {
  if (!isNative()) return '';
  return (localStorage.getItem(KEY_SERVER_URL) ?? '').replace(/\/+$/, '');
}

/**
 * Explicit choice: a self-hosted origin, or null for "the hosted service". Choosing a server is
 * also what ends hosted mode for the share sheet — `doubletake.hosted` is cleared here, so a
 * device that leaves the hosted sign-in for its own notebook posts to that notebook.
 */
export function setServerUrl(url: string | null): void {
  if (!isNative()) return;
  const clean = url?.trim().replace(/\/+$/, '') ?? '';
  if (clean) localStorage.setItem(KEY_SERVER_URL, clean);
  else localStorage.removeItem(KEY_SERVER_URL);
  void mirrorPreferences(KEY_SERVER_URL, clean);
  if (clean) void mirrorPreferences(KEY_HOSTED, null);
}

/**
 * What the native share sheet reads for the session this WebView holds — the same three cases
 * the app can be in, decided here because the Kotlin side is native code that cannot import
 * this module (it reads the keys and applies the same rule in `ShareReceiverActivity`).
 *
 * - `hosted`: the origin the app signed in at (`doubletake.hosted`), empty when self-hosted;
 * - `serverUrl`: the self-hosted origin, empty on hosted;
 * - `token`: whichever of the two sessions is live.
 */
export function sessionPrefs(o: {
  hostedOrigin?: string | undefined;
  serverUrl?: string | null | undefined;
  token?: string | null | undefined;
}): Array<{ key: string; value: string }> {
  return [
    { key: KEY_HOSTED, value: (o.hostedOrigin ?? '').replace(/\/+$/, '') },
    { key: KEY_SERVER_URL, value: (o.serverUrl ?? '').replace(/\/+$/, '') },
    {
      key: o.token?.startsWith(HOSTED_TOKEN_PREFIX) ? KEY_HOSTED_TOKEN : KEY_TOKEN,
      value: o.token ?? '',
    },
  ];
}

/** Write the share sheet's copy of this session. Inert on the web (native only). */
export function mirrorPreferences(
  key: string,
  value: string | null | Array<{ key: string; value: string }>,
): Promise<void> {
  if (!isNative()) return Promise.resolve();
  if (typeof value === 'string')
    return value
      ? Preferences.set({ key, value }).then(
          () => undefined,
          () => undefined,
        )
      : Preferences.remove({ key }).then(
          () => undefined,
          () => undefined,
        );
  if (value === null)
    return Preferences.remove({ key }).then(
      () => undefined,
      () => undefined,
    );
  return Promise.all(value.map((p) => mirrorPreferences(p.key, p.value))).then(() => undefined);
}

/**
 * Mirror the session token for the native share sheet (called from `setToken`, including its
 * sign-out call with `null`). Hosted sessions (`dth_…`) keep their own key so a hosted sign-in
 * does not disturb a paired self-hosted server — and a sign-out clears both, so a queued share
 * can never be posted with a token the owner just revoked.
 *
 * Nothing here is awaited: the share sheet copies the keys into its own storage on first use,
 * and awaiting would put a plugin round trip on the sign-in path.
 */
export function mirrorToken(token: string | null): void {
  if (!isNative()) return;
  if (token === null) {
    void mirrorPreferences(KEY_HOSTED_TOKEN, null);
    void mirrorPreferences(KEY_TOKEN, null);
    return;
  }
  void mirrorPreferences(
    token.startsWith(HOSTED_TOKEN_PREFIX) ? KEY_HOSTED_TOKEN : KEY_TOKEN,
    token,
  );
}

const HOSTED_TOKEN_PREFIX = 'dth_';
/** Mirror of `Pairing.KEY_HOSTED` in the native shell. */
const KEY_HOSTED = 'doubletake.hosted';
const KEY_HOSTED_TOKEN = 'doubletake.hostedToken';

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

/**
 * Where the app should sign in on a phone. The bundled copy of the PWA is the sign-in UI for
 * the hosted service and nothing else: a hosted account cannot be created on it (the forms and
 * the Google round trip live in the service's own shell, served from `HOSTED_URL`), so the
 * WebView is pointed at the hosted page instead of rendering a second-rate login.
 *
 * `currentOrigin` is the origin of the page the WebView is showing — inside Capacitor that is
 * the local bundle (`https://localhost` / `capacitor://localhost`), never a real site. When it
 * is already somewhere else (an override, a dev build pointed at a server) it is left alone.
 */
export function nativeEntryUrl(currentOrigin: string, stored: string | null): string {
  const clean = (stored ?? '').replace(/\/+$/, '');
  if (clean && sameOrigin(clean, currentOrigin)) return clean;
  if (isLocalBundleOrigin(currentOrigin)) return HOSTED_URL;
  return currentOrigin.replace(/\/+$/, '');
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The origin Capacitor serves the bundled files from; never a site the owner chose. */
export function isLocalBundleOrigin(origin: string): boolean {
  return /^(https?:\/\/localhost|capacitor:\/\/localhost)$/i.test(origin.replace(/\/+$/, ''));
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

/**
 * Re-post this device's FCM token after (re)pairing. Registration otherwise happens only from
 * the Settings toggle, so a device that was revoked and paired again (or an Android < 13
 * install, where notification permission is implicit) would silently receive nothing. Runs only
 * when permission is already granted; never prompts. Failures are logged, not surfaced.
 */
export async function resumeNativePush(): Promise<boolean> {
  if (!isNative() || !getToken()) return false;
  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') return false;
    installNativeListeners();
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Doubletake',
      description: 'Research answers are ready',
      importance: 4,
      visibility: 1,
    });
    // The `registration` listener posts the token to the server (`onFcmToken`).
    await PushNotifications.register();
    return true;
  } catch (e) {
    console.warn('FCM re-registration skipped', e);
    return false;
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
