import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Mode, RunEvent } from '@doubletake/shared';
import { Channel, IngestRequest, ModeRequested, newId, TodoCreate } from '@doubletake/shared';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHostedAuthFromEnv, type HostedAuth, HostedAuthError } from '../auth/hosted.js';
import { Auth, AuthError } from '../auth/index.js';
import type { InstagramChannel } from '../channels/instagram/index.js';
import type { Config } from '../config/index.js';
import { openPgDb } from '../db/pg.js';
import type { Repo, TenantCtx } from '../db/repo.js';
import { brainCoords, type Geocoder, geocodeQuery } from '../geo/index.js';
import { IngestError, ingestAsync, ingestUploadAsync } from '../ingest/index.js';
import {
  listCollections,
  resolveCollection,
  resolveQuery,
  seedAutoCollections,
} from '../library/collections.js';
import { buildLibraryGraph, GRAPH_CAPS } from '../library/graph.js';
import {
  exportKarakeep,
  exportMemos,
  importKarakeep,
  KarakeepExport,
} from '../library/interchange.js';
import {
  newShareToken,
  renderSharePage,
  SHARE_PATH_PREFIX,
  sharedItems,
  shareUrl,
} from '../library/share.js';
import { MCP_PATH, registerMcpRoutes } from '../mcp/index.js';
import type { NotificationHub } from '../notify/hub.js';
import { type DigestGate, parseHHMM, validTimeZone } from '../notify/quiet.js';
import type { QueueWorker } from '../queue/worker.js';
import { safeJson, toChatDetail, toChatSummary, toEntityHit, toRunDto, toTodoDto } from './dto.js';
import { ftsQuery } from './fts.js';
import {
  cookieValue,
  HOSTED_PUBLIC_PATHS,
  HOSTED_SESSION_COOKIE,
  isHostedMode,
  registerHostedRoutes,
} from './hosted.js';
import { hostAllowed, IG_PUBLIC_PATHS, registerInstagramRoutes } from './instagram.js';
import { registerHostedPages } from './pages.js';

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
  /** Place geocoder (ADR 0022); when absent `POST /api/entities/geocode` answers 409. */
  geocoder?: Geocoder;
}

/** Media asset kinds the chat page may show as a picture. */
const STILL_KINDS = new Set(['thumbnail', 'image', 'frame']);
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Upload extensions by declared MIME type; anything else is refused (ADR 0029). */
const UPLOAD_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/3gpp': '.3gp',
  'video/x-matroska': '.mkv',
};
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

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
  // Tenant context (ADR 0032): present only for hosted `dth_` sessions; passing it
  // unconditionally is safe because Repo.scope() applies it on the pg dialect only.
  const tenantCtx = (req: FastifyRequest): TenantCtx | undefined => {
    const userId = (req as FastifyRequest & { hosted?: { userId?: string } }).hosted?.userId;
    return userId ? { userId } : undefined;
  };
  seedAutoCollections(repo);
  const auth = deps.auth ?? new Auth(repo);
  // Hosted mode (ADR 0032): Postgres accounts + sessions. Null (and no hosted routes) unless
  // DOUBLETAKE_HOSTED=1 and DOUBLETAKE_DATABASE_URL + DOUBLETAKE_MASTER_KEY_FILE are set.
  const hostedStack = isHostedMode()
    ? await createHostedAuthFromEnv((url) => openPgDb(url, { max: 5 }))
    : null;
  if (isHostedMode() && !hostedStack)
    throw new Error('DOUBLETAKE_HOSTED=1 but hosted auth could not be initialised');
  const hostedAuth: HostedAuth | null = hostedStack?.hosted ?? null;
  const app = Fastify({ logger: { level: cfg.logLevel }, bodyLimit: 1024 * 1024 });
  await app.register(fastifyWebsocket);
  app.addHook('onClose', async () => hostedStack?.close());
  // Share sheets post photos/videos as the raw request body (`POST /api/ingest/upload`); the
  // route streams it to disk, so no parser buffers it. Other routes never see these types.
  app.addContentTypeParser(/^(image|video)\//, (_req, payload, done) => done(null, payload));
  // The Capacitor WebView runs on its own origin (https://localhost); the API is token-gated,
  // so allowing cross-origin calls adds no exposure.
  await app.register(fastifyCors, {
    origin: ['https://localhost', 'http://localhost', 'capacitor://localhost'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-doubletake-note',
      'x-doubletake-channel',
      'x-doubletake-mode',
      'x-doubletake-client-id',
    ],
  });

  // ---- public-host guard + auth gate ----
  app.addHook('onRequest', async (req, reply) => {
    // Through the tunnel hostname only the Instagram webhook exists (docs/DEPLOYMENT.md).
    if (!hostAllowed(cfg, req.headers.host, req.url))
      return reply.code(404).send({ error: 'not found' });
    if (!req.url.startsWith('/api/') && !req.url.startsWith(MCP_PATH)) return;
    const pathOnly = req.url.split('?')[0] ?? req.url;
    if (PUBLIC_PATHS.has(pathOnly)) return;
    if (hostedAuth && HOSTED_PUBLIC_PATHS.has(pathOnly)) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : tokenFromQuery(req);
    // Hosted mode (ADR 0032): `dth_` tokens authenticate against the hosted sessions table.
    if (hostedAuth && bearer?.startsWith('dth_')) {
      const hosted = await hostedAuth.authenticate(bearer);
      if (!hosted) return reply.code(401).send({ error: 'unauthorized' });
      (req as FastifyRequest & { hosted?: typeof hosted }).hosted = hosted;
      return;
    }
    // Hosted browser sessions may also present the dt_session cookie (full page loads).
    if (hostedAuth && !bearer) {
      const cookie = cookieValue(req.headers.cookie, 'dt_session');
      if (cookie) {
        const hosted = await hostedAuth.authenticate(cookie);
        if (hosted) {
          (req as FastifyRequest & { hosted?: typeof hosted }).hosted = hosted;
          return;
        }
      }
    }
    // Hosted mode, cookie transport: the OAuth callbacks set `dt_session` (HttpOnly) so browser
    // navigations authenticate without a bearer header. Hosted-only; flag off leaves this inert.
    if (hostedAuth && !bearer) {
      const cookie = cookieValue(req.headers.cookie, HOSTED_SESSION_COOKIE);
      if (cookie !== undefined) {
        const hosted = await hostedAuth.authenticate(cookie);
        if (!hosted) return reply.code(401).send({ error: 'unauthorized' });
        (req as FastifyRequest & { hosted?: typeof hosted }).hosted = hosted;
        return;
      }
    }
    const session = await auth.authenticate(bearer);
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    req.session = session;
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof z.ZodError)
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    if (err instanceof AuthError || err instanceof IngestError || err instanceof HostedAuthError)
      return reply.code(400).send({ error: err.message });
    const e = err as Error & { statusCode?: number };
    app.log.error(e);
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
  });

  if (deps.ig) await registerInstagramRoutes(app, { cfg, ig: deps.ig });
  registerMcpRoutes(app, { repo, worker }); // ADR 0023: same token gate, see onRequest above

  // ---- public ----
  app.get('/api/health', async () => ({
    ok: true,
    brain: deps.brain.id,
    hasOwner: await auth.hasOwner(),
  }));
  app.get('/api/setup/status', async () => ({
    hasOwner: await auth.hasOwner(),
    // Hosted-mode markers (ADR 0032, non-sensitive, public): the PWA's boot probe is
    // anonymous, so hosted/inviteRequired must live on the PUBLIC status route or the
    // hosted login page would never appear.
    hosted: isHostedMode(),
    ...(isHostedMode() ? { inviteRequired: Boolean(process.env.DOUBLETAKE_INVITE_CODE) } : {}),
  }));

  app.post('/api/setup', async (req, reply) => {
    if (await auth.hasOwner()) return reply.code(409).send({ error: 'owner already set' });
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
    (await repo.listDevices()).map((d) => ({
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
    if (body.adapter && !worker.brains.all().some((b) => b.id === body.adapter))
      return reply.code(400).send({ error: `unknown adapter "${body.adapter}"` });
    const out = await ingestAsync(body, {
      repo,
      ctx: tenantCtx(req),
      adapterFor: (m) => worker.brains.forMode(m),
    });
    worker.kick();
    return reply.code(202).send({
      itemId: out.item.id,
      chatId: out.chat.id,
      runId: out.run.id,
      deduplicated: out.deduplicated,
      replayed: out.replayed ?? false,
    });
  });

  // A photo or video from a share sheet (ADR 0029). Body = the file; metadata travels in
  // headers because the body is not JSON. The file lands in `<dataDir>/media/<itemId>/` before
  // the item exists so the id is minted here; the worker runs the media pipeline on it.
  app.post(
    '/api/ingest/upload',
    { bodyLimit: UPLOAD_MAX_BYTES },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const contentType =
        (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const ext = UPLOAD_EXT[contentType];
      if (!ext) throw new IngestError(`unsupported upload type ${contentType || '(none)'}`);
      const hdr = (name: string): string | undefined => {
        const v = req.headers[name];
        const raw = Array.isArray(v) ? v[0] : v;
        if (raw === undefined || raw === '') return undefined;
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      };
      const meta = z
        .object({
          note: z.string().max(4_000).optional(),
          channel: Channel.default('compose'),
          modeHint: ModeRequested.default('auto'),
          clientId: z.string().min(8).max(80).optional(),
        })
        .parse({
          note: hdr('x-doubletake-note'),
          channel: hdr('x-doubletake-channel'),
          modeHint: hdr('x-doubletake-mode'),
          clientId: hdr('x-doubletake-client-id'),
        });
      if (meta.clientId) {
        const ctx = tenantCtx(req);
        const prior = await repo.findByClientId(meta.clientId, ctx);
        const chat = prior ? await repo.getChatByItem(prior.id, ctx) : undefined;
        const run = chat ? (await repo.listRuns(chat.id, ctx)).at(-1) : undefined;
        if (prior && chat && run) {
          // Replay (offline queue re-post): drain the body, answer as the first attempt did.
          for await (const _chunk of req.body as NodeJS.ReadableStream) {
            /* discard */
          }
          return reply.code(202).send({
            itemId: prior.id,
            chatId: chat.id,
            runId: run.id,
            deduplicated: false,
            replayed: true,
          });
        }
      }
      const itemId = newId();
      const name = `${contentType.startsWith('video/') ? 'source' : 'image'}${ext}`;
      const dir = path.join(cfg.dataDir, 'media', itemId);
      fs.mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, name);
      const tmp = `${abs}.part`;
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      try {
        const out = fs.createWriteStream(tmp);
        const src = req.body as NodeJS.ReadableStream;
        // The raw-stream parser bypasses Fastify's bodyLimit, so the cap is enforced here.
        let tooLarge = false;
        src.on('data', (c: Buffer) => {
          hash.update(c);
          bytes += c.length;
          if (bytes > UPLOAD_MAX_BYTES && !tooLarge) {
            tooLarge = true;
            (src as NodeJS.ReadableStream & { destroy?: (e?: Error) => void }).destroy?.(
              new Error('too large'),
            );
          }
        });
        try {
          await pipeline(src, out);
        } catch (e) {
          if (!tooLarge) throw e;
        }
        if (tooLarge) {
          fs.rmSync(dir, { recursive: true, force: true });
          return reply.code(413).send({ error: `upload exceeds ${UPLOAD_MAX_BYTES} bytes` });
        }
        if (bytes === 0) throw new IngestError('empty upload');
        fs.renameSync(tmp, abs);
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
      }
      const out = await ingestUploadAsync(
        {
          contentType,
          relPath: path.relative(cfg.dataDir, abs),
          bytes,
          sha256: hash.digest('hex'),
          ...(meta.note ? { note: meta.note } : {}),
          channel: meta.channel,
          modeHint: meta.modeHint,
          ...(meta.clientId ? { clientId: meta.clientId } : {}),
        },
        { repo, ctx: tenantCtx(req), itemId, adapterFor: (m) => worker.brains.forMode(m) },
      );
      worker.kick();
      return reply.code(202).send({
        itemId: out.item.id,
        chatId: out.chat.id,
        runId: out.run.id,
        deduplicated: false,
        replayed: false,
      });
    },
  );

  // Cross-library chat (ADR 0021): a question over what the owner saved, answered by the brain
  // from FTS-retrieved past chats. Same pipeline as a share, channel `library`.
  app.post('/api/library/chat', async (req, reply) => {
    const body = z
      .object({
        question: z.string().trim().min(1).max(4000),
        modeHint: z.enum(['auto', 'quick', 'standard', 'deep']).default('auto'),
      })
      .parse(req.body);
    const out = await ingestAsync(
      { text: body.question, channel: 'library', focus: 'whole', modeHint: body.modeHint },
      { repo, ctx: tenantCtx(req), adapterFor: (m) => worker.brains.forMode(m) },
    );
    worker.kick();
    return reply.code(202).send({ itemId: out.item.id, chatId: out.chat.id, runId: out.run.id });
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
    const ctx = tenantCtx(req);
    let rows = await repo.listChats(q.limit, ctx);
    if (q.collection) {
      const c = await repo.getCollection(q.collection, ctx);
      if (!c) return reply.code(404).send({ error: 'collection not found' });
      const ids = await resolveCollection(repo, c, ctx);
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    if (q.q?.trim()) {
      const ids = new Set(await repo.searchFts(ftsQuery(q.q), q.limit, ctx));
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    if (q.tag?.trim()) {
      const ids = new Set(await repo.itemIdsByTag(q.tag, ctx));
      rows = rows.filter((r) => ids.has(r.item.id));
    }
    return await Promise.all(rows.map((r) => toChatSummary(repo, r.chat, r.item, ctx)));
  });

  app.get('/api/tags', async (req) => await repo.listAllTags(tenantCtx(req)));

  /** Map of everything: read-only graph over chats, things and tags (Library → Graph). */
  app.get(
    '/api/library/graph',
    async (req) => await buildLibraryGraph(repo, GRAPH_CAPS, tenantCtx(req)),
  );

  // ---- collections + entity views (M6) ----
  const toShareUrl = (token: string) => shareUrl(cfg, token);

  // Shareable read-only pages (ADR 0025). Outside /api on purpose: the token in the path is
  // the whole credential; the page carries no script and no owner note.
  app.post('/api/collections/:id/share', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
    if (!c) return reply.code(404).send({ error: 'no such collection' });
    if (c.auto) return reply.code(400).send({ error: 'auto collections cannot be shared' });
    const token = c.shareToken ?? newShareToken();
    if (!c.shareToken) repo.updateCollection(id, { shareToken: token }, ctx);
    return { shareUrl: toShareUrl(token) };
  });
  app.delete('/api/collections/:id/share', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
    if (!c) return reply.code(404).send({ error: 'no such collection' });
    repo.updateCollection(id, { shareToken: null }, ctx);
    return { shareUrl: null };
  });
  app.get(`${SHARE_PATH_PREFIX}:token`, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(8).max(64) }).parse(req.params);
    const c = await repo.findCollectionByShareToken(token);
    if (!c || c.hidden) return reply.code(404).type('text/plain').send('not found');
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex, nofollow')
      .header('referrer-policy', 'no-referrer')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(renderSharePage(c.name, await sharedItems(repo, c)));
  });

  app.get('/api/collections', async (req) => {
    const q = z
      .object({
        hidden: z.coerce.boolean().default(false),
        all: z.coerce.boolean().default(false),
      })
      .parse(req.query);
    return await listCollections(repo, q.hidden, !q.all, toShareUrl, tenantCtx(req));
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
    const ctx = tenantCtx(req);
    const id = repo.createCollection(
      {
        name: body.name,
        query: body.query ?? '',
        manual,
        auto: false,
      },
      ctx,
    );
    return reply
      .code(201)
      .send((await listCollections(repo, true, false, toShareUrl, ctx)).find((c) => c.id === id));
  });

  app.post('/api/collections/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
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
    repo.updateCollection(
      id,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.query !== undefined && !c.manual ? { query: body.query } : {}),
        ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      },
      ctx,
    );
    return (await listCollections(repo, true, false, toShareUrl, ctx)).find((x) => x.id === id);
  });

  app.delete('/api/collections/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    if (c.auto) return reply.code(400).send({ error: 'auto collections can only be hidden' });
    repo.deleteCollection(id, ctx);
    return { ok: true };
  });

  app.post('/api/collections/:id/items', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    if (!c.manual) return reply.code(400).send({ error: 'only manual collections take items' });
    const body = z.object({ chatId: z.string() }).parse(req.body);
    const chat = await repo.getChat(body.chatId, ctx);
    if (!chat) return reply.code(404).send({ error: 'chat not found' });
    repo.addCollectionItem(id, chat.itemId, ctx);
    worker.emit('chat_updated', chat.id);
    return { count: (await repo.collectionItemIds(id, ctx)).length };
  });

  app.delete('/api/collections/:id/items/:chatId', async (req, reply) => {
    const { id, chatId } = z.object({ id: z.string(), chatId: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const c = await repo.getCollection(id, ctx);
    if (!c) return reply.code(404).send({ error: 'collection not found' });
    const chat = await repo.getChat(chatId, ctx);
    if (!chat) return reply.code(404).send({ error: 'chat not found' });
    repo.removeCollectionItem(id, chat.itemId, ctx);
    worker.emit('chat_updated', chat.id);
    return { count: (await repo.collectionItemIds(id, ctx)).length };
  });

  // ---- Karakeep / Memos interchange (ADR 0024) ----
  app.get('/api/export/karakeep', async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-disposition', `attachment; filename="doubletake-karakeep-${stamp}.json"`)
      .send(await exportKarakeep(repo));
  });

  app.get('/api/export/memos', async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-disposition', `attachment; filename="doubletake-memos-${stamp}.json"`)
      .send(await exportMemos(repo));
  });

  // A Karakeep export can be large; this route alone takes bodies up to 32 MiB.
  app.post('/api/import/karakeep', { bodyLimit: 32 * 1024 * 1024 }, async (req, reply) => {
    const research = z
      .object({ research: z.enum(['quick', 'standard', 'deep']).optional() })
      .parse(req.query ?? {}).research;
    const parsed = KarakeepExport.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'not a Karakeep export file (expected { bookmarks: [...] })' });
    }
    const summary = await importKarakeep(repo, parsed.data, {
      research: research ?? null,
      adapterFor: (m) => worker.brains.forMode(m),
    });
    if (summary.runs) worker.kick();
    if (summary.imported) worker.emit('chat_updated', '');
    return summary;
  });

  /** Which manual collections hold this chat (for the chat header picker). */
  app.get('/api/chats/:id/collections', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    return { collectionIds: await repo.collectionsForItem(item.id, tenantCtx(req)) };
  });

  // ---- saved list (ADR 0031) ----
  /** The owner's saved list: open entries by default, `?done=done` for finished ones, `all` for both. */
  app.get('/api/todos', async (req) => {
    const q = z.object({ done: z.enum(['open', 'done', 'all']).default('open') }).parse(req.query);
    return (await repo.listTodos(q.done, tenantCtx(req))).map((r) =>
      toTodoDto(r.todo, r.chatTitle),
    );
  });

  /** Save a thing from an answer (an entity snapshot) or a free-form task. */
  app.post('/api/todos', async (req, reply) => {
    const body = TodoCreate.parse(req.body);
    const ctx = tenantCtx(req);
    if (body.chatId && !(await repo.getChat(body.chatId, ctx)))
      return reply.code(404).send({ error: 'chat not found' });
    const row = repo.createTodo(body, 'open', ctx);
    const chat = body.chatId ? await repo.getChat(body.chatId, ctx) : undefined;
    const item = chat ? await repo.getItem(chat.itemId, ctx) : undefined;
    if (chat) worker.emit('chat_updated', chat.id);
    return reply.code(201).send(toTodoDto(row, item?.title));
  });

  /** Brain suggestions waiting for the owner (ADR 0031); approve or dismiss each one. */
  app.get('/api/todos/suggestions', async (req) => {
    return (await repo.listTodos('suggested', tenantCtx(req))).map((r) =>
      toTodoDto(r.todo, r.chatTitle),
    );
  });

  /** Tick, untick, retitle or annotate one entry. */
  app.post('/api/todos/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const patch = z
      .object({
        done: z.boolean().optional(),
        title: z.string().trim().min(1).max(300).optional(),
        note: z.string().max(2000).nullable().optional(),
      })
      .parse(req.body ?? {});
    const ctx = tenantCtx(req);
    const existing = await repo.getTodo(id, ctx);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    if (existing.status === 'suggested')
      return reply.code(409).send({ error: 'still a suggestion; approve or dismiss it first' });
    const row = repo.updateTodo(id, patch, ctx);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const chat = row.chatId ? await repo.getChat(row.chatId, ctx) : undefined;
    const item = chat ? await repo.getItem(chat.itemId, ctx) : undefined;
    if (chat) worker.emit('chat_updated', chat.id);
    return toTodoDto(row, item?.title);
  });

  /** Move a suggestion onto the list. */
  app.post('/api/todos/:id/approve', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const row = await repo.getTodo(id, ctx);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (row.status !== 'suggested') return reply.code(409).send({ error: 'not a suggestion' });
    const approved = repo.approveTodo(id, ctx);
    if (!approved) return reply.code(409).send({ error: 'not a suggestion' });
    const chat = approved.chatId ? await repo.getChat(approved.chatId, ctx) : undefined;
    const item = chat ? await repo.getItem(chat.itemId, ctx) : undefined;
    if (chat) worker.emit('chat_updated', chat.id);
    return toTodoDto(approved, item?.title);
  });

  /** Throw a suggestion away without adding it to the list. */
  app.post('/api/todos/:id/dismiss', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const row = await repo.getTodo(id, ctx);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (row.status !== 'suggested') return reply.code(409).send({ error: 'not a suggestion' });
    if (!repo.deleteTodo(id, ctx)) return reply.code(404).send({ error: 'not found' });
    if (row.chatId) worker.emit('chat_updated', row.chatId);
    return reply.code(204).send();
  });

  app.delete('/api/todos/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ctx = tenantCtx(req);
    const row = await repo.getTodo(id, ctx);
    if (!row || !repo.deleteTodo(id, ctx)) return reply.code(404).send({ error: 'not found' });
    if (row.chatId) worker.emit('chat_updated', row.chatId);
    return reply.code(204).send();
  });

  /** Every extracted entity of one kind across the library: places, recipes, products, tools… */
  app.get('/api/entities', async (req) => {
    const q = z
      .object({
        kind: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
        starred: z.enum(['0', '1']).optional(),
      })
      .parse(req.query);
    const kind = q.kind.toLowerCase();
    const ctx = tenantCtx(req);
    const rows = await repo.listEntitiesByKind(
      kind,
      q.limit,
      q.starred === undefined ? undefined : q.starred === '1',
      ctx,
    );
    if (kind !== 'place') return rows.map((r) => toEntityHit(r));
    // Places carry coordinates when known: the brain's own lat/lon, else the geocoder cache (ADR 0022).
    const cache = new Map((await repo.listPlaceGeo(ctx)).map((g) => [g.query, g]));
    return rows.map((r) => {
      const attrs = safeJson(r.entity.attributes);
      const own = brainCoords(attrs);
      if (own) return toEntityHit(r, { ...own, label: null, source: 'brain' });
      const g = cache.get(geocodeQuery({ name: r.entity.name, attributes: attrs }));
      const geo =
        g && g.lat !== null && g.lon !== null
          ? { lat: g.lat, lon: g.lon, label: g.label, source: 'geocoder' as const }
          : null;
      return toEntityHit(r, geo);
    });
  });

  /** Star (or unstar) one thing from the Library grid. */
  app.post('/api/entities/:id/star', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ starred: z.boolean() }).parse(req.body);
    const row = await repo.setEntityStarred(id, body.starred, tenantCtx(req));
    if (!row) return reply.code(404).send({ error: 'not found' });
    return { id: row.id, starred: row.starred };
  });

  /** Geocode every place that has no coordinates yet (backfill after enabling the geocoder). */
  app.post('/api/entities/geocode', async (req, reply) => {
    if (!deps.geocoder?.enabled) return reply.code(409).send({ error: 'geocoder is off' });
    const q = req.query as { retry?: string };
    const ctx = tenantCtx(req);
    // `?retry=misses` forgets cached misses first, for a better geocoder or a fixed OSM entry.
    const retried = q.retry === 'misses' ? await repo.clearPlaceGeoMisses() : 0;
    const rows = await repo.listEntitiesByKind('place', 1000, undefined, ctx);
    const seen = new Set<string>();
    let located = 0;
    let unknown = 0;
    for (const r of rows) {
      if (seen.has(r.item.id)) continue;
      seen.add(r.item.id);
      await deps.geocoder.locateItem(r.item.id);
    }
    const cache = new Map((await repo.listPlaceGeo(ctx)).map((g) => [g.query, g]));
    for (const r of rows) {
      const attrs = safeJson(r.entity.attributes);
      if (brainCoords(attrs)) {
        located++;
        continue;
      }
      const g = cache.get(geocodeQuery({ name: r.entity.name, attributes: attrs }));
      if (g && g.lat !== null) located++;
      else unknown++;
    }
    for (const r of rows) worker.emit('chat_updated', r.chatId);
    return { places: rows.length, located, unknown, retried };
  });

  /** Preview what a query would match without saving it. */
  app.get('/api/collections/preview', async (req) => {
    const q = z.object({ query: z.string() }).parse(req.query);
    return { count: (await resolveQuery(repo, q.query, tenantCtx(req))).length };
  });

  app.post('/api/chats/:id/tags', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    const ctx = tenantCtx(req);
    const body = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
    const name = repo.addManualTag(item.id, body.name, ctx);
    if (!name) return reply.code(400).send({ error: 'empty tag' });
    await worker.reindex(item, chat.id, item.modeEffective ?? 'quick');
    worker.emit('chat_updated', chat.id);
    return { tags: await repo.listTags(item.id, ctx) };
  });

  app.delete('/api/chats/:id/tags/:name', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    const ctx = tenantCtx(req);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.params);
    repo.removeTag(item.id, decodeURIComponent(name), ctx);
    await worker.reindex(item, chat.id, item.modeEffective ?? 'quick');
    worker.emit('chat_updated', chat.id);
    return { tags: await repo.listTags(item.id, ctx) };
  });

  app.get('/api/chats/:id', async (req, reply) => {
    const ctx = tenantCtx(req);
    const { chat, item } = (await loadChat(req, reply, repo, ctx)) ?? {};
    if (!chat || !item) return;
    return await toChatDetail(repo, chat, item, ctx);
  });

  /**
   * One still image of the share (thumbnail / image / sampled frame) for the chat's source card.
   * Same device-token gate as the rest of the API; the asset must belong to this chat's item and
   * resolve to a file inside `<dataDir>/media/`, so a stale row can never read elsewhere.
   */
  app.get('/api/chats/:id/media/:mediaId', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    const { mediaId } = z.object({ mediaId: z.string() }).parse(req.params);
    const asset = await repo.getMediaAsset(mediaId, tenantCtx(req));
    if (!asset || asset.itemId !== item.id || !STILL_KINDS.has(asset.kind))
      return reply.code(404).send({ error: 'not found' });
    const mediaRoot = path.resolve(cfg.dataDir, 'media') + path.sep;
    const abs = path.resolve(cfg.dataDir, asset.path);
    if (!abs.startsWith(mediaRoot) || !fs.existsSync(abs))
      return reply.code(404).send({ error: 'not found' });
    reply.header('cache-control', 'private, max-age=86400');
    return reply
      .type(IMAGE_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
      .send(fs.createReadStream(abs));
  });

  app.post('/api/chats/:id/read', async (req, reply) => {
    const { chat } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat) return;
    repo.markRead(chat.id, tenantCtx(req));
    return { ok: true };
  });

  /** Follow-up question: cheap turn by default. */
  app.post('/api/chats/:id/messages', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    const ctx = tenantCtx(req);
    const body = z.object({ content: z.string().min(1).max(8000) }).parse(req.body);
    repo.addMessage(
      { chatId: chat.id, role: 'user', kind: 'question', content: body.content },
      ctx,
    );
    const run = repo.createRun(
      {
        itemId: item.id,
        chatId: chat.id,
        kind: 'followup',
        mode: (item.modeEffective as Mode | null) ?? 'quick',
        adapter: chat.brainAdapter ?? deps.brain.id,
        userMessage: body.content,
      },
      ctx,
    );
    worker.kick();
    return reply.code(202).send({ runId: run.id });
  });

  /**
   * "Research this": full re-run, optionally with a different mode; resumes the session.
   * `adapter` (one of the configured brains, optionally with `model`) pins the run to that
   * adapter so the worker does not rebind it to the mode's default after classification.
   */
  app.post('/api/chats/:id/research', async (req, reply) => {
    const { chat, item } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat || !item) return;
    const body = z
      .object({
        mode: z.enum(['quick', 'standard', 'deep']).optional(),
        note: z.string().max(4000).optional(),
        adapter: z.string().min(1).max(80).optional(),
        model: z.string().min(1).max(200).optional(),
      })
      .parse(req.body ?? {});
    if (body.adapter && !worker.brains.all().some((b) => b.id === body.adapter))
      return reply.code(400).send({ error: `unknown adapter "${body.adapter}"` });
    if (body.model && !body.adapter)
      return reply.code(400).send({ error: 'model needs an adapter' });
    const ctx = tenantCtx(req);
    if (body.note?.trim()) {
      repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: body.note }, ctx);
      repo.updateItem(item.id, { note: [item.note, body.note].filter(Boolean).join('\n\n') }, ctx);
    }
    const mode = body.mode ?? (item.modeEffective as Mode | null) ?? 'standard';
    repo.updateItem(item.id, { modeRequested: mode, status: 'new' }, ctx);
    const bound = worker.brains.forMode(mode);
    const run = repo.createRun(
      {
        itemId: item.id,
        chatId: chat.id,
        kind: 'research',
        mode,
        adapter: body.adapter ?? bound.adapter.id,
        model: body.adapter ? (body.model ?? null) : bound.model,
        pinned: Boolean(body.adapter),
      },
      ctx,
    );
    worker.kick();
    return reply.code(202).send({ runId: run.id });
  });

  app.get('/api/chats/:id/runs/:runId/events', async (req, reply) => {
    const { chat } = (await loadChat(req, reply, repo, tenantCtx(req))) ?? {};
    if (!chat) return;
    const { runId } = z.object({ runId: z.string() }).parse(req.params);
    const run = await repo.getRun(runId, tenantCtx(req));
    if (!run || run.chatId !== chat.id) return reply.code(404).send({ error: 'run not found' });
    return {
      run: toRunDto(run),
      events: (await repo.listRunEvents(runId, tenantCtx(req))).map((e) => ({
        seq: e.seq,
        type: e.type,
        payload: JSON.parse(e.payload),
        at: e.at,
      })),
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
      // Hosted-mode markers (ADR 0032, non-sensitive): lets the PWA show/hide hosted UI and the
      // register form show the invite field. Self-hosted shape otherwise unchanged.
      hosted: isHostedMode(),
      ...(isHostedMode() ? { inviteRequired: Boolean(process.env.DOUBLETAKE_INVITE_CODE) } : {}),
      spentTodayUsd: await repo.spentToday(),
      dailyCapUsd: cfg.dailyCapUsd,
      brain: deps.brain.id,
      brainIds: worker.brains.all().map((b) => b.id),
      brains: health === 'skip' ? [] : await worker.brains.healthchecks(health === 'refresh'),
      notesDir: cfg.notesDir,
      push: {
        kinds: deps.hub?.kinds() ?? [],
        channels: deps.hub?.channels() ?? [],
        vapidPublicKey: deps.vapidPublicKey ?? null,
        quietHours: (await deps.digest?.quietHours()) ?? null,
        pending: (await deps.digest?.pendingCount()) ?? 0,
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
    return (await repo.listPushSubscriptionsForDevice(session.deviceId)).map((r) => ({
      id: r.id,
      kind: r.kind,
      endpoint: r.endpoint,
      createdAt: r.createdAt,
    }));
  });
  /** Sends a test notification to this device's subscriptions only. */
  app.post('/api/push/test', async (req, reply) => {
    const session = req.session;
    if (!session || !deps.hub) return reply.code(409).send({ error: 'push not configured' });
    const mine = new Set(
      (await repo.listPushSubscriptionsForDevice(session.deviceId)).map((r) => r.id),
    );
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
    return {
      quietHours: await deps.digest.quietHours(),
      pending: await deps.digest.pendingCount(),
    };
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

  // ---- Hosted app shell: the SERVER decides who gets the shell (real redirects, no client gate) ----
  if (hostedAuth) {
    const hostedShell = async (req: FastifyRequest, reply: FastifyReply) => {
      const cookie = cookieValue(req.headers.cookie, HOSTED_SESSION_COOKIE);
      const header = req.headers.authorization;
      const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      let ok = false;
      const token = bearer ?? cookie;
      if (token) {
        try {
          ok = Boolean(await hostedAuth.authenticate(token));
        } catch {
          ok = false;
        }
      }
      if (!ok && req.url.split('?')[0] !== '/login') return reply.redirect('/login');
      reply.header('cache-control', 'no-store');
      return reply.sendFile('index.html');
    };
    for (const p of ['/library', '/todo', '/map', '/settings', '/settings/*', '/chat/*']) {
      app.get(p, hostedShell);
    }
    // /login serves the shell to everyone; the SPA renders the form (and bounces authed users).
    app.get('/login', hostedShell);
  }

  // ---- PWA ----
  if (cfg.webDist && fs.existsSync(cfg.webDist)) {
    // Hosted mode: the explicit GET / landing route owns '/', so the static plugin must not
    // also register an index route there (FST_ERR_DUPLICATED_ROUTE would crash the boot).
    await app.register(fastifyStatic, {
      root: cfg.webDist,
      wildcard: false,
      index: hostedAuth ? false : ['index.html'],
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      // Hashed bundles are registered as routes at boot; one built after boot must 404, not
      // come back as index.html (a module script served as text/html breaks the whole app).
      if (req.url.startsWith('/assets/')) return reply.code(404).send('not found');
      return reply.sendFile('index.html');
    });
  }

  registerHostedRoutes(app, hostedAuth ?? undefined); // ADR 0032: no-op unless hosted mode is on
  // Hosted Instagram pairing (ADR 0018 + ADR 0032): the channel gains hooks only here, so the
  // self-hosted single-owner behaviour is untouched when DOUBLETAKE_HOSTED is unset.
  if (hostedAuth && deps.ig) {
    deps.ig.attachHosted({
      resolveLink: (senderId) => hostedAuth.getIgLinkForSender(senderId),
      resolvePairing: (code, senderId, igUsername) =>
        hostedAuth.resolveIgPairing(code, senderId, igUsername),
    });
  }
  // Landing + legal pages (privacy/terms/delete), and the anonymous-`/` landing hook.
  registerHostedPages(app, hostedAuth ?? undefined);

  return app;
}

function tokenFromQuery(req: FastifyRequest): string | undefined {
  const q = req.query as Record<string, unknown> | undefined;
  return typeof q?.token === 'string' ? q.token : undefined;
}

async function loadChat(
  req: FastifyRequest,
  reply: FastifyReply,
  repo: Repo,
  ctx: TenantCtx | undefined,
) {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const chat = await repo.getChat(id, ctx);
  const item = chat ? await repo.getItem(chat.itemId, ctx) : undefined;
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
