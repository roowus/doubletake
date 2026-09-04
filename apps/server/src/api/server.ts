import fs from 'node:fs';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Mode, RunEvent } from '@doubletake/shared';
import { IngestRequest } from '@doubletake/shared';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Auth, AuthError } from '../auth/index.js';
import type { InstagramChannel } from '../channels/instagram/index.js';
import type { Config } from '../config/index.js';
import type { Repo } from '../db/repo.js';
import { IngestError, ingest } from '../ingest/index.js';
import {
  listCollections,
  resolveCollection,
  resolveQuery,
  seedAutoCollections,
} from '../library/collections.js';
import type { NotificationHub } from '../notify/hub.js';
import { type DigestGate, parseHHMM, validTimeZone } from '../notify/quiet.js';
import type { QueueWorker } from '../queue/worker.js';
import { toChatDetail, toChatSummary, toEntityHit, toRunDto } from './dto.js';
import { ftsQuery } from './fts.js';
import { hostAllowed, IG_PUBLIC_PATHS, registerInstagramRoutes } from './instagram.js';

export interface ServerDeps {
  cfg: Config;
  repo: Repo;
  worker: QueueWorker;
  /** Default adapter; per-mode bindings are read from `worker.brains`. */
  brain: BrainAdapter;
  auth?: Auth;
  /** Push fan-out; when absent the push routes report `enabled: false`. */
  hub?: NotificationHub;
  vapidPublicKey?: string;
  /** Quiet-hours gate in front of the hub; when absent quiet hours report disabled. */
  digest?: DigestGate;
  /** Instagram channel; when absent the webhook and /api/ig routes are not registered. */
  ig?: InstagramChannel;
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/setup',
  '/api/setup/status',
  '/api/login',
  '/api/pair/redeem',
  ...IG_PUBLIC_PATHS,
]);

/**
 * HTTP + WebSocket API. Every /api route except setup/login/pairing requires a device token.
 * Static PWA is served from `cfg.webDist` when present (same origin, no CORS needed).
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { cfg, repo, worker } = deps;
  seedAutoCollections(repo);
  const auth = deps.auth ?? new Auth(repo);
  const app = Fastify({ logger: { level: cfg.logLevel }, bodyLimit: 1024 * 1024 });
  await app.register(fastifyWebsocket);
  // The Capacitor WebView runs on its own origin (https://localhost); the API is token-gated,
  // so allowing cross-origin calls adds no exposure.
  await app.register(fastifyCors, {
    origin: ['https://localhost', 'http://localhost', 'capacitor://localhost'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  // ---- public-host guard + auth gate ----
  app.addHook('onRequest', async (req, reply) => {
    // Through the tunnel hostname only the Instagram webhook exists (docs/DEPLOYMENT.md).
    if (!hostAllowed(cfg, req.headers.host, req.url))
      return reply.code(404).send({ error: 'not found' });
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

  if (deps.ig) await registerInstagramRoutes(app, { cfg, ig: deps.ig });

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
    const out = ingest(body, { repo, adapterFor: (m) => worker.brains.forMode(m) });
    worker.kick();
    return reply.code(202).send({
      itemId: out.item.id,
      chatId: out.chat.id,
      runId: out.run.id,
      deduplicated: out.deduplicated,
    });
  });

  // ---- chats ----
  app.get('/api/chats', async (req, reply) => {
    const q = z
      .object({
        q: z.string().optional(),
        tag: z.string().optional(),
        collection: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    let rows = repo.listChats(q.limit);
    if (q.collection) {
      const c = repo.getCollection(q.collection);
      if (!c) return reply.code(404).send({ error: 'collection not found' });
      const ids = resolveCollection(repo, c);
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    if (q.q?.trim()) {
      const ids = new Set(repo.searchFts(ftsQuery(q.q), q.limit));
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    if (q.tag?.trim()) {
      const ids = new Set(repo.itemIdsByTag(q.tag));
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    return rows.map((r) => toChatSummary(repo, r.chat, r.item));
  });

  app.get('/api/tags', async () => repo.listAllTags());

  // ---- collections + entity views (M6) ----

  app.get('/api/collections', async (req) => {
    const q = z
      .object({
        hidden: z.coerce.boolean().default(false),
        all: z.coerce.boolean().default(false),
      })
      .parse(req.query);
    return listCollections(repo, q.hidden, !q.all);
  });

  app.post('/api/collections', async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        // Omit for a manual (hand-picked) collection; give a query for a saved search.
        query: z.string().trim().max(200).optional(),
      })
      .parse(req.body);
    const manual = !body.query;
    const id = repo.createCollection({
      name: body.name,
      query: body.query ?? '',
      manual,
      auto: false,
    });
    return reply.code(201).send(listCollections(repo, true, false).find((c) => c.id === id));
  });

  app.post('/api/collections/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = repo.getCollection(id);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        query: z.string().trim().max(200).optional(),
        hidden: z.boolean().optional(),
      })
      .parse(req.body);
    if (c.auto && body.query !== undefined)
      return reply.code(400).send({ error: 'auto collections keep their query' });
    repo.updateCollection(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.query !== undefined && !c.manual ? { query: body.query } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    });
    return listCollections(repo, true, false).find((x) => x.id === id);
  });

  app.delete('/api/collections/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = repo.getCollection(id);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    if (c.auto) return reply.code(400).send({ error: 'auto collections can only be hidden' });
    repo.deleteCollection(id);
    return { ok: true };
  });

  app.post('/api/collections/:id/items', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const c = repo.getCollection(id);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    if (!c.manual) return reply.code(400).send({ error: 'only manual collections take items' });
    const body = z.object({ chatId: z.string() }).parse(req.body);
    const chat = repo.getChat(body.chatId);
    if (!chat) return reply.code(404).send({ error: 'chat not found' });
    repo.addCollectionItem(id, chat.itemId);
    worker.emit('chat_updated', chat.id);
    return { count: repo.collectionItemIds(id).length };
  });

  app.delete('/api/collections/:id/items/:chatId', async (req, reply) => {
    const { id, chatId } = z.object({ id: z.string(), chatId: z.string() }).parse(req.params);
    const c = repo.getCollection(id);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    const chat = repo.getChat(chatId);
    if (!chat) return reply.code(404).send({ error: 'chat not found' });
    repo.removeCollectionItem(id, chat.itemId);
    worker.emit('chat_updated', chat.id);
    return { count: repo.collectionItemIds(id).length };
  });

  /** Which manual collections hold this chat (for the chat header picker). */
  app.get('/api/chats/:id/collections', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    return { collectionIds: repo.collectionsForItem(item.id) };
  });

  /** Every extracted entity of one kind across the library: places, recipes, products, tools… */
  app.get('/api/entities', async (req) => {
    const q = z
      .object({
        kind: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
      })
      .parse(req.query);
    return repo.listEntitiesByKind(q.kind.toLowerCase(), q.limit).map((r) => toEntityHit(r));
  });

  /** Preview what a query would match without saving it. */
  app.get('/api/collections/preview', async (req) => {
    const q = z.object({ query: z.string() }).parse(req.query);
    return { count: resolveQuery(repo, q.query).length };
  });

  app.post('/api/chats/:id/tags', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    const body = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
    const name = repo.addManualTag(item.id, body.name);
    if (!name) return reply.code(400).send({ error: 'empty tag' });
    worker.reindex(item, chat.id, item.modeEffective ?? 'quick');
    worker.emit('chat_updated', chat.id);
    return { tags: repo.listTags(item.id) };
  });

  app.delete('/api/chats/:id/tags/:name', async (req, reply) => {
    const { chat, item } = loadChat(req, reply, repo) ?? {};
    if (!chat || !item) return;
    const { name } = z.object({ name: z.string().min(1) }).parse(req.params);
    repo.removeTag(item.id, decodeURIComponent(name));
    worker.reindex(item, chat.id, item.modeEffective ?? 'quick');
    worker.emit('chat_updated', chat.id);
    return { tags: repo.listTags(item.id) };
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
    const bound = worker.brains.forMode(mode);
    const run = repo.createRun({
      itemId: item.id,
      chatId: chat.id,
      kind: 'research',
      mode,
      adapter: bound.adapter.id,
      model: bound.model,
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

  app.get('/api/status', async (req) => {
    const { health } = z
      .object({ health: z.enum(['cached', 'refresh', 'skip']).default('cached') })
      .parse(req.query);
    return {
      spentTodayUsd: repo.spentToday(),
      dailyCapUsd: cfg.dailyCapUsd,
      brain: deps.brain.id,
      brains: health === 'skip' ? [] : await worker.brains.healthchecks(health === 'refresh'),
      notesDir: cfg.notesDir,
      push: {
        kinds: deps.hub?.kinds() ?? [],
        channels: deps.hub?.channels() ?? [],
        vapidPublicKey: deps.vapidPublicKey ?? null,
        quietHours: deps.digest?.quietHours() ?? null,
        pending: deps.digest?.pendingCount() ?? 0,
      },
    };
  });

  // ---- push subscriptions (per device) ----
  const PushSubscribe = z.object({
    kind: z.enum(['webpush', 'fcm']),
    endpoint: z.string().min(1),
    keys: z.object({ p256dh: z.string(), auth: z.string() }).optional(),
  });
  app.post('/api/push/subscribe', async (req, reply) => {
    const body = PushSubscribe.parse(req.body);
    if (body.kind === 'webpush' && !body.keys)
      return reply.code(400).send({ error: 'webpush subscriptions need keys' });
    if (!deps.hub?.has(body.kind))
      return reply.code(409).send({ error: `${body.kind} is not configured on this server` });
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    const row = repo.upsertPushSubscription(
      session.deviceId,
      body.kind,
      body.endpoint,
      body.keys ? JSON.stringify(body.keys) : null,
    );
    return { id: row.id };
  });
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(req.body);
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    return { removed: repo.deletePushSubscriptionByEndpoint(session.deviceId, endpoint) };
  });
  app.get('/api/push/subscriptions', async (req, reply) => {
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    return repo
      .listPushSubscriptionsForDevice(session.deviceId)
      .map((r) => ({ id: r.id, kind: r.kind, endpoint: r.endpoint, createdAt: r.createdAt }));
  });
  /** Sends a test notification to this device's subscriptions only. */
  app.post('/api/push/test', async (req, reply) => {
    const session = req.session;
    if (!session || !deps.hub) return reply.code(409).send({ error: 'push not configured' });
    const mine = new Set(repo.listPushSubscriptionsForDevice(session.deviceId).map((r) => r.id));
    if (mine.size === 0) return reply.code(404).send({ error: 'this device has no subscription' });
    const result = await deps.hub.notify(
      {
        title: 'Doubletake',
        body: 'Test notification. Tap to open.',
        chatId: '',
        url: '/',
        tag: 'test',
      },
      { onlySubscriptionIds: mine },
    );
    return result;
  });

  /** Owner channels (ntfy, Telegram) get a test message; 404 when none is configured. */
  app.post('/api/push/channels/test', async (_req, reply) => {
    if (!deps.hub || deps.hub.channels().length === 0)
      return reply.code(404).send({ error: 'no notification channels configured' });
    return deps.hub.broadcast({
      title: 'Doubletake',
      body: 'Test notification. Tap to open.',
      chatId: '',
      url: cfg.publicUrl ? `${cfg.publicUrl.replace(/\/$/, '')}/` : '/',
      tag: 'test',
    });
  });

  // ---- quiet hours / digest (ADR 0020) ----
  const QuietHoursBody = z.object({
    enabled: z.boolean(),
    start: z.string().refine((v) => parseHHMM(v) !== null, 'HH:MM expected'),
    end: z.string().refine((v) => parseHHMM(v) !== null, 'HH:MM expected'),
    timeZone: z.string().refine(validTimeZone, 'unknown IANA time zone'),
  });
  app.put('/api/push/quiet-hours', async (req, reply) => {
    if (!deps.digest) return reply.code(409).send({ error: 'push not configured' });
    const body = QuietHoursBody.parse(req.body);
    deps.digest.setQuietHours(body);
    // Turning quiet hours off releases anything parked right away.
    if (!body.enabled) await deps.digest.flush();
    return { quietHours: deps.digest.quietHours(), pending: deps.digest.pendingCount() };
  });
  /** "Send now": pushes the digest of parked notifications even inside quiet hours. */
  app.post('/api/push/digest/flush', async (_req, reply) => {
    if (!deps.digest) return reply.code(409).send({ error: 'push not configured' });
    return deps.digest.flush(true);
  });

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

export { ftsQuery };

declare module 'fastify' {
  interface FastifyRequest {
    session?: import('../auth/index.js').Session;
  }
}
