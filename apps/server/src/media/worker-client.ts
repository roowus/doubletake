/**
 * Spawns the Python media worker and speaks JSON-lines to it over stdio.
 *
 * One request in flight per worker (extraction is CPU-bound anyway); callers are serialised.
 * A crash rejects the in-flight request with `worker_crashed` (retryable) and the next request
 * respawns the process. `stop()` sends `shutdown` and kills after a grace period.
 * See ADR 0017 and docs/MEDIA-PIPELINE.md.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Config } from '../config/index.js';
import {
  type ExtractOutput,
  type ExtractParams,
  type MediaClient,
  MediaWorkerError,
  type WorkerErrorBody,
  type WorkerProgress,
} from './protocol.js';

/** Subset of Fastify's logger we need (avoids a direct pino dependency). */
export interface WorkerLog {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  onProgress?: ((p: WorkerProgress) => void) | undefined;
}

export class MediaWorkerClient implements MediaClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private logStream: fs.WriteStream | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly log: WorkerLog,
  ) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return this.proc;
    const [cmd, ...args] = this.cfg.media.command;
    if (!cmd)
      throw new MediaWorkerError('worker_unavailable', 'media worker command is empty', false);
    const logDir = path.join(this.cfg.dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    this.logStream ??= fs.createWriteStream(path.join(logDir, 'worker.log'), { flags: 'a' });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DOUBLETAKE_VISION: this.cfg.media.vision,
      DOUBLETAKE_WHISPER_BACKEND: this.cfg.media.whisperBackend,
      PYTHONUNBUFFERED: '1',
    };
    if (this.cfg.media.ytdlpCookiesFromBrowser) {
      env.DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER = this.cfg.media.ytdlpCookiesFromBrowser;
    } else {
      delete env.DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER;
    }
    const proc = spawn(cmd, args, { cwd: this.cfg.media.cwd, env, stdio: 'pipe' });
    this.proc = proc;
    this.log.info({ pid: proc.pid, cmd: this.cfg.media.command.join(' ') }, 'media worker started');
    proc.stderr.on('data', (d: Buffer) => this.logStream?.write(d));
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => this.onLine(line));
    proc.on('error', (e) => this.failAll(new MediaWorkerError('worker_crashed', e.message, true)));
    proc.on('exit', (code, sig) => {
      if (this.proc === proc) this.proc = null;
      if (!this.stopping) this.log.warn({ code, sig }, 'media worker exited');
      this.failAll(
        new MediaWorkerError('worker_crashed', `media worker exited (${code ?? sig})`, true),
      );
    });
    return proc;
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.log.warn({ line: line.slice(0, 200) }, 'media worker: non-JSON stdout line');
      return;
    }
    const id = typeof msg.id === 'string' ? msg.id : null;
    const p = id ? this.pending.get(id) : undefined;
    if (!p) return;
    if (msg.event === 'progress') {
      p.onProgress?.({
        stage: String(msg.stage ?? ''),
        pct: Number(msg.pct ?? 0),
        detail: String(msg.detail ?? ''),
      });
      return;
    }
    if (msg.event === 'result') {
      this.pending.delete(id as string);
      if (msg.ok === true) p.resolve(msg);
      else {
        const e = (msg.error ?? {}) as Partial<WorkerErrorBody>;
        p.reject(
          new MediaWorkerError(
            e.code ?? 'worker_error',
            e.message ?? 'media worker failed',
            Boolean(e.retryable),
          ),
        );
      }
    }
  }

  private request(
    op: string,
    params: Record<string, unknown>,
    opts: { signal?: AbortSignal; onProgress?: (p: WorkerProgress) => void; timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const run = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        if (opts.signal?.aborted) return reject(new MediaWorkerError('aborted', 'aborted', false));
        let proc: ChildProcessWithoutNullStreams;
        try {
          proc = this.ensure();
        } catch (e) {
          return reject(e as Error);
        }
        const id = `${Date.now().toString(36)}-${++this.seq}`;
        let timer: NodeJS.Timeout | null = null;
        const done = (fn: () => void) => {
          if (timer) clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => {
          this.pending.delete(id);
          // The worker cannot cancel mid-stage; drop the process so the next run starts clean.
          proc.kill('SIGTERM');
          done(() => reject(new MediaWorkerError('aborted', 'run aborted', false)));
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        if (opts.timeoutMs) {
          timer = setTimeout(() => {
            this.pending.delete(id);
            proc.kill('SIGTERM');
            done(() =>
              reject(new MediaWorkerError('download_failed', 'media worker timed out', true)),
            );
          }, opts.timeoutMs);
        }
        this.pending.set(id, {
          resolve: (v) => done(() => resolve(v)),
          reject: (e) => done(() => reject(e)),
          onProgress: opts.onProgress,
        });
        proc.stdin.write(`${JSON.stringify({ id, op, ...params })}\n`, (err) => {
          if (err) {
            this.pending.delete(id);
            done(() => reject(new MediaWorkerError('worker_crashed', err.message, true)));
          }
        });
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async extract(
    params: ExtractParams,
    opts: { signal: AbortSignal; onProgress?: (p: WorkerProgress) => void; timeoutMs?: number },
  ): Promise<ExtractOutput> {
    const attempt = () =>
      this.request('extract', params as unknown as Record<string, unknown>, opts);
    let msg: Record<string, unknown>;
    try {
      msg = await attempt();
    } catch (e) {
      // One automatic retry after a crash (docs/MEDIA-PIPELINE.md failure modes).
      if (e instanceof MediaWorkerError && e.code === 'worker_crashed' && !opts.signal.aborted) {
        this.log.warn('media worker crashed; retrying once');
        msg = await attempt();
      } else throw e;
    }
    return {
      assets: (msg.assets as ExtractOutput['assets']) ?? [],
      extractions: (msg.extractions as ExtractOutput['extractions']) ?? [],
      vision_requests: (msg.vision_requests as ExtractOutput['vision_requests']) ?? [],
      warnings: (msg.warnings as string[]) ?? [],
      canonical_url: (msg.canonical_url as string | null) ?? null,
      title: (msg.title as string | null) ?? null,
    };
  }

  async ping(): Promise<boolean> {
    try {
      const r = await this.request('ping', {}, { timeoutMs: 15_000 });
      return r.pong === true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      proc.stdin.write(`${JSON.stringify({ id: 'shutdown', op: 'shutdown' })}\n`);
      proc.stdin.end();
    });
    this.logStream?.end();
  }
}
