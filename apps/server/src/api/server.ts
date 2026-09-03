import fs from 'node:fs';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Mode, RunEvent } from '@doubletake/shared';
import { IngestRequest } from '@doubletake/shared';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, AuthError } from '../auth/index.js';
import type { Config } from '../config/index.js';
import type { Repo } from '../db/repo.js';
import { IngestError, ingest } from '../ingest/index.js';
import type { QueueWorker } from '../queue/worker.js';
import { toChatDetail, toChatSummary, toRunDto } from './dto.js';

export interface ServerDeps {
  cfg: Config;
  repo: Repo;
  worker: QueueWorker;
  brain: BrainAdapter;
  auth?: Auth;
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/setup',
  '/api/setup/status',
  '/api/login',
  '/api/pair/redeem',
]);

/**
 * HTTP + WebSocket API. Every /api route except setup/login/pairing requires a device token.
 * Static PWA is served from `cfg.webDist` when present (same origin, no CORS needed).
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { cfg, repo, worker } = deps;
  const auth = deps.auth ?? new Auth(repo);
  const app = Fastify({ logger: { level: cfg.logLevel }, bodyLimit: 1024 * 1024 });
  await app.register(fastifyWebsocket);

  // ---- auth gate ----
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const pathOnly = req.url.split('?')[0] ?? req.url;
    if (PUBLIC_PATHS.has(pathOnly)) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : tokenFromQuery(req);
    const session = auth.authenticate(bearer);
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    req.session = session;
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    if (err instanceof AuthError || err instanceof IngestError)
      return reply.code(400).send({ error: err.message });
    const e = err as Error & { statusCode?: number };
    app.log.error(e);
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  });

  // ---- public ----
  app.get('/api/health', async () => ({
    ok: true,
    brain: deps.brain.id,
    hasOwner: auth.hasOwner(),
  }));
  app.get('/api/setup/status', async () => ({ hasOwner: auth.hasOwner() }));

  app.post('/api/setup', async (req, reply) => {
    if (auth.hasOwner()) return reply.code(409).send({ error: 'owner already set' });
    const body = z
      .object({ password: z.string(), deviceName: z.string().default('This browser') })
      .parse(req.body);
    await auth.setOwnerPassword(body.password);
    const dev = auth.createDevice(body.deviceName, 'web');
    return { token: dev.token, deviceId: dev.deviceId };
  });

  app.post('/api/login', async (req, reply) => {
    const body = z
      .object({ password: z.string(), deviceName: z.string().default('This browser') })
      .parse(req.body);
    if (!(await auth.verifyOwnerPassword(body.password))) {
      await new Promise((r) => setTimeout(r, 500));
      return reply.code(401).send({ error: 'wrong password' });
    }
    const dev = auth.createDevice(body.deviceName, 'web');
    return { token: dev.token, deviceId: dev.deviceId };
  });

  app.post('/api/pair/redeem', async (req) => {
    const body = z
      .object({
        code: z.string(),
        deviceName: z.string().min(1),
        platform: z.string().default('android'),
      })
      .parse(req.body);
    const dev = auth.redeemPairingCode(body.code, body.deviceName, body.platform);
    return { token: dev.token, deviceId: dev.deviceId };
  });

  // ---- devices / pairing (authenticated) ----
  app.post('/api/pair/start', async () => {
    const { code, expiresAt } = auth.createPairingCode();
    const url = cfg.publicUrl ?? `http://${cfg.bind}:${cfg.port}`;
    return { code, expiresAt, url, qr: JSON.stringify({ url, code }) };
  });
  app.get('/api/devices', async () =>
    repo.listDevices().map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      createdAt: d.createdAt,
    })),
  );
  app.delete('/api/devices/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    repo.revokeDevice(id);
    return { ok: true };
  });

  // ---- ingest ----
  app.post('/api/ingest', async (req, reply) => {
    const body = IngestRequest.parse(req.body);
    const out = ingest(body, { repo, adapterId: deps.brain.id });
    worker.kick();
    return reply.code(202).send({
      itemId: out.item.id,
      chatId: out.chat.id,
      runId: out.run.id,
      deduplicated: out.deduplicated,
    });
  });

  // ---- chats ----
  app.get('/api/chats', async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    let rows = repo.listChats(q.limit);
    if (q.q?.trim()) {
      const ids = new Set(repo.searchFts(ftsQuery(q.q), q.limit));
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    return rows.map((r) => toChatSummary(repo, r.chat, r.item));
  });

  app.get('/api/chats/:id', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    return toChatDetail(repo, chat, item);
  });

  app.post('/api/chats/:id/read', async (req, reply) => {
    const { chat } = loadChat(req, reply, repo) ?? {};
    if (!chat) return;
    repo.markRead(chat.id);
    return { ok: true };
  });

  /** Follow-up question: cheap turn by default. */
  app.post('/api/chats/:id/messages', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    const body = z.object({ content: z.string().min(1).max(8000) }).parse(req.body);
    repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: body.content });
    const run = repo.createRun({
      itemId: item.id,
      chatId: chat.id,
      kind: 'followup',
      mode: (item.modeEffective as Mode | null) ?? 'quick',
      adapter: chat.brainAdapter ?? deps.brain.id,
      userMessage: body.content,
    });
    worker.kick();
    return reply.code(202).send({ runId: run.id });
  });

  /** "Research this": full re-run, optionally with a different mode; resumes the session. */
  app.post('/api/chats/:id/research', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    const body = z
      .object({
        mode: z.enum(['quick', 'standard', 'deep']).optional(),
        note: z.string().max(4000).optional(),
      })
      .parse(req.body ?? {});
    if (body.note?.trim()) {
      repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: body.note });
      repo.updateItem(item.id, { note: [item.note, body.note].filter(Boolean).join('\n\n') });
    }
    const mode = body.mode ?? (item.modeEffective as Mode | null) ?? 'standard';
    repo.updateItem(item.id, { modeRequested: mode, status: 'new' });
    const run = repo.createRun({
      itemId: item.id,
      chatId: chat.id,
      kind: 'research',
      mode,
      adapter: deps.brain.id,
    });
    worker.kick();
    return reply.code(202).send({ runId: run.id });
  });

  app.get('/api/chats/:id/runs/:runId/events', async (req, reply) => {
    const { chat } = loadChat(req, reply, repo) ?? {};
    if (!chat) return;
    const { runId } = z.object({ runId: z.string() }).parse(req.params);
    const run = repo.getRun(runId);
    if (!run || run.chatId !== chat.id) return reply.code(404).send({ error: 'run not found' });
    return {
      run: toRunDto(run),
      events: repo
        .listRunEvents(runId)
        .map((e) => ({ seq: e.seq, type: e.type, payload: JSON.parse(e.payload), at: e.at })),
    };
  });

  app.post('/api/runs/:id/cancel', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return { cancelled: worker.cancel(id) };
  });

  app.get('/api/status', async () => ({
    spentTodayUsd: repo.spentToday(),
    dailyCapUsd: cfg.dailyCapUsd,
    brain: deps.brain.id,
    notesDir: cfg.notesDir,
  }));

  // ---- live events ----
  app.get('/api/events', { websocket: true }, (socket) => {
    const onRun = (e: RunEvent) => socket.send(JSON.stringify({ kind: 'run_event', ...e }));
    const onChat = (chatId: string) =>
      socket.send(JSON.stringify({ kind: 'chat_updated', chatId }));
    worker.on('run_event', onRun);
    worker.on('chat_updated', onChat);
    socket.on('close', () => {
      worker.off('run_event', onRun);
      worker.off('chat_updated', onChat);
    });
  });

  // ---- PWA ----
  if (cfg.webDist && fs.existsSync(cfg.webDist)) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

function tokenFromQuery(req: FastifyRequest): string | undefined {
  const q = req.query as Record<string, unknown> | undefined;
  return typeof q?.token === 'string' ? q.token : undefined;
}

function loadChat(req: FastifyRequest, reply: FastifyReply, repo: Repo) {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const chat = repo.getChat(id);
  const item = chat ? repo.getItem(chat.itemId) : undefined;
  if (!chat || !item) {
    reply.code(404).send({ error: 'chat not found' });
    return undefined;
  }
  return { chat, item };
}

/** Turn free text into a safe FTS5 query: quoted terms, prefix match, no operators. */
export function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replaceAll('"', '')}"*`)
    .join(' ');
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: import('../auth/index.js').Session;
  }
}
