import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  };
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
