import type { Repo } from '../db/repo.js';
import type { Notification, Notifier, PushTarget } from './types.js';

/** Subscriptions that fail this many times in a row are dropped even without a 410. */
export const MAX_FAILED = 8;

export interface NotifyResult {
  sent: number;
  gone: number;
  failed: number;
  skipped: number;
}

/**
 * Fans a notification out to every stored push subscription, using the notifier registered
 * for its kind. Dead subscriptions (410/404, or too many failures) are deleted; transient
 * failures bump `failed_count`. Never throws: a broken push service must not fail the run.
 */
export class NotificationHub {
  private readonly notifiers = new Map<string, Notifier>();

  constructor(
    private readonly repo: Repo,
    notifiers: Notifier[],
    private readonly log: { warn: (msg: string) => void } = console,
  ) {
    for (const n of notifiers) this.notifiers.set(n.kind, n);
  }

  has(kind: string): boolean {
    return this.notifiers.has(kind);
  }
  kinds(): string[] {
    return [...this.notifiers.keys()];
  }

  async notify(
    n: Notification,
    opts: { excludeDeviceId?: string; onlySubscriptionIds?: Set<string> } = {},
  ): Promise<NotifyResult> {
    const result: NotifyResult = { sent: 0, gone: 0, failed: 0, skipped: 0 };
    const subs = this.repo.listPushSubscriptions();
    await Promise.all(
      subs.map(async (sub) => {
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
    );
    return result;
  }
}
