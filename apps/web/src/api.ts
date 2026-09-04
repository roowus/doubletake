import type {
  ChatDetail,
  ChatSummary,
  CollectionDto,
  EntityHit,
  EntityKind,
  IngestRequest,
  Mode,
  RunEvent,
  TagDto,
} from '@doubletake/shared';
import { apiBase, mirrorToken } from './native';

const TOKEN_KEY = 'doubletake.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  mirrorToken(token);
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  collections: number;
  runs: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(apiBase() + url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 && auth) {
    setToken(null);
    window.dispatchEvent(new Event('doubletake:unauthorized'));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface BrainHealth {
  id: string;
  ok: boolean;
  detail: string | null;
  /** True for the adapter that handles unbound modes, classification and follow-up fallback. */
  default: boolean;
  /** Modes bound to this adapter via DOUBLETAKE_BRAIN_<MODE>. */
  modes: string[];
  checkedAt: string;
}
export interface Status {
  spentTodayUsd: number;
  dailyCapUsd: number;
  brain: string;
  /** One entry per configured adapter; empty when `health=skip`. */
  brains: BrainHealth[];
  notesDir: string;
  push: {
    kinds: string[];
    channels: string[];
    vapidPublicKey: string | null;
    /** null when the server has no push at all. */
    quietHours: QuietHours | null;
    /** Notifications parked during quiet hours, waiting for the digest. */
    pending: number;
  };
}
export interface QuietHours {
  enabled: boolean;
  /** HH:MM in `timeZone`. */
  start: string;
  end: string;
  timeZone: string;
}
export interface PushSubscriptionRow {
  id: string;
  kind: string;
  endpoint: string;
  createdAt: string;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface IgStatus {
  configured: boolean;
  connected: boolean;
  igUserId: string | null;
  username: string | null;
  expiresAt: string | null;
  refreshedAt: string | null;
  webhookPublicHost: string | null;
  mentionPolling: boolean;
  scopes: string[];
  recentEvents: {
    id: string;
    kind: string;
    itemId: string | null;
    receivedAt: string;
    error: string | null;
  }[];
}

export const api = {
  health: () => call<{ ok: boolean; hasOwner: boolean }>('GET', '/api/health', undefined, false),
  setup: (password: string, deviceName: string) =>
    call<{ token: string }>('POST', '/api/setup', { password, deviceName }, false),
  login: (password: string, deviceName: string) =>
    call<{ token: string }>('POST', '/api/login', { password, deviceName }, false),
  pairRedeem: (code: string, deviceName: string, platform: string) =>
    call<{ token: string }>('POST', '/api/pair/redeem', { code, deviceName, platform }, false),
  pairStart: () =>
    call<{ code: string; expiresAt: string; url: string; qr: string }>('POST', '/api/pair/start'),
  devices: () => call<Device[]>('GET', '/api/devices'),
  revokeDevice: (id: string) => call<void>('DELETE', `/api/devices/${id}`),
  /** Karakeep / Memos interchange (ADR 0024). Exports are plain GETs with a device token. */
  importKarakeep: (file: unknown, research?: Mode) =>
    call<ImportSummary>(
      'POST',
      `/api/import/karakeep${research ? `?research=${research}` : ''}`,
      file,
    ),
  ingest: (req: IngestRequest) =>
    call<{ itemId: string; chatId: string; runId: string; deduplicated: boolean }>(
      'POST',
      '/api/ingest',
      req,
    ),
  askLibrary: (question: string, modeHint: 'auto' | 'quick' | 'standard' | 'deep' = 'auto') =>
    call<{ itemId: string; chatId: string; runId: string }>('POST', '/api/library/chat', {
      question,
      modeHint,
    }),
  chats: (q?: string, tag?: string, collection?: string) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (tag) p.set('tag', tag);
    if (collection) p.set('collection', collection);
    const qs = p.toString();
    return call<ChatSummary[]>('GET', qs ? `/api/chats?${qs}` : '/api/chats');
  },
  tags: () => call<TagDto[]>('GET', '/api/tags'),
  collections: (all = false) =>
    call<CollectionDto[]>(
      'GET',
      all ? '/api/collections?all=true&hidden=true' : '/api/collections',
    ),
  createCollection: (name: string, query?: string) =>
    call<CollectionDto>('POST', '/api/collections', query ? { name, query } : { name }),
  updateCollection: (id: string, patch: { name?: string; query?: string; hidden?: boolean }) =>
    call<CollectionDto>('POST', `/api/collections/${id}`, patch),
  deleteCollection: (id: string) => call<void>('DELETE', `/api/collections/${id}`),
  shareCollection: (id: string) =>
    call<{ shareUrl: string }>('POST', `/api/collections/${id}/share`),
  unshareCollection: (id: string) =>
    call<{ shareUrl: null }>('DELETE', `/api/collections/${id}/share`),
  previewCollection: (query: string) =>
    call<{ count: number }>('GET', `/api/collections/preview?query=${encodeURIComponent(query)}`),
  addToCollection: (id: string, chatId: string) =>
    call<{ count: number }>('POST', `/api/collections/${id}/items`, { chatId }),
  removeFromCollection: (id: string, chatId: string) =>
    call<{ count: number }>('DELETE', `/api/collections/${id}/items/${chatId}`),
  chatCollections: (chatId: string) =>
    call<{ collectionIds: string[] }>('GET', `/api/chats/${chatId}/collections`),
  entities: (kind: EntityKind, limit = 200) =>
    call<EntityHit[]>('GET', `/api/entities?kind=${kind}&limit=${limit}`),
  /** Geocode every place without coordinates (409 when the server's geocoder is off). */
  geocodePlaces: () =>
    call<{ places: number; located: number; unknown: number; retried: number }>(
      'POST',
      '/api/entities/geocode',
    ),
  addTag: (chatId: string, name: string) =>
    call<{ tags: string[] }>('POST', `/api/chats/${chatId}/tags`, { name }),
  removeTag: (chatId: string, name: string) =>
    call<{ tags: string[] }>('DELETE', `/api/chats/${chatId}/tags/${encodeURIComponent(name)}`),
  chat: (id: string) => call<ChatDetail>('GET', `/api/chats/${id}`),
  markRead: (id: string) => call<void>('POST', `/api/chats/${id}/read`),
  sendMessage: (id: string, content: string) =>
    call<{ runId: string }>('POST', `/api/chats/${id}/messages`, { content }),
  research: (id: string, mode?: Mode, note?: string) =>
    call<{ runId: string }>('POST', `/api/chats/${id}/research`, {
      ...(mode ? { mode } : {}),
      ...(note ? { note } : {}),
    }),
  runEvents: (chatId: string, runId: string) =>
    call<{ events: RunEvent[] }>('GET', `/api/chats/${chatId}/runs/${runId}/events`),
  cancelRun: (runId: string) => call<void>('POST', `/api/runs/${runId}/cancel`),
  /** `refresh` re-runs every adapter healthcheck instead of serving the 5-minute cache. */
  status: (health: 'cached' | 'refresh' | 'skip' = 'cached') =>
    call<Status>('GET', `/api/status?health=${health}`),
  pushSubscribe: (body: {
    kind: 'webpush' | 'fcm';
    endpoint: string;
    keys?: { p256dh: string; auth: string };
  }) => call<{ id: string }>('POST', '/api/push/subscribe', body),
  pushUnsubscribe: (endpoint: string) =>
    call<{ removed: boolean }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushSubscriptions: () => call<PushSubscriptionRow[]>('GET', '/api/push/subscriptions'),
  pushTest: () =>
    call<{ sent: number; gone: number; failed: number; skipped: number }>('POST', '/api/push/test'),
  /** Test the owner channels (ntfy, Telegram); 404 when none is configured. */
  pushChannelsTest: () => call<{ sent: number; failed: number }>('POST', '/api/push/channels/test'),
  setQuietHours: (q: QuietHours) =>
    call<{ quietHours: QuietHours; pending: number }>('PUT', '/api/push/quiet-hours', q),
  /** Send the parked digest now, even inside quiet hours. */
  flushDigest: () => call<{ sent: number }>('POST', '/api/push/digest/flush'),
  /** 404 when the server has no IG_APP_ID/IG_APP_SECRET (routes are not registered). */
  igStatus: () => call<IgStatus>('GET', '/api/ig/status'),
  igConnect: () => call<{ url: string }>('POST', '/api/ig/connect'),
  igDisconnect: () => call<void>('DELETE', '/api/ig/account'),
  igRefresh: () => call<IgStatus>('POST', '/api/ig/refresh'),
  igPoll: () =>
    call<{ handled: unknown[]; duplicates: number; ignored: number }>('POST', '/api/ig/poll'),
};

export type LiveEvent =
  | ({ kind: 'run_event' } & RunEvent)
  | { kind: 'chat_updated'; chatId: string };

/** Live events over WebSocket with reconnect. Returns an unsubscribe function. */
export function subscribeLive(onEvent: (e: LiveEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  const connect = () => {
    const token = getToken();
    if (!token || closed) return;
    const base = apiBase();
    const origin = base ? new URL(base) : location;
    const proto = origin.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${origin.host}/api/events?token=${encodeURIComponent(token)}`);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as LiveEvent);
      } catch {
        /* ignore */
      }
    };
    ws.onopen = () => {
      retry = 500;
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15_000);
    };
  };
  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
