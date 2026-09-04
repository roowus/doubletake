import type { Repo } from '../db/repo.js';
import type { Broadcaster } from './broadcast.js';
import type { Notification, Notifier, PushTarget } from './types.js';

/** Subscriptions that fail this many times in a row are dropped even without a 410. */
export const MAX_FAILED = 8;

export interface NotifyResult {
  sent: number;
  gone: number;
  failed: number;
  skipped: number;
  /** Owner channels (ntfy, Telegram) that accepted / rejected the notification. */
  broadcast: { sent: number; failed: number };
}

/**
 * Fans a notification out to every stored push subscription, using the notifier registered
 * for its kind. Dead subscriptions (410/404, or too many failures) are deleted; transient
 * failures bump `failed_count`. Owner-level broadcasters (ntfy, Telegram; ADR 0019) get every
 * notification too, unless the caller targets specific subscriptions. Never throws: a broken
 * push service must not fail the run.
 */
export class NotificationHub {
  private readonly notifiers = new Map<string, Notifier>();
  private readonly broadcasters: Broadcaster[];

  constructor(
    private readonly repo: Repo,
    notifiers: Notifier[],
    private readonly log: { warn: (msg: string) => void } = console,
    broadcasters: Broadcaster[] = [],
  ) {
    for (const n of notifiers) this.notifiers.set(n.kind, n);
    this.broadcasters = broadcasters;
  }

  has(kind: string): boolean {
    return this.notifiers.has(kind);
  }
  kinds(): string[] {
    return [...this.notifiers.keys()];
  }
  /** Configured owner channels, e.g. `['ntfy', 'telegram']`. */
  channels(): string[] {
    return this.broadcasters.map((b) => b.kind);
  }

  /** Sends to the owner channels only (Settings → "Send test" for channels). */
  async broadcast(n: Notification): Promise<{ sent: number; failed: number }> {
    const out = { sent: 0, failed: 0 };
    await Promise.all(
      this.broadcasters.map(async (b) => {
        const r = await b.send(n);
        if (r.status === 'ok') out.sent++;
        else {
          out.failed++;
          this.log.warn(`${b.kind} notification failed: ${r.error}`);
        }
      }),
    );
    return out;
  }

  async notify(
    n: Notification,
    opts: { excludeDeviceId?: string; onlySubscriptionIds?: Set<string> } = {},
  ): Promise<NotifyResult> {
    const result: NotifyResult = {
      sent: 0,
      gone: 0,
      failed: 0,
      skipped: 0,
      broadcast: { sent: 0, failed: 0 },
    };
    const subs = this.repo.listPushSubscriptions();
    const wide = opts.onlySubscriptionIds
      ? Promise.resolve(result.broadcast)
      : this.broadcast(n).then((b) => {
          result.broadcast = b;
          return b;
        });
    await Promise.all([
      wide,
      ...subs.map(async (sub) => {
        if (
          (opts.excludeDeviceId && sub.deviceId === opts.excludeDeviceId) ||
          (opts.onlySubscriptionIds && !opts.onlySubscriptionIds.has(sub.id))
        ) {
          result.skipped++;
          return;
        }
        const notifier = this.notifiers.get(sub.kind);
        if (!notifier) {
          result.skipped++;
          return;
        }
        const target: PushTarget = {
          id: sub.id,
          deviceId: sub.deviceId,
          kind: sub.kind,
          endpoint: sub.endpoint,
          keys: sub.keys ? (JSON.parse(sub.keys) as PushTarget['keys']) : null,
        };
        const out = await notifier.send(target, n);
        if (out.status === 'ok') {
          result.sent++;
          if (sub.failedCount > 0) this.repo.resetPushFailures(sub.id);
        } else if (out.status === 'gone') {
          result.gone++;
          this.repo.deletePushSubscription(sub.id);
        } else {
          result.failed++;
          this.log.warn(`push ${sub.kind} to device ${sub.deviceId} failed: ${out.error}`);
          const failures = this.repo.bumpPushFailure(sub.id);
          if (failures >= MAX_FAILED) this.repo.deletePushSubscription(sub.id);
        }
      }),
    ]);
    return result;
  }
}
