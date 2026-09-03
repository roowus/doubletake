import type { Config } from '../config/index.js';
import type { Repo } from '../db/repo.js';
import { FcmNotifier, loadServiceAccount } from './fcm.js';
import { NotificationHub } from './hub.js';
import type { Notifier } from './types.js';
import { generateVapidKeys, type VapidKeys, WebPushNotifier } from './webpush.js';

export { FcmNotifier } from './fcm.js';
export { NotificationHub } from './hub.js';
export type { Notification, Notifier, PushTarget, SendOutcome } from './types.js';
export { generateVapidKeys, WebPushNotifier } from './webpush.js';

const VAPID_SETTING = 'vapid_keys';

/**
 * VAPID keys come from the environment when set; otherwise they are generated once and kept in
 * the `settings` table so browser subscriptions survive restarts (ADR 0016).
 */
export function resolveVapid(cfg: Config, repo: Repo): VapidKeys {
  if (cfg.vapidPublicKey && cfg.vapidPrivateKey)
    return {
      publicKey: cfg.vapidPublicKey,
      privateKey: cfg.vapidPrivateKey,
      subject: cfg.vapidSubject,
    };
  const stored = repo.getSetting(VAPID_SETTING);
  if (stored) {
    const k = JSON.parse(stored) as { publicKey: string; privateKey: string };
    return { ...k, subject: cfg.vapidSubject };
  }
  const fresh = generateVapidKeys(cfg.vapidSubject);
  repo.setSetting(
    VAPID_SETTING,
    JSON.stringify({ publicKey: fresh.publicKey, privateKey: fresh.privateKey }),
  );
  return fresh;
}

export function createHub(
  cfg: Config,
  repo: Repo,
  log: { warn: (msg: string) => void } = console,
): { hub: NotificationHub; vapid: VapidKeys } {
  const vapid = resolveVapid(cfg, repo);
  const notifiers: Notifier[] = [new WebPushNotifier(vapid)];
  if (cfg.fcmServiceAccountPath) {
    try {
      notifiers.push(new FcmNotifier(loadServiceAccount(cfg.fcmServiceAccountPath)));
    } catch (e) {
      log.warn(`FCM disabled: ${(e as Error).message}`);
    }
  }
  return { hub: new NotificationHub(repo, notifiers, log), vapid };
}
