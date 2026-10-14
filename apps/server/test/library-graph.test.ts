import type { EntityKind, LibraryGraph } from '@doubletake/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { buildLibraryGraph, GRAPH_CAPS } from '../src/library/graph.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv } from './helpers.js';

const env = tempEnv('dt-graph-');
const repo = env.repo;
const worker = new QueueWorker(repo, new FakeBrain(), env.cfg); // never started
afterAll(() => env.cleanup());

let n = 0;
function seed(
  opts: { title?: string; entities?: { kind: EntityKind; name: string }[]; tags?: string[] } = {},
) {
  n++;
  const { item, chat } = repo.createItemWithChat(
    { text: `share ${n}`, channel: 'compose', focus: 'whole', modeHint: 'quick' },
    'text',
    null,
    opts.title ?? `Chat ${n}`,
  );
  // Distinct timestamps make "newest chats" a deterministic order for the cap tests.
  repo.updateChat(chat.id, { createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() });
  if (opts.entities)
    repo.replaceEntities(
      item.id,
      `run-${n}`,
      opts.entities.map((e) => ({ ...e, attributes: {}, confidence: 0.9 })),
    );
  if (opts.tags) repo.setAutoTags(item.id, opts.tags);
  return { item, chat };
}

/** Every edge endpoint must be a node in the same payload — no orphans, ever. */
function assertClosed(graph: LibraryGraph) {
  const ids = new Set(graph.nodes.map((nd) => nd.id));
  for (const e of graph.edges) {
    expect(ids.has(e.source), `edge source ${e.source}`).toBe(true);
    expect(ids.has(e.target), `edge target ${e.target}`).toBe(true);
  }
  expect(ids.size).toBe(graph.nodes.length); // node ids are unique
}

describe('buildLibraryGraph', () => {
  it('links things and tags to the chats that mention them and dedupes things by kind+name', async () => {
    const a = seed({
      entities: [
        { kind: 'tool', name: 'Swix LF7' },
        { kind: 'place', name: 'Trysil' },
      ],
      tags: ['wax', 'skiing'],
    });
    const b = seed({ entities: [{ kind: 'tool', name: 'swix lf7' }], tags: ['skiing'] });

    const graph = await buildLibraryGraph(repo);
    assertClosed(graph);

    const byKind = (kind: string) => graph.nodes.filter((nd) => nd.kind === kind);
    expect(byKind('chat')).toHaveLength(2);
    // `Swix LF7` in chat a and `swix lf7` in chat b are the same thing: one hub, two edges.
    // The newest row wins the label, and b was seeded after a.
    const swix = graph.nodes.find((nd) => nd.id === 'entity:tool:swix lf7');
    expect(swix).toMatchObject({
      kind: 'entity',
      label: 'swix lf7',
      kindDetail: { entityKind: 'tool' },
    });
    expect(byKind('entity')).toHaveLength(2); // Swix LF7 + Trysil
    expect(
      byKind('tag')
        .map((nd) => nd.label)
        .sort(),
    ).toEqual(['skiing', 'wax']);
    const swixId = swix?.id ?? '';
    expect(
      graph.edges
        .filter((e) => e.source === swixId)
        .map((e) => e.target)
        .sort(),
    ).toEqual([`chat:${a.chat.id}`, `chat:${b.chat.id}`].sort());
    const skiing = graph.nodes.find((nd) => nd.label === 'skiing');
    expect(graph.edges.filter((e) => e.source === skiing?.id)).toHaveLength(2);
    // Chat nodes carry what the client needs to route.
    expect(graph.nodes.find((nd) => nd.id === `chat:${a.chat.id}`)).toMatchObject({
      kind: 'chat',
      label: 'Chat 1',
      kindDetail: { chatId: a.chat.id, itemId: a.item.id },
    });
  });

  it('caps the graph and skips whatever would float as an orphan beyond the cap', async () => {
    // n is at 2; the next chats get later timestamps, so chats 1-2 end up oldest.
    for (let i = 0; i < GRAPH_CAPS.chats; i++) seed();
    // A thing and a tag that exist only on the oldest chat must not appear at all.
    const oldest = (await repo.listChats(1000)).at(-1);
    if (!oldest) throw new Error('no chats seeded');
    repo.replaceEntities(oldest.item.id, 'run-old', [
      { kind: 'tool', name: 'Orphan Thing', attributes: {}, confidence: 0.9 },
    ]);
    repo.setAutoTags(oldest.item.id, ['orphantag']);

    const newest = seed({
      title: 'Newest',
      entities: Array.from({ length: GRAPH_CAPS.entities + 10 }, (_, i) => ({
        kind: 'product',
        name: `Thing ${String(i).padStart(3, '0')}`,
      })),
    });

    const graph = await buildLibraryGraph(repo);
    assertClosed(graph);

    const byKind = (kind: string) => graph.nodes.filter((nd) => nd.kind === kind);
    expect(byKind('chat')).toHaveLength(GRAPH_CAPS.chats);
    expect(byKind('entity')).toHaveLength(GRAPH_CAPS.entities);
    expect(graph.nodes.find((nd) => nd.label === 'Orphan Thing')).toBeUndefined();
    expect(graph.nodes.find((nd) => nd.label === 'orphantag')).toBeUndefined();
    expect(graph.nodes.find((nd) => nd.id === `chat:${newest.chat.id}`)).toBeDefined();
    // Everything and every tag in the graph hangs off a chat that is in the graph.
    const chatIds = new Set(byKind('chat').map((nd) => nd.id));
    for (const e of graph.edges) expect(chatIds.has(e.target)).toBe(true);
  });
});

describe('GET /api/library/graph', () => {
  it('requires a device token and serves the node/edge payload', async () => {
    const app = await buildServer({
      cfg: env.cfg,
      repo,
      worker,
      brain: new FakeBrain(),
    });
    const unauth = await app.inject({ method: 'GET', url: '/api/library/graph' });
    expect(unauth.statusCode).toBe(401);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'correct horse battery', deviceName: 'test' },
    });
    const token = (setup.json() as { token: string }).token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/library/graph',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LibraryGraph;
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    for (const nd of body.nodes) {
      expect(typeof nd.id).toBe('string');
      expect(['chat', 'entity', 'tag']).toContain(nd.kind);
      expect(typeof nd.label).toBe('string');
    }
    assertClosed(body);
    expect(body.nodes.length).toBeGreaterThan(0);
    await app.close();
  });
});
