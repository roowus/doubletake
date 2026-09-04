/**
 * Quiet hours and digest notifications (ADR 0020).
 *
 * The owner sets a daily window (e.g. 22:00–07:30, IANA time zone). Run notifications that
 * would fire inside the window are parked in `pending_notifications`; when the window ends they
 * go out as ONE digest ("3 answers ready while you were away") that opens the chat list. Outside
 * the window nothing changes. Owner channels and per-device pushes are gated together: a digest
 * is a notification like any other, so it carries no answer text (ADR 0008).
 */

import type { Repo } from '../db/repo.js';
import type { Notification } from './types.js';

export interface QuietHours {
  enabled: boolean;
  /** `HH:MM` local to `timeZone`. */
  start: string;
  end: string;
  /** IANA zone, e.g. `Europe/Berlin`; defaults to the server's zone. */
  timeZone: string;
}

export const QUIET_SETTING = 'quiet_hours';

export const DEFAULT_QUIET: QuietHours = {
  enabled: false,
  start: '22:00',
  end: '07:30',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHMM(s: string): number | null {
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Minutes since local midnight in `timeZone` for the instant `at`. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** True when `at` falls inside the window. `start === end` means never quiet. */
export function isQuiet(q: QuietHours, at: Date = new Date()): boolean {
  if (!q.enabled) return false;
  const start = parseHHMM(q.start);
  const end = parseHHMM(q.end);
  if (start === null || end === null || start === end) return false;
  const now = localMinutes(at, q.timeZone);
  // Window may wrap midnight (22:00–07:30).
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function loadQuietHours(repo: Repo): QuietHours {
  const raw = repo.getSetting(QUIET_SETTING);
  if (!raw) return DEFAULT_QUIET;
  try {
    const j = JSON.parse(raw) as Partial<QuietHours>;
    return {
      enabled: Boolean(j.enabled),
      start:
        typeof j.start === 'string' && parseHHMM(j.start) !== null ? j.start : DEFAULT_QUIET.start,
      end: typeof j.end === 'string' && parseHHMM(j.end) !== null ? j.end : DEFAULT_QUIET.end,
      timeZone:
        typeof j.timeZone === 'string' && validTimeZone(j.timeZone)
          ? j.timeZone
          : DEFAULT_QUIET.timeZone,
    };
  } catch {
    return DEFAULT_QUIET;
  }
}

export function saveQuietHours(repo: Repo, q: QuietHours): void {
  repo.setSetting(QUIET_SETTING, JSON.stringify(q));
}

/** The one digest that replaces N parked notifications. Opens the chat list, not one chat. */
export function buildDigest(
  pending: { chatId: string; title: string }[],
  publicUrl: string | null,
): Notification {
  const n = pending.length;
  const first = pending[0];
  const path = n === 1 && first ? `/chat/${first.chatId}` : '/';
  const body =
    n === 1 && first
      ? `${first.title.slice(0, 80)}`
      : pending
          .slice(0, 3)
          .map((p) => p.title.slice(0, 40))
          .join(' · ') + (n > 3 ? ` · +${n - 3} more` : '');
  return {
    title: n === 1 ? 'Answer ready' : `${n} answers ready`,
    body,
    chatId: n === 1 && first ? first.chatId : '',
    url: publicUrl ? `${publicUrl.replace(/\/$/, '')}${path}` : path,
    tag: 'digest',
  };
}

export interface Sink {
  notify(n: Notification): Promise<unknown>;
}

/**
 * Sits between the queue worker and the hub. Inside quiet hours it parks notifications;
 * `flush()` (called by a timer and on demand) sends the digest once the window has ended.
 * Never throws: the worker must not care whether a push went out.
 */
export class DigestGate implements Sink {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly sink: Sink,
    private readonly publicUrl: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  quietHours(): QuietHours {
    return loadQuietHours(this.repo);
  }
  setQuietHours(q: QuietHours): void {
    saveQuietHours(this.repo, q);
  }
  pendingCount(): number {
    return this.repo.countPendingNotifications();
  }

  async notify(n: Notification): Promise<unknown> {
    if (isQuiet(this.quietHours(), this.now())) {
      this.repo.enqueueNotification({
        chatId: n.chatId,
        title: n.title,
        body: n.body,
        url: n.url,
        tag: n.tag,
      });
      return { parked: true };
    }
    return this.sink.notify(n);
  }

  /** Sends the digest if anything is parked and we are outside quiet hours (or `force`). */
  async flush(force = false): Promise<{ sent: number }> {
    if (!force && isQuiet(this.quietHours(), this.now())) return { sent: 0 };
    const pending = this.repo.listPendingNotifications();
    if (pending.length === 0) return { sent: 0 };
    await this.sink.notify(buildDigest(pending, this.publicUrl));
    this.repo.clearPendingNotifications(pending.map((p) => p.id));
    return { sent: pending.length };
  }

  /** Checks once a minute; cheap (one COUNT when nothing is pending). */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.repo.countPendingNotifications() > 0) this.flush().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
