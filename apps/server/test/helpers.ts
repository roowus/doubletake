import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BrainAdapter,
  BrainCapabilities,
  ChatContext,
  EventSink,
  ResearchBrief,
  RunOptions,
  RunResult,
} from '@doubletake/brain-sdk';
import type { Config } from '../src/config/index.js';
import { DEFAULT_READ_DENY } from '../src/config/index.js';
import { openDb } from '../src/db/index.js';
import { Repo } from '../src/db/repo.js';

export function tempEnv(prefix = 'dt-test-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cfg: Config = {
    dataDir: path.join(root, 'data'),
    notesDir: path.join(root, 'Doubletake'),
    bind: '127.0.0.1',
    port: 0,
    publicUrl: null,
    brain: 'fake',
    brainModel: null,
    brainModes: {},
    readRoots: [root],
    readDeny: DEFAULT_READ_DENY,
    dailyCapUsd: 5,
    webDist: null,
    logLevel: 'silent',
    vapidPublicKey: null,
    vapidPrivateKey: null,
    vapidSubject: 'mailto:test@example.com',
    fcmServiceAccountPath: null,
    ntfy: null,
    telegram: null,
    media: {
      enabled: false,
      command: [],
      cwd: root,
      vision: 'cloud',
      whisperBackend: 'off',
      ytdlpCookiesFromBrowser: null,
    },
    ig: {
      appId: 'app123',
      appSecret: 'shh-secret',
      verifyToken: 'verify-me',
      webhookPublicHost: 'hook.example.com',
      mentionPolling: false,
      graphBase: 'https://graph.example.test/v25.0',
    },
    openai: {
      baseUrl: 'https://llm.example.test/v1',
      apiKey: null,
      model: 'fake-model',
      prices: {},
      vision: false,
    },
    headless: { preset: 'claude-code', command: null, args: null, timeoutMs: null },
    search: { provider: 'off', searxngUrl: '', braveKey: null, tavilyKey: null },
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const { db, sqlite, close } = openDb(path.join(cfg.dataDir, 'doubletake.db'));
  const repo = new Repo(db, sqlite);
  return {
    root,
    cfg,
    repo,
    cleanup: () => {
      close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export interface FakeBrainCall {
  kind: 'run' | 'followUp' | 'classify';
  prompt?: string;
  brief?: ResearchBrief;
  chat?: ChatContext;
  message?: string;
  opts?: RunOptions;
}

/** Scriptable brain: returns canned results, records calls, emits a couple of events. */
export class FakeBrain implements BrainAdapter {
  readonly id: string;
  calls: FakeBrainCall[] = [];
  healthy: { ok: boolean; detail?: string } = { ok: true };
  sessionId = 'sess-fake-1';
  classifyReply = '{"mode":"standard","question_type":"what_is_this","needs_comments":false}';
  nextResult: Partial<RunResult> = {};
  delayMs = 0;

  constructor(id = 'fake') {
    this.id = id;
  }

  capabilities(): BrainCapabilities {
    return { resume: true, vision: false, streaming: true, costReporting: true, tools: 'native' };
  }

  async run(brief: ResearchBrief, opts: RunOptions, sink: EventSink): Promise<RunResult> {
    this.calls.push({ kind: 'run', brief, opts });
    return this.produce(opts, sink, 'Researched answer.');
  }

  async followUp(chat: ChatContext, message: string, opts: RunOptions, sink: EventSink) {
    this.calls.push({ kind: 'followUp', chat, message, opts });
    return this.produce(opts, sink, `Follow-up answer to: ${message}`);
  }

  async classify(prompt: string): Promise<string> {
    this.calls.push({ kind: 'classify', prompt });
    return this.classifyReply;
  }

  async healthcheck() {
    return this.healthy;
  }

  private async produce(opts: RunOptions, sink: EventSink, text: string): Promise<RunResult> {
    sink.emit({ type: 'status', payload: { phase: 'agent_started' } });
    if (this.delayMs) {
      await new Promise((r) => setTimeout(r, this.delayMs));
      if (opts.signal.aborted) return { text: '', stopReason: 'aborted' };
    }
    sink.emit({ type: 'text', payload: { text } });
    return {
      text,
      structured: {
        summary: 'A summary.',
        category: 'tech',
        entities: [{ kind: 'tool', name: 'Widget', attributes: { price: '$9' }, confidence: 0.9 }],
        claims: [],
        recommendations: ['Try it'],
        tags: ['Widgets', 'tools'],
      },
      sessionId: this.sessionId,
      costUsd: 0.02,
      stopReason: 'done',
      ...this.nextResult,
    };
  }
}

export async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('waitFor timed out');
}
