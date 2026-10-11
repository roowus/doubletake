import type {
  ChatDetail,
  ChatSummary,
  CollectionDto,
  EntityHit,
  EntityKind,
  IngestRequest,
  LibraryGraph,
  Mode,
  RunEvent,
  TagDto,
  TodoCreate,
  TodoDto,
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
  /** `status` is 0 when no HTTP response arrived at all (network down, VPN not up yet). */
  constructor(
    public status: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** Message shown when the server could not be reached at all (no HTTP response). */
export const OFFLINE_MESSAGE =
  'Could not reach the server. Check the connection (VPN on?) and try again.';

/** Backoff between GET retries; the phone's VPN is often still coming up when a tap opens the app. */
const RETRY_DELAYS_MS = [400, 1200];

/**
 * `fetch` that turns a network failure into a readable `ApiError(0, …)`. Idempotent GETs are
 * retried a couple of times first: on Android a notification tap launches the app before the
 * Tailscale tunnel is back, and the first request dies with a bare `TypeError: Failed to fetch`.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<Response> {
  const retriable = (init.method ?? 'GET').toUpperCase() === 'GET';
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchImpl(input, init);
    } catch (e) {
      const delay = delays[attempt];
      if (!retriable || delay === undefined) {
        throw new ApiError(0, OFFLINE_MESSAGE, e);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function call<T>(method: string, url: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetchWithRetry(apiBase() + url, {
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
  /** Ids of every configured adapter, always present (unlike `brains`, which `health=skip` empties). */
  brainIds?: string[];
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
  starEntity: (id: string, starred: boolean) =>
    call<{ id: string; starred: boolean }>('POST', `/api/entities/${id}/star`, { starred }),
  /** Map of everything: nodes/edges over chats, things and tags (Library → Graph). */
  graph: () => call<LibraryGraph>('GET', '/api/library/graph'),
  // Saved list (ADR 0031)
  todos: (done: 'open' | 'done' | 'all' = 'open') =>
    call<TodoDto[]>('GET', done === 'open' ? '/api/todos' : `/api/todos?done=${done}`),
  createTodo: (input: TodoCreate) => call<TodoDto>('POST', '/api/todos', input),
  updateTodo: (id: string, patch: { done?: boolean; title?: string; note?: string | null }) =>
    call<TodoDto>('POST', `/api/todos/${id}`, patch),
  deleteTodo: (id: string) => call<void>('DELETE', `/api/todos/${id}`),
  /** Brain suggestions waiting for the owner's approve/dismiss. */
  suggestions: () => call<TodoDto[]>('GET', '/api/todos/suggestions'),
  approveSuggestion: (id: string) => call<TodoDto>('POST', `/api/todos/${id}/approve`),
  dismissSuggestion: (id: string) => call<void>('POST', `/api/todos/${id}/dismiss`),
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
  /** `adapter` pins the re-run to one configured brain (optionally with a model) instead of the mode's binding. */
  research: (id: string, mode?: Mode, note?: string, adapter?: string, model?: string) =>
    call<{ runId: string }>('POST', `/api/chats/${id}/research`, {
      ...(mode ? { mode } : {}),
      ...(note ? { note } : {}),
      ...(adapter ? { adapter } : {}),
      ...(adapter && model ? { model } : {}),
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
  hostedRegister: (email: string, password: string, inviteCode?: string) =>
    call<{ token: string; user: HostedUser }>(
      'POST',
      '/api/auth/register',
      { email, password, ...(inviteCode ? { invite_code: inviteCode } : {}) },
      false,
    ),
  hostedLogin: (email: string, password: string) =>
    call<{ token: string; user: HostedUser }>(
      'POST',
      '/api/auth/login',
      { email, password },
      false,
    ),
  hostedLogout: () => call<void>('POST', '/api/auth/logout'),
  account: () => call<AccountInfo>('GET', '/api/account'),
  addCredential: (c: NewCredential) => call<CredentialRow>('POST', '/api/account/credentials', c),
  revokeCredential: (id: string) => call<void>('DELETE', `/api/account/credentials/${id}`),
  revokeAccountSession: (id: string) =>
    call<void>('POST', `/api/account/sessions/${id}/revoke`),
  /** The agent token is shown exactly once, in the response. */
  createMcpToken: (label: string) =>
    call<{ id: string; token: string; label: string }>('POST', '/api/account/mcp-tokens', {
      label,
    }),
  /** Asks Graph which webhook fields are live and whether comments can be read; re-subscribes. */
  igVerify: () =>
    call<{
      subscribedFields: string[];
      missingFields: string[];
      resubscribed: boolean;
      tagsReadable: boolean;
      commentsOk: boolean;
      errors: Record<string, string>;
    }>('POST', '/api/ig/verify'),
};

// ---- Hosted mode (ADR 0032): e-mail accounts, OAuth, provider credentials, MCP tokens ----

export interface HostedUser {
  id: string;
  email: string;
}

export interface CredentialRow {
  id: string;
  kind: 'openrouter' | 'api_key' | 'harness';
  provider: string | null;
  label: string | null;
  baseUrl: string | null;
  monthlyCapUsd: number | null;
  perRunCapUsd: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AccountSession {
  id: string;
  kind: 'browser' | 'device' | 'mcp';
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AccountInfo {
  user: HostedUser;
  credentials: CredentialRow[];
  sessions: AccountSession[];
  spend: { month_usd: number };
}

export interface NewCredential {
  kind: 'openrouter' | 'api_key' | 'harness';
  provider?: string;
  label?: string;
  key: string;
  base_url?: string;
  monthly_cap_usd?: number;
  per_run_cap_usd?: number;
}

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
