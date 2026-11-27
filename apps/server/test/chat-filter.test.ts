import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

/**
 * `GET /api/chats` applies the limit in SQL, after filtering. It shares that code path with the
 * MCP `list_chats` tool, so this is the REST half of the regression: filtering an already
 * limited page dropped every match older than the page. Its own database keeps the seeded
 * chats from leaking into other suites, which share one temp env and cannot delete rows.
 */
const env = tempEnv('dt-chatfilter-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await app.ready();
  token = new Auth(env.repo).createDevice('agent', 'chatfilter-test').token;
  worker.start();
});
afterAll(async () => {
  await worker.stop();
  await app.close();
  env.cleanup();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('chat list filtering', () => {
  it('applies the tag filter before the limit', async () => {
    const ingest = async (text: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/ingest',
          headers: auth(),
          payload: { text, channel: 'compose', modeHint: 'quick' },
        })
      ).json() as { chatId: string; runId: string };

    // The two tagged chats are created first, so they sit below a page of `limit: 3` when the
    // newest three chats are all untagged.
    const tagged: string[] = [];
    for (const body of ['Tagged alpha', 'Tagged beta']) {
      const out = await ingest(body);
      await waitFor(() => env.repo.getRun(out.runId)?.status === 'done');
      env.repo.setAutoTags(env.repo.getChat(out.chatId)?.itemId ?? '', ['filter-probe']);
      tagged.push(out.chatId);
    }
    for (const body of ['Untagged one', 'Untagged two', 'Untagged three']) await ingest(body);

    const byTag = (
      await app.inject({
        method: 'GET',
        url: '/api/chats?tag=filter-probe&limit=3',
        headers: auth(),
      })
    ).json() as { id: string }[];
    expect(byTag.map((c) => c.id).sort()).toEqual([...tagged].sort());

    // An unmatched tag is an honest empty answer, not "no filter, return everything".
    const unmatched = (
      await app.inject({ method: 'GET', url: '/api/chats?tag=nope&limit=3', headers: auth() })
    ).json();
    expect(unmatched).toEqual([]);
  });
});
