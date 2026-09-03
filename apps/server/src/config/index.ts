import os from 'node:os';
import path from 'node:path';

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
    webDist: env('DOUBLETAKE_WEB_DIST') ?? null,
    logLevel: env('DOUBLETAKE_LOG_LEVEL', 'info') ?? 'info',
  };
}
