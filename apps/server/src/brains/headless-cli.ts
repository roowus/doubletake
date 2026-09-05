/**
 * headless-cli adapter (docs/BRAIN-ADAPTERS.md §headless-cli, ADR 0003).
 *
 * Runs any CLI harness (`claude -p`, `codex exec`, `gemini -p`, `opencode run`, `hermes chat`)
 * as a child process per run. The harness's own tools do the work, so tool policy here is the
 * weaker "preamble + sandbox cwd" model documented in ADR 0005: the brief carries the policy as
 * text, the process runs in a fresh directory under `<dataDir>/runs/`, and Doubletake's own
 * file/web tools are not involved. Resume works only when the preset defines `resumeArgs`, and
 * a resumed run reuses the directory its session was created in: gemini and opencode scope
 * sessions to the cwd ("project"), so a follow-up from a fresh directory would not find them
 * (`<runsDir>/sessions/<sessionId>` records the directory).
 */

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
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
import { parseAnswerBlock } from '@doubletake/shared';
import { renderBrief, renderFollowUp, SYSTEM_FRAMING } from './prompts.js';

export type PromptMode = 'arg' | 'stdin';
export type OutputParser = 'claude-json' | 'gemini-json' | 'jsonl' | 'plain';

export interface HeadlessPreset {
  id: string;
  command: string;
  /** Placeholders: {prompt} {maxTurns} {model} {sessionId} {sandboxDir}. */
  args: string[];
  /** Appended when resuming; omit ⇒ `capabilities().resume === false`. */
  resumeArgs?: string[];
  /** Appended when a model is configured; `{model}` is substituted. */
  modelArgs?: string[];
  promptMode: PromptMode;
  outputParser: OutputParser;
  /**
   * For parsers that carry no session id (`plain`): a regex with one capture group, matched
   * against stderr then stdout, e.g. Hermes prints `session_id: 2026…` on stderr.
   */
  sessionIdPattern?: string;
  /** Extra env for the child; `${NAME}` is read from the server's environment. */
  env?: Record<string, string>;
  timeoutMs?: number;
}

export const HEADLESS_PRESETS: Record<string, HeadlessPreset> = {
  'claude-code': {
    id: 'claude-code',
    command: 'claude',
    args: ['-p', '{prompt}', '--output-format', 'json', '--max-turns', '{maxTurns}'],
    resumeArgs: ['--resume', '{sessionId}'],
    modelArgs: ['--model', '{model}'],
    promptMode: 'arg',
    outputParser: 'claude-json',
  },
  // Verified against codex-cli 0.153.4 (2026-09-04): `exec --json` prints JSON-lines with
  // `thread.started.thread_id` (the session id) and `item.completed`/`agent_message`; the prompt
  // is read from stdin. `exec … resume <id> -` continues that thread, `-` = prompt on stdin, and
  // the `exec` options stay valid before the subcommand.
  codex: {
    id: 'codex',
    command: 'codex',
    args: ['exec', '--json', '--skip-git-repo-check', '-C', '{sandboxDir}'],
    resumeArgs: ['resume', '{sessionId}', '-'],
    modelArgs: ['--model', '{model}'],
    promptMode: 'stdin',
    outputParser: 'jsonl',
  },
  // Verified against Gemini CLI 0.58.0 (2026-09-04): `-o json` prints one object with
  // `session_id` and `response` (errors: `{ session_id, error: { message, code } }` on stderr,
  // non-zero exit); `--resume <session_id>` continues it; `--skip-trust` is required headless,
  // otherwise the CLI refuses an untrusted directory (exit 55).
  'gemini-cli': {
    id: 'gemini-cli',
    command: 'gemini',
    args: ['-p', '{prompt}', '-o', 'json', '--skip-trust'],
    resumeArgs: ['--resume', '{sessionId}'],
    modelArgs: ['--model', '{model}'],
    promptMode: 'arg',
    outputParser: 'gemini-json',
  },
  // Verified against opencode 1.18.29 (2026-09-04): `run --format json` prints one event per
  // line (`text` parts carry the answer, `step_finish.part.tokens` the usage, `error` events a
  // failure); `-s <sessionID>` continues a session. `--pure` skips external plugins.
  opencode: {
    id: 'opencode',
    command: 'opencode',
    args: ['run', '--pure', '--format', 'json', '{prompt}'],
    resumeArgs: ['-s', '{sessionId}'],
    modelArgs: ['--model', '{model}'],
    promptMode: 'arg',
    outputParser: 'jsonl',
  },
  // Verified against Hermes Agent v0.21.0 (2026-09-04): `-Q --oneshot` prints only the answer
  // on stdout and `session_id: <id>` on stderr; `--resume <id>` continues that session.
  // `--source tool` keeps the runs out of the owner's own session list.
  hermes: {
    id: 'hermes',
    command: 'hermes',
    args: [
      'chat',
      '-Q',
      '--oneshot',
      '--source',
      'tool',
      '--max-turns',
      '{maxTurns}',
      '-q',
      '{prompt}',
    ],
    resumeArgs: ['--resume', '{sessionId}'],
    modelArgs: ['--model', '{model}'],
    promptMode: 'arg',
    outputParser: 'plain',
    sessionIdPattern: 'session_id:\\s*([A-Za-z0-9_-]+)',
  },
};

export interface HeadlessCliConfig {
  preset: HeadlessPreset;
  /** Fresh per-run cwd directories are created under here. */
  runsDir: string;
  model?: string;
  /** Overrides the preset's timeout (default 25 min). */
  timeoutMs?: number;
  /** Injectable for tests; defaults to node's spawn. */
  spawn?: typeof nodeSpawn;
  /** Environment the child inherits (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
}

export interface ParsedOutput {
  text: string;
  sessionId?: string;
  costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number };
  isError?: boolean;
}

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export class HeadlessCliAdapter implements BrainAdapter {
  readonly id = 'headless-cli';
  constructor(private readonly cfg: HeadlessCliConfig) {}

  capabilities(): BrainCapabilities {
    return {
      resume: Array.isArray(this.cfg.preset.resumeArgs) && this.cfg.preset.resumeArgs.length > 0,
      vision: false,
      streaming: false,
      costReporting: this.cfg.preset.outputParser === 'claude-json',
      tools: 'none',
    };
  }

  async run(brief: ResearchBrief, opts: RunOptions, sink: EventSink): Promise<RunResult> {
    const prompt = `${SYSTEM_FRAMING}\n\n${renderBrief(brief, opts.tools, opts.mode)}`;
    return this.exec(prompt, opts, sink, opts.sessionId);
  }

  async followUp(
    chat: ChatContext,
    userMessage: string,
    opts: RunOptions,
    sink: EventSink,
  ): Promise<RunResult> {
    const canResume = this.capabilities().resume && !!chat.sessionId;
    if (canResume) {
      return this.exec(renderFollowUp(chat, userMessage, true), opts, sink, chat.sessionId);
    }
    // No native resume: replay the conversation with a zero-tool policy.
    const zero: RunOptions = {
      ...opts,
      tools: { ...opts.tools, webSearch: false, webFetch: false, readRoots: [], writeRoot: null },
    };
    return this.exec(
      `${SYSTEM_FRAMING}\n\n${renderFollowUp(chat, userMessage, false)}`,
      zero,
      sink,
    );
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    const { command } = this.cfg.preset;
    const found = resolveOnPath(command, this.cfg.baseEnv ?? process.env);
    if (!found) return { ok: false, detail: `${command} not found on PATH` };
    return { ok: true, detail: `${this.cfg.preset.id} → ${found}` };
  }

  /** Spawn one process for one prompt. */
  private async exec(
    prompt: string,
    opts: RunOptions,
    sink: EventSink,
    sessionId?: string,
  ): Promise<RunResult> {
    if (opts.signal.aborted) return { text: '', stopReason: 'aborted', error: 'aborted' };
    const preset = this.cfg.preset;
    const sandboxDir =
      (sessionId ? this.sessionDir(sessionId) : undefined) ??
      path.join(this.cfg.runsDir, `${Date.now().toString(36)}-${rand()}`);
    fs.mkdirSync(sandboxDir, { recursive: true });
    const vars: Record<string, string> = {
      prompt,
      maxTurns: String(opts.maxTurns),
      model: opts.model ?? this.cfg.model ?? '',
      sessionId: sessionId ?? '',
      sandboxDir,
    };
    const resume = sessionId && preset.resumeArgs ? preset.resumeArgs : [];
    const modelArgs = vars.model && preset.modelArgs ? preset.modelArgs : [];
    const args = [...preset.args, ...modelArgs, ...resume].map((a) => substitute(a, vars));
    const env = { ...(this.cfg.baseEnv ?? process.env), ...expandEnv(preset.env ?? {}) };
    const timeoutMs = this.cfg.timeoutMs ?? preset.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    sink.emit({
      type: 'status',
      payload: {
        phase: 'agent_started',
        adapter: this.id,
        preset: preset.id,
        command: preset.command,
        ...(vars.model ? { model: vars.model } : {}),
        ...(sessionId ? { resumed: true } : {}),
      },
    });

    let raw: { stdout: string; stderr: string; code: number | null; timedOut: boolean };
    try {
      raw = await runProcess(this.cfg.spawn ?? nodeSpawn, preset.command, args, {
        cwd: sandboxDir,
        env,
        stdin: preset.promptMode === 'stdin' ? prompt : null,
        timeoutMs,
        signal: opts.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sink.emit({ type: 'status', payload: { phase: 'agent_failed', error: message } });
      return { text: '', stopReason: 'error', error: message };
    }
    if (opts.signal.aborted) return { text: '', stopReason: 'aborted', error: 'aborted' };
    if (raw.timedOut) {
      return {
        text: '',
        stopReason: 'error',
        error: `${preset.command} timed out after ${timeoutMs} ms`,
      };
    }
    const parsed = parseOutput(preset.outputParser, raw.stdout);
    if (!parsed.sessionId && preset.sessionIdPattern) {
      const found = matchSessionId(preset.sessionIdPattern, raw.stderr, raw.stdout);
      if (found) parsed.sessionId = found;
    }
    if (raw.code !== 0 && !parsed.text) {
      const detail = raw.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
      const error = `${preset.command} exited with ${raw.code}${detail ? `: ${detail}` : ''}`;
      sink.emit({ type: 'status', payload: { phase: 'agent_failed', error } });
      return { text: '', stopReason: 'error', error };
    }
    if (parsed.isError) {
      return {
        text: parsed.text,
        stopReason: 'error',
        error: parsed.text || 'harness reported an error',
      };
    }
    if (!parsed.text.trim()) {
      return { text: '', stopReason: 'error', error: 'harness returned no text' };
    }
    sink.emit({ type: 'text', payload: { text: parsed.text } });
    const { text, structured } = parseAnswerBlock(parsed.text);
    // A session id is only useful when the preset can resume it.
    const keepSession = this.capabilities().resume ? (parsed.sessionId ?? sessionId) : undefined;
    if (keepSession && ID_RE.test(keepSession)) this.rememberSessionDir(keepSession, sandboxDir);
    return {
      text,
      stopReason: 'done',
      ...(structured ? { structured } : {}),
      ...(structured?.escalate ? { escalate: structured.escalate } : {}),
      ...(keepSession && ID_RE.test(keepSession) ? { sessionId: keepSession } : {}),
      ...(parsed.costUsd !== undefined ? { costUsd: parsed.costUsd } : {}),
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }

  /** Directory a session was created in, when recorded and still present. */
  private sessionDir(sessionId: string): string | undefined {
    if (!ID_RE.test(sessionId)) return undefined;
    try {
      const dir = fs
        .readFileSync(path.join(this.cfg.runsDir, 'sessions', sessionId), 'utf8')
        .trim();
      return dir && fs.existsSync(dir) ? dir : undefined;
    } catch {
      return undefined;
    }
  }

  private rememberSessionDir(sessionId: string, dir: string): void {
    try {
      const sessions = path.join(this.cfg.runsDir, 'sessions');
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(path.join(sessions, sessionId), dir);
    } catch {
      // best effort; a follow-up then runs in a fresh directory
    }
  }
}

/** First capture group of `pattern` in stderr, then stdout; undefined when absent or invalid. */
export function matchSessionId(pattern: string, ...sources: string[]): string | undefined {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return undefined;
  }
  for (const src of sources) {
    const m = re.exec(src);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Replace `{name}` placeholders; unknown names are left as-is. */
export function substitute(arg: string, vars: Record<string, string>): string {
  return arg.replace(/\{([A-Za-z]+)\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m));
}

/** `${NAME}` in preset env values reads the server's environment. */
function expandEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, n: string) => process.env[n] ?? '');
  }
  return out;
}

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

function resolveOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  if (command.includes('/')) return fs.existsSync(command) ? command : null;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, command);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

interface ProcOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string | null;
  timeoutMs: number;
  signal: AbortSignal;
}

function runProcess(
  spawnImpl: typeof nodeSpawn,
  command: string,
  args: string[],
  o: ProcOpts,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal.removeEventListener('abort', onAbort);
      fn();
    };
    const kill = () => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // already gone
          }
        }, 5000).unref();
      } catch {
        // already gone
      }
    };
    const onAbort = () => kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, o.timeoutMs);
    o.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => finish(() => resolve({ stdout, stderr, code, timedOut })));
    if (o.stdin !== null) child.stdin?.end(o.stdin);
    else child.stdin?.end();
  });
}

/** Parse harness output into text + metadata. Exported for tests. */
export function parseOutput(parser: OutputParser, stdout: string): ParsedOutput {
  switch (parser) {
    case 'claude-json':
      return parseClaudeJson(stdout);
    case 'gemini-json':
      return parseGeminiJson(stdout);
    case 'jsonl':
      return parseJsonl(stdout);
    default:
      return { text: stdout.trim() };
  }
}

/** `claude -p --output-format json`: one object with `result`, `session_id`, `total_cost_usd`. */
function parseClaudeJson(stdout: string): ParsedOutput {
  const obj = lastJsonObject(stdout);
  if (!obj) return { text: stdout.trim() };
  const out: ParsedOutput = { text: str(obj.result) };
  if (typeof obj.session_id === 'string') out.sessionId = obj.session_id;
  if (typeof obj.total_cost_usd === 'number') out.costUsd = obj.total_cost_usd;
  if (obj.is_error === true) out.isError = true;
  const usage = obj.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number') {
    out.usage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }
  return out;
}

/** `gemini -p … -o json`: one object with `session_id`, `response` and `stats.models.*.tokens`. */
function parseGeminiJson(stdout: string): ParsedOutput {
  const obj = lastJsonObject(stdout);
  if (!obj) return { text: stdout.trim() };
  const out: ParsedOutput = { text: str(obj.response) };
  if (typeof obj.session_id === 'string') out.sessionId = obj.session_id;
  if (obj.error && typeof obj.error === 'object') {
    out.isError = true;
    out.text = str((obj.error as Record<string, unknown>).message) || out.text;
  }
  const models = (obj.stats as Record<string, unknown> | undefined)?.models as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (models) {
    let input = 0;
    let output = 0;
    for (const m of Object.values(models)) {
      const t = m.tokens as Record<string, unknown> | undefined;
      if (typeof t?.input === 'number') input += t.input;
      if (typeof t?.candidates === 'number') output += t.candidates;
    }
    out.usage = { inputTokens: input, outputTokens: output };
  }
  return out;
}

/**
 * JSON-lines event streams (Codex `exec --json`, OpenCode `run --format json`, and any harness
 * printing one object per line). The text is the last event that carries assistant text; falls
 * back to plain stdout.
 */
function parseJsonl(stdout: string): ParsedOutput {
  const out: ParsedOutput = { text: '' };
  const texts: string[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(ev.type ?? '');
    const item = ev.item as Record<string, unknown> | undefined;
    if (type === 'thread.started' && typeof ev.thread_id === 'string') out.sessionId = ev.thread_id;
    if (
      type === 'item.completed' &&
      item?.type === 'agent_message' &&
      typeof item.text === 'string'
    ) {
      texts.push(item.text);
    } else if (type === 'result' && typeof ev.result === 'string') {
      texts.push(ev.result);
      if (typeof ev.session_id === 'string') out.sessionId = ev.session_id;
      if (typeof ev.total_cost_usd === 'number') out.costUsd = ev.total_cost_usd;
    } else if (type === 'error' || type === 'turn.failed') {
      out.isError = true;
      const e = ev.error as Record<string, unknown> | string | undefined;
      const data = (typeof e === 'object' ? e?.data : undefined) as
        | Record<string, unknown>
        | undefined;
      texts.push(typeof e === 'string' ? e : str(e?.message ?? data?.message ?? ev.message));
    }
    // OpenCode: `{ type: "text", sessionID, part: { text } }` and `step_finish.part.tokens`.
    const part = ev.part as Record<string, unknown> | undefined;
    if (typeof ev.sessionID === 'string') out.sessionId = ev.sessionID;
    if (type === 'text' && typeof part?.text === 'string') texts.push(part.text);
    const tokens = part?.tokens as Record<string, unknown> | undefined;
    if (
      type === 'step_finish' &&
      typeof tokens?.input === 'number' &&
      typeof tokens?.output === 'number'
    ) {
      out.usage = { inputTokens: tokens.input, outputTokens: tokens.output };
    }
    const usage = (ev.usage ?? item?.usage) as Record<string, unknown> | undefined;
    if (
      usage &&
      typeof usage.input_tokens === 'number' &&
      typeof usage.output_tokens === 'number'
    ) {
      out.usage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
    }
  }
  out.text = (texts.at(-1) ?? stdout).trim();
  return out;
}

function lastJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    if (Array.isArray(v)) {
      const last = v.filter((x) => x && typeof x === 'object').at(-1);
      return (last as Record<string, unknown>) ?? null;
    }
  } catch {
    // fall through: maybe JSON-lines or noise before the object
  }
  for (const line of trimmed.split('\n').reverse()) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
}
