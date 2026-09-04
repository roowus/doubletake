import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageInput } from '@doubletake/brain-sdk';
import { renderUntrustedAll } from '@doubletake/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDescriptions } from '../src/brains/claude-agent-sdk.js';
import { ingest } from '../src/ingest/index.js';
import type { MediaWorkerError } from '../src/media/protocol.js';
import { budgetFor } from '../src/media/stage.js';
import { MediaWorkerClient } from '../src/media/worker-client.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const FAKE_WORKER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/fake-worker.py',
);
const silentLog = { info() {}, warn() {} };

class VisionBrain extends FakeBrain {
  images: ImageInput[] = [];
  async describeImages(images: ImageInput[], _prompt: string): Promise<string[]> {
    this.images.push(...images);
    return images.map(() => 'A man standing in front of elephants.');
  }
}

const env = tempEnv('dt-media-');
env.cfg.media = {
  enabled: true,
  command: ['python3', FAKE_WORKER],
  cwd: env.root,
  vision: 'cloud',
  whisperBackend: 'off',
  ytdlpCookiesFromBrowser: null,
  remote: null,
};
const brain = new VisionBrain();
const media = new MediaWorkerClient(env.cfg, silentLog);
const worker = new QueueWorker(env.repo, brain, env.cfg, media);
const deps = { repo: env.repo, adapterId: brain.id };

afterAll(async () => {
  await worker.stop();
  await media.stop();
  env.cleanup();
});

describe('media worker client', () => {
  it('answers ping through the real JSON-lines transport', async () => {
    expect(await media.ping()).toBe(true);
  });

  it('surfaces worker error results as MediaWorkerError', async () => {
    const ac = new AbortController();
    await expect(
      media.extract(
        {
          item_id: 'x',
          url: 'https://example.com/fail',
          platform: 'youtube',
          focus: 'whole',
          mode: 'quick',
          hints: {},
          budget: budgetFor('quick', 'whole'),
          out_dir: path.join(env.cfg.dataDir, 'media', 'x'),
        },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({
      code: 'download_failed',
      retryable: true,
    } satisfies Partial<MediaWorkerError>);
  });

  it('kills the worker and reports a retryable timeout when a request exceeds its budget', async () => {
    const ac = new AbortController();
    await expect(
      media.extract(
        {
          item_id: 's',
          url: 'https://example.com/slow',
          platform: 'youtube',
          focus: 'whole',
          mode: 'quick',
          hints: {},
          budget: budgetFor('quick', 'whole'),
          out_dir: path.join(env.cfg.dataDir, 'media', 's'),
        },
        { signal: ac.signal, timeoutMs: 300 },
      ),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    } satisfies Partial<MediaWorkerError>);
    // The next request gets a fresh process.
    expect(await media.ping()).toBe(true);
  });

  it('restarts a crashed worker and retries the request once', async () => {
    const ac = new AbortController();
    const progress: string[] = [];
    const out = await media.extract(
      {
        item_id: 'c',
        url: 'https://example.com/crash',
        platform: 'youtube',
        focus: 'whole',
        mode: 'quick',
        hints: {},
        budget: budgetFor('quick', 'whole'),
        out_dir: path.join(env.cfg.dataDir, 'media', 'c'),
      },
      { signal: ac.signal, onProgress: (p) => progress.push(p.stage) },
    );
    expect(out.title).toBe('Me at the zoo');
    expect(progress).toEqual(['download']);
    expect(await media.ping()).toBe(true);
  });
});

describe('media stage in a research run', () => {
  it('stores assets + extractions, wraps them untrusted, fulfils vision, and the brain ignores injected instructions', async () => {
    worker.start();
    const events: Record<string, unknown>[] = [];
    worker.on('run_event', (e) => events.push(e.payload));
    const out = ingest(
      {
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        note: 'quick: what animals are these',
        channel: 'compose',
        focus: 'whole',
        modeHint: 'quick',
      },
      deps,
    );
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'done', 15_000);

    // Assets stored with dataDir-relative paths; extractions carry duration_ms.
    const assets = env.repo.listMediaAssets(out.item.id);
    expect(assets.map((a) => a.kind).sort()).toEqual(['frame', 'video']);
    expect(assets.every((a) => !path.isAbsolute(a.path))).toBe(true);
    expect(assets.find((a) => a.kind === 'frame')?.frameTsS).toBe(0);
    const kinds = env.repo
      .listExtractions(out.item.id)
      .map((x) => x.kind)
      .sort();
    expect(kinds).toEqual(expect.arrayContaining(['transcript', 'comments', 'frame_description']));
    expect(
      env.repo.listExtractions(out.item.id).find((x) => x.kind === 'transcript')?.durationMs,
    ).toBe(5);

    // Vision fulfilled by the brain, description stored with the brain's id as tool.
    expect(brain.images).toHaveLength(1);
    expect(brain.images[0]?.mimeType).toBe('image/jpeg');
    const fd = env.repo.listExtractions(out.item.id).find((x) => x.kind === 'frame_description');
    expect(fd?.tool).toBe('fake');

    // The brief: every media extraction is inside an <untrusted> block, injected text included.
    const call = brain.calls.find((c) => c.kind === 'run');
    const blocks = call?.brief?.untrusted ?? [];
    expect(blocks.map((b) => b.kind)).toEqual(
      expect.arrayContaining(['transcript', 'comments', 'frame_description']),
    );
    const rendered = renderUntrustedAll(blocks);
    const injected = rendered.indexOf('IGNORE ALL PREVIOUS INSTRUCTIONS');
    expect(injected).toBeGreaterThan(-1);
    const open = rendered.lastIndexOf('<untrusted ', injected);
    const close = rendered.indexOf('</untrusted>', injected);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(injected);
    expect(rendered.slice(open, close)).toContain('kind="transcript"');
    // and the answer is the brain's own, not the injected payload
    const msgs = env.repo.listMessages(out.chat.id);
    expect(msgs.at(-1)?.content).toBe('Researched answer.');
    expect(msgs.at(-1)?.content).not.toContain('PWNED');

    // Title and canonical URL written back; progress + warnings surfaced as status events.
    const item = env.repo.getItem(out.item.id);
    expect(item?.title).toBe('Me at the zoo');
    expect(events.some((p) => p.phase === 'media' && p.stage === 'download')).toBe(true);
    expect(events.some((p) => p.phase === 'warning' && p.message === 'fake warning')).toBe(true);
    // The frame file exists where the asset row says.
    const frame = assets.find((a) => a.kind === 'frame');
    expect(fs.existsSync(path.join(env.cfg.dataDir, frame?.path ?? ''))).toBe(true);
  });

  it('a failed media stage degrades to a warning and the run still finishes', async () => {
    const out = ingest(
      {
        url: 'https://www.youtube.com/watch?v=failfail',
        channel: 'compose',
        focus: 'whole',
        modeHint: 'quick',
      },
      deps,
    );
    const events: Record<string, unknown>[] = [];
    worker.on('run_event', (e) => events.push(e.payload));
    worker.kick();
    await waitFor(() => env.repo.getRun(out.run.id)?.status === 'done', 15_000);
    expect(
      events.some(
        (p) =>
          p.phase === 'warning' && String(p.message).startsWith('Media pipeline (download_failed)'),
      ),
    ).toBe(true);
    expect(env.repo.listMediaAssets(out.item.id)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('budgetFor doubles comments when focus is comments', () => {
    expect(budgetFor('standard', 'whole')).toMatchObject({
      frames: 12,
      vision_frames: 6,
      comments: 100,
    });
    expect(budgetFor('quick', 'comments').comments).toBe(40);
  });

  it('parseDescriptions tolerates fences and pads', () => {
    expect(parseDescriptions('```json\n["a","b"]\n```', 3)).toEqual(['a', 'b', '']);
    expect(parseDescriptions('just prose', 1)).toEqual(['just prose']);
    expect(parseDescriptions('["a","b","c"]', 2)).toEqual(['a', 'b']);
  });
});
