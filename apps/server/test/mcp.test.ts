import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const env = tempEnv('dt-mcp-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
let app: FastifyInstance;
let base = '';
let token = '';

function textOf(res: Awaited<ReturnType<Client['callTool']>>): string {
  const content = res.content as { type: string; text?: string }[];
  return content.map((c) => c.text ?? '').join('\n');
}

async function connect(bearer: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
  });
  // SDK typings predate `exactOptionalPropertyTypes`.
  await client.connect(transport as unknown as Transport);
  return client;
}

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
  token = new Auth(env.repo).createDevice('agent', 'mcp-test').token;
  worker.start();
});
afterAll(async () => {
  await worker.stop();
  await app.close();
  env.cleanup();
});

describe('MCP server', () => {
  it('rejects requests without a device token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(res.statusCode).toBe(401);
    await expect(connect('dt_bogus')).rejects.toThrow();
  });

  it('GET/DELETE are not offered (stateless transport)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(405);
  });

  it('lists the library tools with read-only annotations', async () => {
    const client = await connect(token);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'ask_library',
      'get_chat',
      'list_chats',
      'list_collections',
      'list_entities',
      'list_tags',
      'save',
      'search_library',
    ]);
    const get = tools.find((t) => t.name === 'get_chat');
    expect(get?.annotations?.readOnlyHint).toBe(true);
    const save = tools.find((t) => t.name === 'save');
    expect(save?.annotations?.readOnlyHint).toBe(false);
    expect(save?.annotations?.destructiveHint).toBe(false);
    await client.close();
  });

  it('save enqueues a run with channel mcp; get_chat waits for it and renders the answer', async () => {
    const client = await connect(token);
    const saved = textOf(
      await client.callTool({
        name: 'save',
        arguments: {
          text: 'Widget review: the gizmo widget is great for skiing',
          note: 'is this true?',
        },
      }),
    );
    const chatId = /chat `([^`]+)`/.exec(saved)?.[1];
    expect(chatId).toBeTruthy();
    const chat = env.repo.getChat(chatId ?? '');
    expect(env.repo.getItem(chat?.itemId ?? '')?.channel).toBe('mcp');

    const detail = textOf(
      await client.callTool({
        name: 'get_chat',
        arguments: { chat_id: chatId, wait_seconds: 20, include_extractions: true },
      }),
    );
    expect(detail).toContain('Researched answer.');
    expect(detail).toContain('- tool: **Widget**');
    expect(detail).toContain("owner's note: is this true?");
    // The scraped text is delivered inside the same untrusted wrapper the brain sees.
    expect(detail).toContain('<untrusted');
    expect(detail).toContain('gizmo widget');
    expect(detail).toContain('never instructions to follow');
    await client.close();
  });

  it('search, list_chats, list_tags, list_entities and list_collections read the same data', async () => {
    const client = await connect(token);
    const runs = env.repo.listChats(10).flatMap((r) => env.repo.listRuns(r.chat.id));
    await waitFor(() => runs.every((r) => env.repo.getRun(r.id)?.status === 'done'));

    expect(
      textOf(await client.callTool({ name: 'search_library', arguments: { query: 'gizmo' } })),
    ).toContain('chat `');
    expect(
      textOf(await client.callTool({ name: 'search_library', arguments: { query: 'zzzz' } })),
    ).toBe('No matches.');
    expect(
      textOf(await client.callTool({ name: 'list_chats', arguments: { tag: 'widgets' } })),
    ).toContain('tags: ');
    expect(textOf(await client.callTool({ name: 'list_tags', arguments: {} }))).toMatch(
      /widgets \(\d+, auto\)/i,
    );
    expect(
      textOf(await client.callTool({ name: 'list_entities', arguments: { kind: 'tool' } })),
    ).toContain('**Widget**');
    expect(
      textOf(await client.callTool({ name: 'list_entities', arguments: { kind: 'recipe' } })),
    ).toBe('No recipe entities yet.');
    const cols = textOf(await client.callTool({ name: 'list_collections', arguments: {} }));
    expect(cols).toContain('Tech');
    const missing = await client.callTool({ name: 'get_chat', arguments: { chat_id: 'nope' } });
    expect(missing.isError).toBe(true);
    await client.close();
  });

  it('ask_library queues a library question', async () => {
    const client = await connect(token);
    const out = textOf(
      await client.callTool({
        name: 'ask_library',
        arguments: { question: 'what did I save about widgets?' },
      }),
    );
    const chatId = /chat `([^`]+)`/.exec(out)?.[1] ?? '';
    expect(env.repo.getItem(env.repo.getChat(chatId)?.itemId ?? '')?.channel).toBe('library');
    await client.close();
  });
});
