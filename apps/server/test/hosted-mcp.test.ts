import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { HostedAuth } from '../src/auth/hosted.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { Repo } from '../src/db/repo.js';
import { MCP_RATE_LIMIT, McpRateLimiter } from '../src/mcp/index.js';
import { QueueWorker } from '../src/queue/worker.js';
import { SecretBox } from '../src/secrets/box.js';
import { FakeBrain, tempEnv } from './helpers.js';

// Hosted MCP (ADR 0032, hosted step 6): dth_ bearer tokens reach /mcp as the user's tenant
// context, MCP tokens are minted like any other session, /api/status carries the hosted
// markers, and /mcp is rate limited per session in hosted mode. Route + tool tests need the
// disposable Postgres at DATABASE_URL_TEST; the limiter test is pure logic on a fake clock.
const url = process.env.DATABASE_URL_TEST;
const run = randomBytes(4).toString('hex');

describe('MCP rate limiter (pure logic, fake clock)', () => {
  it('allows up to max, then 429s with a retry-after that counts down to a refill', () => {
    vi.useFakeTimers();
    try {
      const limiter = new McpRateLimiter({ max: 3, windowMs: 60_000 });
      expect(limiter.take('k')).toMatchObject({ ok: true });
      expect(limiter.take('k')).toMatchObject({ ok: true });
      expect(limiter.take('k')).toMatchObject({ ok: true });
      const refused = limiter.take('k');
      expect(refused.ok).toBe(false);
      // 3 tokens per 60s = one token per 20s.
      expect(refused.retryAfterS).toBe(20);
      vi.advanceTimersByTime(19_000);
      expect(limiter.take('k').ok).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(limiter.take('k')).toMatchObject({ ok: true, retryAfterS: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keys buckets independently per session', () => {
    const limiter = new McpRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.take('session-a').ok).toBe(true);
    expect(limiter.take('session-a').ok).toBe(false);
    expect(limiter.take('session-b').ok).toBe(true);
  });

  it('defaults to the documented 60/min budget', () => {
    const limiter = new McpRateLimiter();
    for (let i = 0; i < MCP_RATE_LIMIT.max; i++) expect(limiter.take('k').ok).toBe(true);
    expect(limiter.take('k').ok).toBe(false);
    expect(limiter.take('k').retryAfterS).toBe(1); // sub-second refill rounds up
  });
});

describe.skipIf(!url)('self-hosted /api/status shape is unchanged', () => {
  it('reports hosted:false and no inviteRequired field', async () => {
    const env = tempEnv('dt-hosted-mcp-status-');
    try {
      const brain = new FakeBrain();
      const worker = new QueueWorker(env.repo, brain, env.cfg);
      const app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
      const token = `dt_${randomBytes(24).toString('base64url')}`;
      const res = await app.inject({
        method: 'GET',
        url: '/api/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401); // gate unchanged: still token-gated, no hosted fields

      const dev = await import('../src/auth/index.js').then(({ Auth }) =>
        new Auth(env.repo).createDevice('web', 'test'),
      );
      const ok = await app.inject({
        method: 'GET',
        url: '/api/status',
        headers: { authorization: `Bearer ${dev.token}` },
      });
      expect(ok.statusCode).toBe(200);
      const body = ok.json() as Record<string, unknown>;
      expect(body.hosted).toBe(false);
      expect('inviteRequired' in body).toBe(false);
      await app.close();
    } finally {
      env.cleanup();
    }
  });
});

describe.skipIf(!url)('hosted MCP tokens, status markers and tenancy (Postgres)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let repo: Repo;
  let app: FastifyInstance;
  let base = '';
  let cleanupEnv: () => void;
  let userA: string;
  let userB: string;
  let browserA: string;
  let tokenA: string;
  let tokenB: string;
  let chatA: string;

  const connect = async (bearer: string): Promise<Client> => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    });
    await client.connect(transport as unknown as Transport);
    return client;
  };

  const textOf = (res: Awaited<ReturnType<Client['callTool']>>): string =>
    (res.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 5 });
    auth = new HostedAuth(opened.db, SecretBox.fromKey(randomBytes(32)));
    repo = new Repo(opened.db as never, null);
    const a = await auth.registerEmail(`mcp-a-${run}@example.com`, 'longenough1');
    const b = await auth.registerEmail(`mcp-b-${run}@example.com`, 'longenough1');
    userA = a.id;
    userB = b.id;
    tokenA = (await auth.createSession(userA, 'mcp', 'agent-a')).token;
    tokenB = (await auth.createSession(userB, 'mcp', 'agent-b')).token;
    browserA = (await auth.createSession(userA, 'browser', 'web')).token;

    // A saves an item (hosted run pipeline is out of scope for the async sweep, so the save
    // goes through the same awaited repo calls ingest would make).
    const urlA = `https://example.test/${run}/alpha`;
    const na = repo.createItemWithChat(
      { url: urlA, channel: 'web_share_target', focus: 'whole', modeHint: 'auto' },
      'web',
      urlA,
      'Alpha page',
      undefined,
      { userId: userA },
    );
    chatA = na.chat.id;
    await repo.getChat(chatA);

    process.env.DOUBLETAKE_HOSTED = '1';
    process.env.DOUBLETAKE_DATABASE_URL = url as string;
    process.env.DOUBLETAKE_INVITE_CODE = 'letmein';
    const keyFile = join(mkdtempSync(join(tmpdir(), 'dt-key-')), 'keyfile');
    writeFileSync(keyFile, randomBytes(32));
    process.env.DOUBLETAKE_MASTER_KEY_FILE = keyFile;
    const env = tempEnv('dt-hosted-mcp-');
    cleanupEnv = env.cleanup;
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    app = await buildServer({ cfg: env.cfg, repo, worker, brain });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    delete process.env.DOUBLETAKE_DATABASE_URL;
    delete process.env.DOUBLETAKE_INVITE_CODE;
    delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
    await app?.close();
    opened?.close();
    cleanupEnv?.();
  });

  it('/api/status carries hosted markers in hosted mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    // /api/status stays behind the token gate: unauthenticated still 401s.
    expect(res.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: `Bearer ${browserA}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as Record<string, unknown>;
    expect(body.hosted).toBe(true);
    expect(body.inviteRequired).toBe(true);
  });

  it('dth_ mcp tokens authenticate /mcp and tools see only the caller tenant (two-user matrix)', async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);

    // A searches and finds their own item.
    const searchA = await a.callTool({ name: 'search_library', arguments: { query: 'alpha' } });
    expect(textOf(searchA)).toContain('Alpha page');
    // B searches the same term: nothing of A's comes back.
    const searchB = await b.callTool({ name: 'search_library', arguments: { query: 'alpha' } });
    expect(textOf(searchB)).not.toContain('Alpha page');

    // list_chats is scoped too.
    const listA = await a.callTool({ name: 'list_chats', arguments: {} });
    expect(textOf(listA)).toContain('Alpha page');
    const listB = await b.callTool({ name: 'list_chats', arguments: {} });
    expect(textOf(listB)).not.toContain('Alpha page');

    // B cannot read A's chat by id.
    const getB = await b.callTool({ name: 'get_chat', arguments: { chat_id: chatA } });
    expect(getB.isError).toBe(true);
    expect(textOf(getB)).toContain('not found');
    await a.close();
    await b.close();
  }, 30_000);

  it('mints MCP tokens via POST /api/account/mcp-tokens, lists and revokes them', async () => {
    const mint = await app.inject({
      method: 'POST',
      url: '/api/account/mcp-tokens',
      headers: { authorization: `Bearer ${browserA}` },
      payload: { label: 'claude desktop' },
    });
    expect(mint.statusCode).toBe(201);
    const body = mint.json() as { token: string; id: string; label: string };
    expect(body.token).toMatch(/^dth_[A-Za-z0-9_-]{43}$/);
    expect(body.label).toBe('claude desktop');
    // The raw token works right away on /mcp and sees user A's library (it IS an A session).
    const c = await connect(body.token);
    const res = await c.callTool({ name: 'list_chats', arguments: {} });
    expect(textOf(res)).toContain('Alpha page');
    await c.close();

    // Listed in GET /api/account like any session.
    const account = await app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { authorization: `Bearer ${browserA}` },
    });
    const sessions = (account.json() as { sessions: { id: string; kind: string }[] }).sessions;
    const listed = sessions.find((s) => s.id === body.id);
    expect(listed?.kind).toBe('mcp');

    // Revoked through the shared sessions route; the token stops working.
    const revoke = await app.inject({
      method: 'POST',
      url: `/api/account/sessions/${body.id}/revoke`,
      headers: { authorization: `Bearer ${browserA}` },
    });
    expect(revoke.json()).toMatchObject({ ok: true });
    const d = connect(body.token);
    await expect(d).rejects.toThrow();
  });

  it('409s beyond 20 active mcp sessions per user', async () => {
    let last = 0;
    // A already holds one active mcp session (tokenA); 19 more fill the cap of 20.
    for (let i = 0; i < 19; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/account/mcp-tokens',
        headers: { authorization: `Bearer ${browserA}` },
        payload: { label: `bulk-${i}` },
      });
      last = res.statusCode;
      if (res.statusCode !== 201) throw new Error(`mint ${i} failed: ${res.body}`);
    }
    expect(last).toBe(201);
    const over = await app.inject({
      method: 'POST',
      url: '/api/account/mcp-tokens',
      headers: { authorization: `Bearer ${browserA}` },
      payload: { label: 'one too many' },
    });
    expect(over.statusCode).toBe(409);
    // Revoking one frees a slot.
    const sessions = (
      await app.inject({
        method: 'GET',
        url: '/api/account',
        headers: { authorization: `Bearer ${browserA}` },
      })
    ).json() as { sessions: { id: string; kind: string; revokedAt: string | null }[] };
    const victim = sessions.sessions.find(
      (s) => s.kind === 'mcp' && !s.revokedAt && s.id !== undefined,
    );
    if (!victim) throw new Error('no mcp session to revoke');
    await app.inject({
      method: 'POST',
      url: `/api/account/sessions/${victim.id}/revoke`,
      headers: { authorization: `Bearer ${browserA}` },
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/account/mcp-tokens',
      headers: { authorization: `Bearer ${browserA}` },
      payload: { label: 'fits again' },
    });
    expect(again.statusCode).toBe(201);
  });

  it('rate limits /mcp per hosted session with retry-after', async () => {
    // The shared budget is 60/min; drain it with cheap unauthenticated-ish requests (they are
    // counted before the transport runs) and expect 429 + retry-after on the 61st.
    let saw429 = 0;
    let retryAfter = '';
    for (let i = 0; i <= MCP_RATE_LIMIT.max; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { jsonrpc: '2.0', id: i, method: 'ping' },
      });
      if (res.statusCode === 429) {
        saw429++;
        retryAfter = res.headers['retry-after'] as string;
      }
    }
    expect(saw429).toBeGreaterThanOrEqual(1);
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    // A different hosted session still has its own bucket.
    const other = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(other.statusCode).not.toBe(429);
  }, 30_000);
});
