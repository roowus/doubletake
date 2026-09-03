import webpush, { WebPushError } from 'web-push';
import type { Notification, Notifier, PushTarget, SendOutcome } from './types.js';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function generateVapidKeys(subject: string): VapidKeys {
  const k = webpush.generateVAPIDKeys();
  return { publicKey: k.publicKey, privateKey: k.privateKey, subject };
}

/** Web Push (RFC 8030 + VAPID) for the installed PWA on desktop and Android Chrome. */
export class WebPushNotifier implements Notifier {
  readonly kind = 'webpush' as const;
  constructor(private readonly vapid: VapidKeys) {}

  async send(target: PushTarget, n: Notification): Promise<SendOutcome> {
    if (!target.keys) return { status: 'gone' };
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: target.keys },
        JSON.stringify(n),
        {
          TTL: 6 * 3600,
          urgency: 'normal',
          vapidDetails: {
            subject: this.vapid.subject,
            publicKey: this.vapid.publicKey,
            privateKey: this.vapid.privateKey,
          },
        },
      );
      return { status: 'ok' };
    } catch (e) {
      if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410))
        return { status: 'gone' };
      return { status: 'failed', error: (e as Error).message };
    }
  }
}
