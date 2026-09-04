import type { Notification } from './types.js';

/** Outcome of a broadcast. There is no `gone`: the channel is configured by the owner, not registered by a device. */
export type BroadcastOutcome = { status: 'ok' } | { status: 'failed'; error: string };

/**
 * A notification channel configured on the server for the owner (ntfy topic, Telegram chat),
 * as opposed to a `Notifier`, which delivers to per-device push subscriptions. Every
 * notification the hub sends also goes to every broadcaster (ADR 0019).
 */
export interface Broadcaster {
  readonly kind: 'ntfy' | 'telegram';
  send(n: Notification): Promise<BroadcastOutcome>;
}

const TIMEOUT_MS = 10_000;

async function post(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<BroadcastOutcome> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return { status: 'ok' };
    const text = (await res.text().catch(() => '')).slice(0, 200);
    return { status: 'failed', error: `HTTP ${res.status} ${text}`.trim() };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

export interface NtfyConfig {
  /** Server base URL, e.g. `https://ntfy.sh` or a self-hosted instance. */
  url: string;
  topic: string;
  /** Access token for protected topics; sent as `Authorization: Bearer`. */
  token: string | null;
}

/** Publishes to an ntfy topic (https://docs.ntfy.sh/publish/). The click action opens the chat. */
export class NtfyBroadcaster implements Broadcaster {
  readonly kind = 'ntfy' as const;
  constructor(
    private readonly cfg: NtfyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  send(n: Notification): Promise<BroadcastOutcome> {
    const headers: Record<string, string> = {
      Title: n.title.replace(/[\r\n]+/g, ' '),
      Tags: 'mag',
      Priority: 'default',
    };
    if (/^https?:\/\//.test(n.url)) headers.Click = n.url;
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    const base = this.cfg.url.replace(/\/$/, '');
    return post(this.fetchImpl, `${base}/${encodeURIComponent(this.cfg.topic)}`, {
      method: 'POST',
      headers,
      body: n.body,
    });
  }
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Override for tests / proxies; default `https://api.telegram.org`. */
  apiBase?: string;
}

/**
 * Sends `sendMessage` to one chat via the Bot API (https://core.telegram.org/bots/api#sendmessage).
 * An inline "Open chat" button needs an absolute URL, so it appears only when
 * `DOUBLETAKE_PUBLIC_URL` is set; otherwise the message ends with the relative path.
 */
export class TelegramBroadcaster implements Broadcaster {
  readonly kind = 'telegram' as const;
  constructor(
    private readonly cfg: TelegramConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  send(n: Notification): Promise<BroadcastOutcome> {
    const absolute = /^https?:\/\//.test(n.url);
    const text = absolute ? `${n.title}\n${n.body}` : `${n.title}\n${n.body}\n${n.url}`;
    const payload: Record<string, unknown> = {
      chat_id: this.cfg.chatId,
      text,
      disable_web_page_preview: true,
    };
    if (absolute) payload.reply_markup = { inline_keyboard: [[{ text: 'Open chat', url: n.url }]] };
    const base = (this.cfg.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
    return post(this.fetchImpl, `${base}/bot${this.cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}
