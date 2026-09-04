/**
 * Talks to `doubletake-media serve` on another machine over HTTP (ADR 0026).
 *
 * Same contract as `MediaWorkerClient`: one request in flight, progress callbacks, timeout,
 * abort. The worker writes into its own data dir and answers with the `out_dir` it used; this
 * client mirrors every asset and vision frame into `<dataDir>/media/<item_id>/` and rewrites the
 * paths, so `runMediaStage` and cloud vision keep reading local files. When both machines see
 * one filesystem at the same path (`--shared-paths` on the worker), `sharedPaths` skips the copy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Config } from '../config/index.js';
import {
  type ExtractOutput,
  type ExtractParams,
  type MediaClient,
  MediaWorkerError,
  type WorkerErrorBody,
  type WorkerProgress,
} from './protocol.js';
import type { WorkerLog } from './worker-client.js';

export interface RemoteWorkerConfig {
  url: string;
  token: string | null;
  sharedPaths: boolean;
}

type ResultLine = Record<string, unknown> & {
  event: 'result';
  ok: boolean;
  out_dir?: string;
  error?: WorkerErrorBody;
};

export class RemoteMediaClient implements MediaClient {
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly base: string;

  constructor(
    _cfg: Config,
    private readonly remote: RemoteWorkerConfig,
    private readonly log: WorkerLog,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = remote.url.replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.remote.token ? { ...extra, authorization: `Bearer ${this.remote.token}` } : extra;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.base}/ping`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { pong?: boolean };
      return body.pong === true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    // Nothing to tear down: the worker is somebody else's process.
    await this.queue.catch(() => undefined);
  }

  extract(
    params: ExtractParams,
    opts: { signal: AbortSignal; timeoutMs?: number; onProgress?: (p: WorkerProgress) => void },
  ): Promise<ExtractOutput> {
    const run = this.queue.then(() => this.doExtract(params, opts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doExtract(
    params: ExtractParams,
    opts: { signal: AbortSignal; timeoutMs?: number; onProgress?: (p: WorkerProgress) => void },
  ): Promise<ExtractOutput> {
    if (opts.signal.aborted) throw new MediaWorkerError('aborted', 'aborted', false);
    const id = `r${++this.seq}`;
    const signals = [opts.signal];
    if (opts.timeoutMs) signals.push(AbortSignal.timeout(opts.timeoutMs));
    const signal = AbortSignal.any(signals);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/extract`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ id, op: 'extract', ...params }),
        signal,
      });
    } catch (e) {
      throw this.mapAbort(e, opts.signal);
    }
    if (res.status === 401)
      throw new MediaWorkerError('unauthorized', 'remote worker rejected the token', false);
    if (!res.ok || !res.body)
      throw new MediaWorkerError('worker_unavailable', `remote worker HTTP ${res.status}`, true);

    let result: ResultLine | null = null;
    try {
      for await (const line of ndjson(res.body)) {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg.id !== undefined && msg.id !== id) continue;
        if (msg.event === 'progress') {
          opts.onProgress?.({
            stage: String(msg.stage ?? ''),
            pct: Number(msg.pct ?? 0),
            detail: String(msg.detail ?? ''),
          });
        } else if (msg.event === 'result') {
          result = msg as ResultLine;
        }
      }
    } catch (e) {
      throw this.mapAbort(e, opts.signal);
    }
    if (!result)
      throw new MediaWorkerError('worker_crashed', 'remote worker closed without a result', true);
    if (!result.ok) {
      const e = result.error ?? {
        code: 'worker_error',
        message: 'unknown error',
        retryable: false,
      };
      throw new MediaWorkerError(e.code, e.message, Boolean(e.retryable));
    }
    const { event: _e, ok: _o, id: _i, out_dir, ...rest } = result;
    const output = rest as unknown as ExtractOutput;
    if (this.remote.sharedPaths || !out_dir) return output;
    return this.mirror(output, String(out_dir), params, signal);
  }

  /** Copy assets and frames from the worker into the local data dir, rewriting paths. */
  private async mirror(
    output: ExtractOutput,
    remoteDir: string,
    params: ExtractParams,
    signal: AbortSignal,
  ): Promise<ExtractOutput> {
    const localDir = params.out_dir;
    fs.mkdirSync(localDir, { recursive: true });
    const map = new Map<string, string>();
    const localFor = (remotePath: string): string => {
      const hit = map.get(remotePath);
      if (hit) return hit;
      const rel = path.posix.relative(toPosix(remoteDir), toPosix(remotePath));
      if (!rel || rel.startsWith('..') || path.posix.isAbsolute(rel))
        throw new MediaWorkerError(
          'worker_error',
          `remote worker returned a path outside its out_dir: ${remotePath}`,
          false,
        );
      const local = path.join(localDir, ...rel.split('/'));
      map.set(remotePath, local);
      return local;
    };
    const jobs: Array<[string, string]> = [];
    const assets = output.assets.map((a) => {
      const local = localFor(a.path);
      jobs.push([a.path, local]);
      return { ...a, path: local };
    });
    const vision_requests = output.vision_requests.map((v) => {
      const local = localFor(v.frame_path);
      jobs.push([v.frame_path, local]);
      return { ...v, frame_path: local };
    });
    const seen = new Set<string>();
    for (const [remote, local] of jobs) {
      if (seen.has(local)) continue;
      seen.add(local);
      await this.download(remote, local, signal);
    }
    this.log.info({ files: seen.size, item: params.item_id }, 'mirrored media from remote worker');
    return { ...output, assets, vision_requests };
  }

  private async download(remotePath: string, local: string, signal: AbortSignal): Promise<void> {
    const url = `${this.base}/files?path=${encodeURIComponent(remotePath)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: this.headers(), signal });
    } catch (e) {
      throw this.mapAbort(e, signal);
    }
    if (!res.ok || !res.body)
      throw new MediaWorkerError(
        'worker_error',
        `remote worker could not serve ${path.basename(remotePath)} (HTTP ${res.status})`,
        true,
      );
    fs.mkdirSync(path.dirname(local), { recursive: true });
    const tmp = `${local}.part`;
    try {
      await pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(tmp));
      fs.renameSync(tmp, local);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw this.mapAbort(e, signal);
    }
  }

  private mapAbort(e: unknown, userSignal: AbortSignal): MediaWorkerError {
    if (e instanceof MediaWorkerError) return e;
    if (userSignal.aborted) return new MediaWorkerError('aborted', 'run aborted', false);
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError')
      return new MediaWorkerError('timeout', 'remote media worker timed out', true);
    return new MediaWorkerError(
      'worker_unavailable',
      `remote media worker unreachable: ${(e as Error)?.message ?? String(e)}`,
      true,
    );
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Yield complete lines from a byte stream. */
async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
      nl = buf.indexOf('\n');
    }
  }
  buf += dec.decode();
  const last = buf.trim();
  if (last) yield last;
}
