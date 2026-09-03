/**
 * Notifications carry only what the client needs to open the right chat. They transit third
 * parties (Google, browser push services), so they never include answer text (ADR 0008).
 */
export interface Notification {
  title: string;
  body: string;
  chatId: string;
  /** Absolute or root-relative URL the client opens on tap. */
  url: string;
  /** Collapses repeated notifications for the same chat on the device. */
  tag: string;
}

export interface PushTarget {
  id: string;
  deviceId: string;
  kind: string;
  /** Web Push endpoint URL or FCM registration token. */
  endpoint: string;
  /** Web Push `{ p256dh, auth }` keys; null for FCM. */
  keys: { p256dh: string; auth: string } | null;
}

/** `gone` means the subscription is dead and must be deleted; `failed` is transient. */
export type SendOutcome =
  | { status: 'ok' }
  | { status: 'gone' }
  | { status: 'failed'; error: string };

export interface Notifier {
  readonly kind: 'webpush' | 'fcm';
  send(target: PushTarget, n: Notification): Promise<SendOutcome>;
}
