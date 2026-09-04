import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mode } from '@doubletake/shared';

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expandHome);
}

export const DEFAULT_READ_DENY = [
  '~/.ssh',
  '~/.aws',
  '~/.config',
  '~/.gnupg',
  '~/Library/Keychains',
  '~/.doubletake',
  '**/.env*',
  '**/*.pem',
  '**/*.key',
  '**/node_modules',
];

export interface Config {
  dataDir: string;
  notesDir: string;
  bind: string;
  port: number;
  publicUrl: string | null;
  brain: string;
  brainModel: string | null;
  /** Per-mode adapter override: `DOUBLETAKE_BRAIN_<MODE>=adapter[@model]` (docs/BRAIN-ADAPTERS.md). */
  brainModes: Partial<Record<Mode, { adapter: string; model: string | null }>>;
  readRoots: string[];
  readDeny: string[];
  dailyCapUsd: number;
  webDist: string | null;
  logLevel: string;
  /** Web Push VAPID keys; when unset, keys are generated once and stored in settings. */
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  /** Firebase service-account JSON for FCM; null disables FCM (Web Push still works). */
  fcmServiceAccountPath: string | null;
  /** Owner notification channels (ADR 0019); null = not configured. */
  ntfy: { url: string; topic: string; token: string | null } | null;
  telegram: { botToken: string; chatId: string } | null;
  /** Geocoder for place entities (ADR 0022); `off` leaves the map to brain-supplied coordinates only. */
  geocoder: { provider: 'nominatim' | 'off'; url: string; email: string | null };
  /** Media worker (docs/MEDIA-PIPELINE.md). `off` skips download/transcription entirely. */
  media: {
    enabled: boolean;
    /** Command that starts the worker; JSON-lines on stdio. */
    command: string[];
    /** Directory the command runs in (the uv project). */
    cwd: string;
    /** `cloud` = frames described by the brain; `local` = mlx-vlm in the worker; `off`. */
    vision: 'cloud' | 'local' | 'off';
    whisperBackend: string;
    ytdlpCookiesFromBrowser: string | null;
  };
  /** Instagram shadow-account channel (docs/channels/instagram-setup.md). All null = disabled. */
  ig: {
    appId: string | null;
    appSecret: string | null;
    verifyToken: string | null;
    /** Public hostname (tunnel / Funnel) that may reach `/webhooks/instagram` and nothing else. */
    webhookPublicHost: string | null;
    /** Poll `/me/tags` for mentions in case the `mentions` webhook does not fire. */
    mentionPolling: boolean;
    graphBase: string;
  };
  /** `openai-compatible` brain: any Chat Completions endpoint (docs/BRAIN-ADAPTERS.md). */
  openai: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    /** Model → USD per million input/output tokens, for cost reporting. */
    prices: Record<string, { inputPerM: number; outputPerM: number }>;
    vision: boolean;
  };
  /** `headless-cli` brain: which CLI harness to spawn (docs/BRAIN-ADAPTERS.md). */
  headless: {
    /** Preset id (`claude-code`, `codex`, `gemini-cli`, `opencode`, `hermes`). */
    preset: string;
    /** Override the preset's executable (path or name on PATH). */
    command: string | null;
    /** Override the preset's argument template (JSON array with {prompt} etc.). */
    args: string[] | null;
    timeoutMs: number | null;
  };
  /** Web search backend for loop-based brains; `off` removes the web_search tool. */
  search: {
    provider: 'searxng' | 'brave' | 'tavily' | 'off';
    searxngUrl: string;
    braveKey: string | null;
    tavilyKey: string | null;
  };
}

export function loadConfig(): Config {
  const home = os.homedir();
  const dataDir = expandHome(env('DOUBLETAKE_DATA_DIR', path.join(home, '.doubletake')) ?? '');
  return {
    dataDir,
    notesDir: expandHome(env('DOUBLETAKE_NOTES_DIR', path.join(home, 'Doubletake')) ?? ''),
    bind: env('DOUBLETAKE_BIND', '127.0.0.1') ?? '127.0.0.1',
    port: Number(env('DOUBLETAKE_PORT', '7391')),
    publicUrl: env('DOUBLETAKE_PUBLIC_URL') ?? null,
    brain: env('DOUBLETAKE_BRAIN', 'claude-agent-sdk') ?? 'claude-agent-sdk',
    brainModel: env('DOUBLETAKE_BRAIN_MODEL') ?? null,
    brainModes: {
      ...modeBinding('quick', env('DOUBLETAKE_BRAIN_QUICK')),
      ...modeBinding('standard', env('DOUBLETAKE_BRAIN_STANDARD')),
      ...modeBinding('deep', env('DOUBLETAKE_BRAIN_DEEP')),
    },
    readRoots: list(env('DOUBLETAKE_READ_ROOTS', home)),
    readDeny: list(env('DOUBLETAKE_READ_DENY', DEFAULT_READ_DENY.join(','))),
    dailyCapUsd: Number(env('DOUBLETAKE_DAILY_CAP_USD', '5')),
    webDist: env('DOUBLETAKE_WEB_DIST') ?? defaultWebDist(),
    logLevel: env('DOUBLETAKE_LOG_LEVEL', 'info') ?? 'info',
    vapidPublicKey: env('VAPID_PUBLIC_KEY') ?? null,
    vapidPrivateKey: env('VAPID_PRIVATE_KEY') ?? null,
    vapidSubject:
      env('VAPID_SUBJECT', 'mailto:doubletake@localhost') ?? 'mailto:doubletake@localhost',
    fcmServiceAccountPath: expandHome(env('FCM_SERVICE_ACCOUNT_PATH') ?? '') || null,
    ntfy: env('NTFY_TOPIC')
      ? {
          url: env('NTFY_URL', 'https://ntfy.sh') ?? 'https://ntfy.sh',
          topic: env('NTFY_TOPIC') ?? '',
          token: env('NTFY_TOKEN') ?? null,
        }
      : null,
    telegram:
      env('TELEGRAM_BOT_TOKEN') && env('TELEGRAM_CHAT_ID')
        ? { botToken: env('TELEGRAM_BOT_TOKEN') ?? '', chatId: env('TELEGRAM_CHAT_ID') ?? '' }
        : null,
    geocoder: {
      provider: env('GEOCODER', 'nominatim') === 'off' ? 'off' : 'nominatim',
      url: env('GEOCODER_URL', 'https://nominatim.openstreetmap.org') ?? '',
      email: env('GEOCODER_EMAIL') ?? null,
    },
    media: {
      enabled: (env('DOUBLETAKE_MEDIA_WORKER', 'on') ?? 'on') !== 'off',
      command: list(env('DOUBLETAKE_MEDIA_WORKER_CMD', 'uv,run,--frozen,doubletake-media')),
      cwd: expandHome(env('DOUBLETAKE_MEDIA_WORKER_CWD', defaultWorkerDir()) ?? ''),
      vision: visionMode(env('DOUBLETAKE_VISION', 'cloud')),
      whisperBackend: env('DOUBLETAKE_WHISPER_BACKEND', 'auto') ?? 'auto',
      ytdlpCookiesFromBrowser: env('DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER') ?? null,
    },
    ig: {
      appId: env('IG_APP_ID') ?? null,
      appSecret: env('IG_APP_SECRET') ?? null,
      verifyToken: env('IG_WEBHOOK_VERIFY_TOKEN') ?? null,
      webhookPublicHost: env('DOUBLETAKE_WEBHOOK_PUBLIC_HOST')?.toLowerCase() ?? null,
      mentionPolling: (env('IG_MENTION_POLLING', 'on') ?? 'on') !== 'off',
      graphBase: env('IG_GRAPH_BASE', 'https://graph.instagram.com/v25.0') ?? '',
    },
    openai: {
      baseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1') ?? '',
      apiKey: env('OPENAI_API_KEY') ?? null,
      model: env('OPENAI_MODEL', 'gpt-4o-mini') ?? 'gpt-4o-mini',
      prices: parsePrices(env('OPENAI_PRICES')),
      vision: (env('OPENAI_VISION', 'off') ?? 'off') === 'on',
    },
    headless: {
      preset: env('DOUBLETAKE_HEADLESS_PRESET', 'claude-code') ?? 'claude-code',
      command: env('DOUBLETAKE_HEADLESS_CMD') ?? null,
      args: parseArgs(env('DOUBLETAKE_HEADLESS_ARGS')),
      timeoutMs: env('DOUBLETAKE_HEADLESS_TIMEOUT_MS')
        ? Number(env('DOUBLETAKE_HEADLESS_TIMEOUT_MS'))
        : null,
    },
    search: {
      provider: searchProvider(env('SEARCH_PROVIDER', 'searxng')),
      searxngUrl: env('SEARXNG_URL', 'http://127.0.0.1:8888') ?? '',
      braveKey: env('BRAVE_SEARCH_API_KEY') ?? null,
      tavilyKey: env('TAVILY_API_KEY') ?? null,
    },
  };
}

function searchProvider(v: string | undefined): Config['search']['provider'] {
  return v === 'brave' || v === 'tavily' || v === 'off' ? v : 'searxng';
}

/** `OPENAI_PRICES='{"gpt-4o-mini":{"inputPerM":0.15,"outputPerM":0.6}}'`; malformed → no prices. */
/** `adapter` or `adapter@model`; empty ⇒ no override for that mode. */
function modeBinding(mode: Mode, raw: string | undefined): Config['brainModes'] {
  if (!raw?.trim()) return {};
  const at = raw.indexOf('@');
  const adapter = (at === -1 ? raw : raw.slice(0, at)).trim();
  const model = at === -1 ? null : raw.slice(at + 1).trim() || null;
  return adapter ? { [mode]: { adapter, model } } : {};
}

/** JSON array of strings; anything else ⇒ null (preset args are used). */
function parseArgs(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}

function parsePrices(raw: string | undefined): Config['openai']['prices'] {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, { inputPerM?: unknown; outputPerM?: unknown }>;
    const out: Config['openai']['prices'] = {};
    for (const [model, p] of Object.entries(obj)) {
      if (typeof p?.inputPerM === 'number' && typeof p?.outputPerM === 'number') {
        out[model] = { inputPerM: p.inputPerM, outputPerM: p.outputPerM };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function visionMode(v: string | undefined): 'cloud' | 'local' | 'off' {
  return v === 'local' || v === 'off' ? v : 'cloud';
}

/** `workers/media` inside the monorepo checkout. */
function defaultWorkerDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../../workers/media');
}

/** The PWA build sits next to the server package inside the monorepo; use it when present. */
function defaultWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(here, '../../../web/dist');
  return fs.existsSync(path.join(candidate, 'index.html')) ? candidate : null;
}
