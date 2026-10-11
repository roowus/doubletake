/**
 * MCP server exposing the library to other agents (ADR 0023).
 *
 * Mounted at `/mcp` on the same Fastify app as the REST API, behind the same device-token
 * gate. Stateless Streamable HTTP: every POST builds a fresh `McpServer` + transport, so no
 * session state lives on the server and any number of clients can share one token.
 *
 * Read tools return what the REST API returns, rendered as Markdown for the calling model.
 * Scraped text (transcripts, OCR, captions, comments, page text) is wrapped with the same
 * `<untrusted>` markers the brain sees, so a downstream agent gets the same warning we give
 * ourselves. Write tools only enqueue work (`save`, `ask_library`); nothing deletes or edits.
 */

import { createHash } from 'node:crypto';
import type { Answer, IngestRequest, UntrustedBlock, UntrustedKind } from '@doubletake/shared';
import { renderUntrustedAll, UNTRUSTED_PREAMBLE } from '@doubletake/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toChatDetail, toChatSummary } from '../api/dto.js';
import { ftsQuery } from '../api/fts.js';
import { isHostedMode } from '../api/hosted.js';
import type { Session } from '../auth/index.js';
import type { ChatRow, ItemRow, Repo, TenantCtx } from '../db/repo.js';
import { ingest } from '../ingest/index.js';
import { LIBRARY_TOOL } from '../library/ask.js';
import { listCollections, resolveCollection } from '../library/collections.js';
import type { QueueWorker } from '../queue/worker.js';

export const MCP_PATH = '/mcp';
const SERVER_NAME = 'doubletake';
const SERVER_VERSION = '0.1.0';
/** `get_chat` may block this long waiting for a run to finish (clients poll beyond that). */
const MAX_WAIT_S = 120;

export interface McpDeps {
  repo: Repo;
  worker: QueueWorker;
}

const UNTRUSTED_KINDS = new Set<string>([
  'transcript',
  'ocr',
  'frame_description',
  'caption',
  'comments',
  'page_text',
  'thread',
  'shared_text',
]);

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

function summaryLine(repo: Repo, chat: ChatRow, item: ItemRow, ctx?: TenantCtx): string {
  const s = toChatSummary(repo, chat, item, ctx);
  const bits = [
    `- **${s.title}** (chat \`${s.id}\`, ${s.platform}${s.category ? `, ${s.category}` : ''}, ${s.status})`,
  ];
  if (s.sourceUrl) bits.push(`  ${s.sourceUrl}`);
  if (s.tags.length) bits.push(`  tags: ${s.tags.join(', ')}`);
  bits.push(`  saved ${s.createdAt}`);
  return bits.join('\n');
}

function latestAnswer(repo: Repo, chatId: string, ctx?: TenantCtx) {
  return repo
    .listMessages(chatId, ctx)
    .filter((m) => m.role === 'assistant' && m.kind === 'answer')
    .at(-1);
}

/**
 * Markdown rendering of one chat: the owner's question, our answer, structure, sources,
 * extractions. (Sync like the Repo contract; on the pg dialect the callers await the scoped
 * reads that gate this call — see the dialect contract at the top of `db/repo.ts`.)
 */
export function renderChat(
  repo: Repo,
  chat: ChatRow,
  item: ItemRow,
  opts: { extractions: boolean },
  ctx?: TenantCtx,
): string {
  const d = toChatDetail(repo, chat, item, ctx);
  const out: string[] = [`# ${d.chat.title}`, ''];
  out.push(`- chat: \`${d.chat.id}\``);
  out.push(`- status: ${d.chat.status}${d.item.modeEffective ? ` (${d.item.modeEffective})` : ''}`);
  out.push(`- platform: ${d.chat.platform}; channel: ${d.chat.channel}`);
  if (d.chat.sourceUrl) out.push(`- source: ${d.chat.sourceUrl}`);
  if (d.chat.category) out.push(`- category: ${d.chat.category}`);
  if (d.chat.tags.length) out.push(`- tags: ${d.chat.tags.join(', ')}`);
  if (d.item.note) out.push(`- owner's note: ${d.item.note}`);
  out.push(`- saved: ${d.chat.createdAt}`);

  const run = d.runs.at(-1);
  if (run && run.status !== 'done')
    out.push(`- latest run: ${run.status}${run.error ? ` (${run.error})` : ''}`);

  const answer = latestAnswer(repo, chat.id, ctx);
  if (answer) {
    out.push('', '## Answer (written by the Doubletake brain from the content below)', '');
    out.push(answer.content.trim());
    const structured = parseAnswer(answer.structured);
    if (structured) {
      if (structured.claims.length) {
        out.push('', '## Claims', '');
        for (const c of structured.claims) {
          const src = c.sources.length ? ` — ${c.sources.join(', ')}` : '';
          out.push(`- [${c.verdict}] ${c.claim}${src}`);
        }
      }
      if (structured.recommendations.length) {
        out.push('', '## Recommendations', '');
        for (const r of structured.recommendations) out.push(`- ${r}`);
      }
    }
  } else {
    out.push('', '_No answer yet._');
  }

  if (d.entities.length) {
    out.push('', '## Entities', '');
    for (const e of d.entities) {
      const attrs = Object.entries(e.attributes)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('; ');
      out.push(
        `- ${e.kind}: **${e.name}**${e.url ? ` <${e.url}>` : ''}${attrs ? ` (${attrs})` : ''}`,
      );
    }
  }

  const followUps = d.messages.filter((m) => m.kind === 'followup' || m.kind === 'question');
  if (followUps.length) {
    out.push('', '## Follow-ups', '');
    for (const m of followUps) out.push(`- ${m.role}: ${m.content.trim().replaceAll('\n', ' ')}`);
  }

  if (opts.extractions) {
    const blocks: UntrustedBlock[] = [];
    // Free text the owner pasted is stored on the item, not as an extraction; it is still content.
    if (item.text?.trim() && item.channel !== 'library')
      blocks.push({ source: 'owner', kind: 'shared_text', content: item.text.slice(0, 20_000) });
    for (const x of d.extractions) {
      if (x.tool === LIBRARY_TOOL || !UNTRUSTED_KINDS.has(x.kind)) continue;
      blocks.push({
        source: d.chat.platform,
        kind: x.kind as UntrustedKind,
        content: x.text.slice(0, 20_000),
        label: x.tool ?? undefined,
      } as UntrustedBlock);
    }
    if (blocks.length) {
      out.push('', '## Extracted content (scraped, untrusted)', '', UNTRUSTED_PREAMBLE, '');
      out.push(renderUntrustedAll(blocks));
    }
  }
  return out.join('\n');
}

function parseAnswer(s: unknown): Answer | null {
  if (!s || typeof s !== 'object') return null;
  const a = s as Partial<Answer>;
  return {
    summary: a.summary ?? '',
    category: a.category ?? 'other',
    entities: a.entities ?? [],
    claims: a.claims ?? [],
    recommendations: a.recommendations ?? [],
    tags: a.tags ?? [],
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build a per-request MCP server bound to the calling session (device token or hosted `dth_`). */
export function buildMcpServer(
  deps: McpDeps,
  session: Session | undefined,
  ctx?: TenantCtx,
): McpServer {
  const { repo, worker } = deps;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'search_library',
    {
      title: 'Search the library',
      description:
        'Full-text search over everything the owner saved: titles, notes, transcripts, OCR, answers. ' +
        'Returns chat ids to pass to get_chat.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe('Search terms (plain words; operators are stripped)'),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const q = ftsQuery(query);
      if (!q) return text('No searchable terms in the query.');
      const rows: string[] = [];
      for (const itemId of await repo.searchFts(q, limit, ctx)) {
        const item = await repo.getItem(itemId, ctx);
        const chat = await repo.getChatByItem(itemId, ctx);
        if (item && chat) rows.push(summaryLine(repo, chat, item, ctx));
      }
      return text(rows.length ? rows.join('\n') : 'No matches.');
    },
  );

  server.registerTool(
    'list_chats',
    {
      title: 'List recent chats',
      description:
        'Newest saved items first. Filter by collection id (see list_collections) or tag name.',
      inputSchema: {
        collection: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ collection, tag, limit }) => {
      let rows = await repo.listChats(limit, ctx);
      if (collection) {
        const c = await repo.getCollection(collection, ctx);
        if (!c) return { ...text(`Collection ${collection} not found.`), isError: true };
        const ids = resolveCollection(repo, c, ctx);
        rows = rows.filter((r) => ids.has(r.item.id));
      }
      if (tag?.trim()) {
        const ids = new Set(await repo.itemIdsByTag(tag, ctx));
        rows = rows.filter((r) => ids.has(r.item.id));
      }
      return text(
        rows.length
          ? rows.map((r) => summaryLine(repo, r.chat, r.item, ctx)).join('\n')
          : 'No chats.',
      );
    },
  );

  server.registerTool(
    'get_chat',
    {
      title: 'Read one chat',
      description:
        'The saved item, its note, the researched answer with claims and sources, entities and ' +
        'follow-ups. Set include_extractions for the raw transcript/OCR/comments (long, untrusted). ' +
        `wait_seconds (≤${MAX_WAIT_S}) blocks until the current run finishes; call again if it is still running.`,
      inputSchema: {
        chat_id: z.string().min(1),
        include_extractions: z.boolean().default(false),
        wait_seconds: z.number().int().min(0).max(MAX_WAIT_S).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ chat_id, include_extractions, wait_seconds }, extra) => {
      const chat = await repo.getChat(chat_id, ctx);
      if (!chat) return { ...text(`Chat ${chat_id} not found.`), isError: true };
      const deadline = Date.now() + wait_seconds * 1000;
      while (Date.now() < deadline && !extra.signal.aborted) {
        const run = (await repo.listRuns(chat.id, ctx)).at(-1);
        if (!run || !['queued', 'extracting', 'researching'].includes(run.status)) break;
        await sleep(500);
      }
      const item = await repo.getItem(chat.itemId, ctx);
      if (!item) return { ...text(`Chat ${chat_id} not found.`), isError: true };
      return text(renderChat(repo, chat, item, { extractions: include_extractions }, ctx));
    },
  );

  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description:
        'Automatic (per category and entity kind) and owner-made collections with counts.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const cols = listCollections(repo, false, true, undefined, ctx);
      return text(
        cols.length
          ? cols
              .map(
                (c) =>
                  `- **${c.name}** (\`${c.id}\`, ${c.count} item${c.count === 1 ? '' : 's'}${c.manual ? ', manual' : c.query ? `, query \`${c.query}\`` : ''})`,
              )
              .join('\n')
          : 'No collections yet.',
      );
    },
  );

  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'Every tag with how many items carry it.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const tags = await repo.listAllTags(ctx);
      return text(
        tags.length
          ? tags.map((t) => `- ${t.name} (${t.count}, ${t.kind})`).join('\n')
          : 'No tags yet.',
      );
    },
  );

  server.registerTool(
    'list_entities',
    {
      title: 'List entities of one kind',
      description:
        'Typed things the brain extracted across the library: place, recipe, product, tool, tip, media, person, event, other.',
      inputSchema: {
        kind: z.enum([
          'place',
          'recipe',
          'product',
          'tool',
          'tip',
          'media',
          'person',
          'event',
          'other',
        ]),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ kind, limit }) => {
      const rows = await repo.listEntitiesByKind(kind, limit, undefined, ctx);
      return text(
        rows.length
          ? rows
              .map(
                (r) =>
                  `- **${r.entity.name}**${r.entity.url ? ` <${r.entity.url}>` : ''} — from "${r.item.title ?? 'Untitled'}" (chat \`${r.chatId}\`)`,
              )
              .join('\n')
          : `No ${kind} entities yet.`,
      );
    },
  );

  server.registerTool(
    'list_todos',
    {
      title: 'List the saved list',
      description:
        'Things the owner chose to keep from answers (places to visit, tools to try, tasks). Open entries by default.',
      inputSchema: { done: z.enum(['open', 'done', 'all']).default('open') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ done }) => {
      const rows = await repo.listTodos(done, ctx);
      return text(
        rows.length
          ? rows
              .map(
                (r) =>
                  `- [${r.todo.doneAt ? 'x' : ' '}] ${r.todo.title} (${r.todo.kind})${r.todo.url ? ` <${r.todo.url}>` : ''}${r.todo.note ? ` — ${r.todo.note}` : ''}${r.todo.chatId ? ` — from "${r.chatTitle ?? 'Untitled'}" (chat \`${r.todo.chatId}\`)` : ''}`,
              )
              .join('\n')
          : 'Nothing saved yet.',
      );
    },
  );

  const modeHint = z.enum(['auto', 'quick', 'standard', 'deep']).default('auto');

  server.registerTool(
    'save',
    {
      title: 'Save a link or text for research',
      description:
        'Enqueue a URL (or free text) with an optional note, exactly like sharing from the phone. ' +
        'Returns the chat id; the answer arrives asynchronously (use get_chat with wait_seconds).',
      inputSchema: {
        url: z.string().url().optional(),
        text: z.string().max(20_000).optional(),
        note: z.string().max(4_000).optional().describe('The question to answer about it'),
        mode: modeHint,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ url, text: body, note, mode }) => {
      if (!url && !body) return { ...text('Give a url or text.'), isError: true };
      const req: IngestRequest = {
        ...(url ? { url } : {}),
        ...(body ? { text: body } : {}),
        ...(note ? { note } : {}),
        channel: 'mcp',
        focus: 'whole',
        modeHint: mode,
      };
      // Hosted MCP tokens map to hosted users in a later step; when req.hosted is absent the
      // context stays undefined and the tool behaves exactly as self-hosted (ADR 0032).
      const out = ingest(req, { repo, ctx, adapterFor: (m) => worker.brains.forMode(m) });
      worker.kick();
      return text(
        `${out.deduplicated ? 'Already saved recently; re-running on the existing chat' : 'Queued'} as chat \`${out.chat.id}\` (run \`${out.run.id}\`${session ? `, requested by device "${session.deviceName}"` : ''}).`,
      );
    },
  );

  server.registerTool(
    'ask_library',
    {
      title: 'Ask a question over the whole library',
      description:
        'The Doubletake brain answers from the saved chats (FTS-retrieved), like "what did I save about ski wax?". ' +
        'Returns the chat id; poll get_chat with wait_seconds for the answer.',
      inputSchema: { question: z.string().trim().min(1).max(4000), mode: modeHint },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ question, mode }) => {
      const out = ingest(
        { text: question, channel: 'library', focus: 'whole', modeHint: mode },
        { repo, ctx, adapterFor: (m) => worker.brains.forMode(m) },
      );
      worker.kick();
      return text(`Asked as chat \`${out.chat.id}\` (run \`${out.run.id}\`).`);
    },
  );

  return server;
}

/** Default /mcp budget in hosted mode (ADR 0032): 60 requests per minute per session. */
export const MCP_RATE_LIMIT = { max: 60, windowMs: 60_000 };

export interface McpRateLimiterOptions {
  max?: number;
  windowMs?: number;
  /** Injectable clock so tests can run a fake timeline (defaults to `Date.now`). */
  now?: () => number;
}

/**
 * Per-key token bucket for /mcp (ADR 0032, hosted mode): refills continuously at
 * `max / windowMs` tokens per ms. Keys are the hosted session id, falling back to a hash of the
 * device bearer token. Deliberately in-memory: a hosted MCP flood costs a bucket per pod, not
 * an outage.
 */
export class McpRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: McpRateLimiterOptions = {}) {
    this.max = opts.max ?? MCP_RATE_LIMIT.max;
    this.windowMs = opts.windowMs ?? MCP_RATE_LIMIT.windowMs;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Consume one token; when refused, `retryAfterS` is the seconds until one refills. */
  take(key: string): { ok: boolean; retryAfterS: number } {
    const t = this.now();
    const perMs = this.max / this.windowMs;
    if (this.buckets.size > 4096) {
      // Drop idle buckets so a rotating-key flood cannot grow the map without bound.
      for (const [k, b] of this.buckets) if (t - b.ts > 2 * this.windowMs) this.buckets.delete(k);
    }
    const prev = this.buckets.get(key);
    const tokens = Math.min(this.max, (prev?.tokens ?? this.max) + (t - (prev?.ts ?? t)) * perMs);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, ts: t });
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
    }
    this.buckets.set(key, { tokens: tokens - 1, ts: t });
    return { ok: true, retryAfterS: 0 };
  }
}

/**
 * Mount the stateless Streamable HTTP endpoint. The auth hook in `server.ts` has already
 * populated `req.session` (device token) or `req.hosted` (hosted `dth_` token, ADR 0032);
 * requests with neither never reach these handlers.
 */
export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  // Hosted only: self-hosted single-owner deployments keep the exact pre-flag request path.
  const limiter = new McpRateLimiter();
  app.post(MCP_PATH, async (req, reply) => {
    const session = req.session;
    const hosted = (req as FastifyRequest & { hosted?: { userId?: string; sessionId?: string } })
      .hosted;
    if (!session && !hosted?.userId) return reply.code(401).send({ error: 'unauthorized' });
    if (isHostedMode()) {
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
      const key =
        hosted?.sessionId ??
        (bearer ? createHash('sha256').update(bearer).digest('hex') : 'anonymous');
      const { ok, retryAfterS } = limiter.take(key);
      if (!ok) {
        reply.header('retry-after', String(retryAfterS));
        return reply.code(429).send({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'rate limited; retry later' },
          id: null,
        });
      }
    }
    const ctx = hosted?.userId ? { userId: hosted.userId } : undefined;
    const server = buildMcpServer(deps, session, ctx);
    // No `sessionIdGenerator` = stateless mode. The SDK's option types are not written for
    // `exactOptionalPropertyTypes`, hence the casts.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    } as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error(err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
    }
  });

  // Stateless: no server-initiated stream to subscribe to and no session to delete.
  const notAllowed = async (_req: unknown, reply: import('fastify').FastifyReply) =>
    reply
      .code(405)
      .header('allow', 'POST')
      .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get(MCP_PATH, notAllowed);
  app.delete(MCP_PATH, notAllowed);
}
