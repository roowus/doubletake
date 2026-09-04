import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { exportKarakeep, type exportMemos, importKarakeep } from '../src/library/interchange.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv } from './helpers.js';

const env = tempEnv('dt-ix-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
let app: FastifyInstance;
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await app.ready();
  token = new Auth(env.repo).createDevice('laptop', 'test').token;
});
afterAll(async () => {
  await app.close();
  env.cleanup();
});

const file = {
  lists: [
    {
      id: 'L1',
      name: 'Ski',
      type: 'manual',
      icon: '⛷️',
      description: null,
      query: null,
      parentId: null,
    },
    {
      id: 'L2',
      name: 'Smart',
      type: 'smart',
      icon: '🧠',
      description: null,
      query: 'is:fav',
      parentId: null,
    },
  ],
  bookmarks: [
    {
      createdAt: 1_700_000_000,
      title: 'Wax guide',
      tags: ['Skiing', 'gear'],
      lists: ['L1', 'L2'],
      content: { type: 'link', url: 'https://www.youtube.com/watch?v=abc123def45' },
      note: 'is this legit?',
      archived: false,
    },
    {
      createdAt: 1_700_000_100,
      title: null,
      tags: [],
      lists: [],
      content: { type: 'text', text: 'Remember: hot wax, then scrape.' },
      note: null,
      archived: false,
    },
    {
      createdAt: 1_700_000_200,
      title: 'asset',
      tags: [],
      lists: [],
      content: null,
      note: null,
      archived: false,
    },
  ],
};

describe('Karakeep import', () => {
  it('rejects files that are not a Karakeep export', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/karakeep',
      headers: auth(),
      payload: { nope: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates items, tags and manual collections without queueing runs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/karakeep',
      headers: auth(),
      payload: file,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, skipped: 1, collections: 1, runs: 0 });

    const items = env.repo.listItems();
    expect(items).toHaveLength(2);
    const link = items.find((i) => i.platform === 'youtube');
    const text = items.find((i) => i.platform === 'text');
    expect(link?.title).toBe('Wax guide');
    expect(link?.channel).toBe('import');
    expect(link?.note).toBe('is this legit?');
    expect(link?.status).toBe('new');
    expect(link?.createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(env.repo.listTags(link?.id ?? '')).toEqual(expect.arrayContaining(['skiing', 'gear']));
    expect(text?.title).toContain('Remember');
    // Only the manual list became a collection; the smart one is skipped.
    const cols = env.repo.listCollections(true).filter((c) => c.manual);
    expect(cols.map((c) => c.name)).toEqual(['Ski']);
    expect(env.repo.collectionItemIds(cols[0]?.id ?? '')).toEqual([link?.id]);
    // Free: nothing for the worker to do.
    for (const i of items) {
      const chat = env.repo.getChatByItem(i.id);
      expect(env.repo.listRuns(chat?.id ?? '')).toHaveLength(0);
    }
    // The note is searchable straight away.
    expect(env.repo.searchFts('legit')).toEqual([link?.id]);
  });

  it('skips permalinks already in the library, at any age', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/karakeep',
      headers: auth(),
      payload: { bookmarks: [file.bookmarks[0]] },
    });
    expect(res.json()).toEqual({ imported: 0, skipped: 1, collections: 0, runs: 0 });
    expect(env.repo.listItems()).toHaveLength(2);
  });

  it('queues a run per item only when asked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/karakeep?research=quick',
      headers: auth(),
      payload: {
        bookmarks: [
          {
            createdAt: 1_700_000_300,
            title: 'Reddit thread',
            tags: [],
            lists: [],
            content: { type: 'link', url: 'https://www.reddit.com/r/skiing/comments/zzz999/wax/' },
            note: null,
            archived: false,
          },
        ],
      },
    });
    expect(res.json()).toMatchObject({ imported: 1, runs: 1 });
    const item = env.repo.listItems().find((i) => i.platform === 'reddit');
    const chat = env.repo.getChatByItem(item?.id ?? '');
    const runs = env.repo.listRuns(chat?.id ?? '');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.mode).toBe('quick');
    expect(runs[0]?.status).toBe('queued');
  });
});

describe('export', () => {
  it('produces a Karakeep file that re-imports into an empty library unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/karakeep', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('doubletake-karakeep-');
    const out = res.json() as ReturnType<typeof exportKarakeep>;
    expect(out.bookmarks).toHaveLength(3);
    expect(out.lists?.map((l) => l.name)).toEqual(['Ski']);
    const wax = out.bookmarks.find((b) => b.title === 'Wax guide');
    expect(wax?.content).toEqual({
      type: 'link',
      url: 'https://www.youtube.com/watch?v=abc123def45',
    });
    expect(wax?.tags.sort()).toEqual(['gear', 'skiing']);
    expect(wax?.lists).toEqual([out.lists?.[0]?.id]);
    expect(wax?.createdAt).toBe(1_700_000_000);
    expect(wax?.note).toBe('is this legit?');

    const other = tempEnv('dt-ix2-');
    try {
      const summary = importKarakeep(other.repo, out);
      expect(summary).toEqual({ imported: 3, skipped: 0, collections: 1, runs: 0 });
      const again = exportKarakeep(other.repo);
      const strip = (b: (typeof out.bookmarks)[number]) => ({ ...b, lists: b.lists.length });
      expect(again.bookmarks.map(strip)).toEqual(out.bookmarks.map(strip));
    } finally {
      other.cleanup();
    }
  });

  it('renders Memos-shaped markdown with #tags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/memos', headers: auth() });
    expect(res.statusCode).toBe(200);
    const out = res.json() as ReturnType<typeof exportMemos>;
    expect(out.memos).toHaveLength(3);
    const wax = out.memos.find((m) => m.content.startsWith('## Wax guide'));
    expect(wax?.content).toContain('https://www.youtube.com/watch?v=abc123def45');
    expect(wax?.content).toContain('> is this legit?');
    expect(wax?.content).toMatch(/#gear #skiing|#skiing #gear/);
    expect(wax?.visibility).toBe('PRIVATE');
    expect(wax?.create_time).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('requires a device token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/export/karakeep' });
    expect(res.statusCode).toBe(401);
  });
});
