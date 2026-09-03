import type { ChatDetail, ChatSummary, IngestRequest, Mode, RunEvent } from '@doubletake/shared';

const TOKEN_KEY = 'doubletake.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
  const res = await fetch(url, {
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

export interface Status {
  spentTodayUsd: number;
  dailyCapUsd: number;
  brain: string;
  notesDir: string;
  push: { kinds: string[]; vapidPublicKey: string | null };
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
  ingest: (req: IngestRequest) =>
    call<{ itemId: string; chatId: string; runId: string; deduplicated: boolean }>(
      'POST',
      '/api/ingest',
      req,
    ),
  chats: (q?: string) =>
    call<ChatSummary[]>('GET', q ? `/api/chats?q=${encodeURIComponent(q)}` : '/api/chats'),
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
  status: () => call<Status>('GET', '/api/status'),
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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/events?token=${encodeURIComponent(token)}`);
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
