import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { MediaWorkerError } from '../src/media/protocol.js';
import { RemoteMediaClient } from '../src/media/remote-client.js';
import { tempEnv } from './helpers.js';

const silentLog = { info() {}, warn() {} };
const env = tempEnv('dt-remote-media-');
const remoteRoot = fs.mkdtempSync(path.join(env.root, 'remote-'));
const seen: { auth: string[]; extracts: Record<string, unknown>[] } = { auth: [], extracts: [] };
let mode: 'ok' | 'error' | 'hang' | 'drop' = 'ok';

/** Stand-in for `doubletake-media serve`: same routes, same line shapes. */
const fake = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  seen.auth.push(req.headers.authorization ?? '');
  if (req.headers.authorization !== 'Bearer s3cret') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: 'unauthorized', message: 'no', retryable: false },
      }),
    );
    return;
  }
  if (req.method === 'GET' && url.pathname === '/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pong: true }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/files') {
    const p = url.searchParams.get('path') ?? '';
    if (!p.startsWith(remoteRoot) || !fs.existsSync(p)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/extract') {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const params = JSON.parse(body) as Record<string, unknown>;
      seen.extracts.push(params);
      if (mode === 'hang') return; // never answers; client timeout must fire
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(
        `${JSON.stringify({ id: params.id, event: 'progress', stage: 'download', pct: 10, detail: 'yt-dlp' })}\n`,
      );
      if (mode === 'drop') {
        res.destroy();
        return;
      }
      if (mode === 'error') {
        res.end(
          `${JSON.stringify({ id: params.id, event: 'result', ok: false, error: { code: 'download_failed', message: 'private', retryable: false } })}\n`,
        );
        return;
      }
      const outDir = path.join(remoteRoot, 'media', String(params.item_id));
      fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'source.mp4'), 'video-bytes');
      fs.writeFileSync(path.join(outDir, 'frames', 'f0.jpg'), 'jpeg-bytes');
      res.end(
        `${JSON.stringify({
          id: params.id,
          event: 'result',
          ok: true,
          out_dir: outDir,
          assets: [
            {
              kind: 'video',
              path: path.join(outDir, 'source.mp4'),
              sha256: 'a',
              bytes: 11,
              source: 'ytdlp',
            },
            {
              kind: 'frame',
              path: path.join(outDir, 'frames', 'f0.jpg'),
              sha256: 'b',
              bytes: 10,
              frame_ts_s: 0,
              source: 'ffmpeg',
            },
          ],
          extractions: [
            { kind: 'transcript', tool: 'whisper', duration_ms: 5, content: { text: 'hi' } },
          ],
          vision_requests: [{ frame_path: path.join(outDir, 'frames', 'f0.jpg'), ts: 0 }],
          warnings: [],
          canonical_url: 'https://example.com/v',
          title: 'Remote title',
        })}\n`,
      );
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const port = (fake.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  await new Promise((r) => fake.close(r));
  env.cleanup();
});

function client(over: Partial<{ token: string | null; sharedPaths: boolean; url: string }> = {}) {
  return new RemoteMediaClient(
    env.cfg,
    { url: base, token: 's3cret', sharedPaths: false, ...over },
    silentLog,
  );
}

const params = (itemId: string) => ({
  item_id: itemId,
  url: 'https://example.com/v',
  platform: 'web',
  focus: 'whole',
  mode: 'standard' as const,
  hints: {},
  budget: { frames: 4, vision_frames: 2, comments: 20, transcribe_model: 'standard' as const },
  out_dir: path.join(env.cfg.dataDir, 'media', itemId),
});

describe('RemoteMediaClient', () => {
  it('pings with the bearer token and fails closed without it', async () => {
    expect(await client().ping()).toBe(true);
    expect(await client({ token: null }).ping()).toBe(false);
    expect(await client({ url: 'http://127.0.0.1:1' }).ping()).toBe(false);
  });

  it('streams progress, then mirrors assets and frames into the local data dir', async () => {
    mode = 'ok';
    const progress: string[] = [];
    const out = await client().extract(params('01A'), {
      signal: new AbortController().signal,
      timeoutMs: 5000,
      onProgress: (p) => progress.push(`${p.stage}:${p.pct}`),
    });
    expect(progress).toEqual(['download:10']);
    expect(out.title).toBe('Remote title');
    expect(out.extractions[0]?.kind).toBe('transcript');
    const localDir = path.join(env.cfg.dataDir, 'media', '01A');
    expect(out.assets.map((a) => a.path)).toEqual([
      path.join(localDir, 'source.mp4'),
      path.join(localDir, 'frames', 'f0.jpg'),
    ]);
    expect(out.vision_requests[0]?.frame_path).toBe(path.join(localDir, 'frames', 'f0.jpg'));
    expect(fs.readFileSync(path.join(localDir, 'source.mp4'), 'utf8')).toBe('video-bytes');
    expect(fs.readFileSync(path.join(localDir, 'frames', 'f0.jpg'), 'utf8')).toBe('jpeg-bytes');
    expect(fs.existsSync(path.join(localDir, 'source.mp4.part'))).toBe(false);
    // the worker received the server's out_dir and a request id
    const sent = seen.extracts.at(-1) as { out_dir: string; id: string; op: string };
    expect(sent.op).toBe('extract');
    expect(sent.out_dir).toBe(path.join(env.cfg.dataDir, 'media', '01A'));
    expect(sent.id).toMatch(/^r\d+$/);
  });

  it('keeps remote paths verbatim when the filesystem is shared', async () => {
    mode = 'ok';
    const out = await client({ sharedPaths: true }).extract(params('01B'), {
      signal: new AbortController().signal,
    });
    expect(out.assets[0]?.path).toBe(path.join(remoteRoot, 'media', '01B', 'source.mp4'));
    expect(fs.existsSync(path.join(env.cfg.dataDir, 'media', '01B'))).toBe(false);
  });

  it('surfaces worker errors with their code', async () => {
    mode = 'error';
    const err = (await client()
      .extract(params('01C'), { signal: new AbortController().signal })
      .catch((e) => e)) as MediaWorkerError;
    expect(err.name).toBe('MediaWorkerError');
    expect(err.code).toBe('download_failed');
    expect(err.retryable).toBe(false);
  });

  it('maps a dropped connection to a retryable worker_crashed', async () => {
    mode = 'drop';
    const err = (await client()
      .extract(params('01D'), { signal: new AbortController().signal })
      .catch((e) => e)) as MediaWorkerError;
    expect(['worker_crashed', 'worker_unavailable']).toContain(err.code);
    expect(err.retryable).toBe(true);
  });

  it('times out and aborts', async () => {
    mode = 'hang';
    const err = (await client()
      .extract(params('01E'), { signal: new AbortController().signal, timeoutMs: 200 })
      .catch((e) => e)) as MediaWorkerError;
    expect(err.code).toBe('timeout');
    expect(err.retryable).toBe(true);
    const ac = new AbortController();
    const p = client().extract(params('01F'), { signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 50);
    const err2 = (await p.catch((e) => e)) as MediaWorkerError;
    expect(err2.code).toBe('aborted');
  });

  it('rejects the token being wrong as non-retryable', async () => {
    mode = 'ok';
    const err = (await client({ token: 'nope' })
      .extract(params('01G'), { signal: new AbortController().signal })
      .catch((e) => e)) as MediaWorkerError;
    expect(err.code).toBe('unauthorized');
    expect(err.retryable).toBe(false);
  });
});
