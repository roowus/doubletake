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

import type { Answer, IngestRequest, UntrustedBlock, UntrustedKind } from '@doubletake/shared';
import { renderUntrustedAll, UNTRUSTED_PREAMBLE } from '@doubletake/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toChatDetail, toChatSummary } from '../api/dto.js';
import { ftsQuery } from '../api/fts.js';
import type { Session } from '../auth/index.js';
import type { ChatRow, ItemRow, Repo } from '../db/repo.js';
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

function summaryLine(repo: Repo, chat: ChatRow, item: ItemRow): string {
  const s = toChatSummary(repo, chat, item);
  const bits = [
    `- **${s.title}** (chat \`${s.id}\`, ${s.platform}${s.category ? `, ${s.category}` : ''}, ${s.status})`,
  ];
  if (s.sourceUrl) bits.push(`  ${s.sourceUrl}`);
  if (s.tags.length) bits.push(`  tags: ${s.tags.join(', ')}`);
  bits.push(`  saved ${s.createdAt}`);
  return bits.join('\n');
}

function latestAnswer(repo: Repo, chatId: string) {
  return repo
    .listMessages(chatId)
    .filter((m) => m.role === 'assistant' && m.kind === 'answer')
    .at(-1);
}

/** Markdown rendering of one chat: the owner's question, our answer, structure, sources, extractions. */
export function renderChat(
  repo: Repo,
  chat: ChatRow,
  item: ItemRow,
  opts: { extractions: boolean },
): string {
  const d = toChatDetail(repo, chat, item);
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

  const answer = latestAnswer(repo, chat.id);
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

/** Build a per-request MCP server bound to the calling device's session. */
export function buildMcpServer(deps: McpDeps, session: Session): McpServer {
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
      for (const itemId of repo.searchFts(q, limit)) {
        const item = repo.getItem(itemId);
        const chat = repo.getChatByItem(itemId);
        if (item && chat) rows.push(summaryLine(repo, chat, item));
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
      let rows = repo.listChats(limit);
      if (collection) {
        const c = repo.getCollection(collection);
        if (!c) return { ...text(`Collection ${collection} not found.`), isError: true };
        const ids = resolveCollection(repo, c);
        rows = rows.filter((r) => ids.has(r.item.id));
      }
      if (tag?.trim()) {
        const ids = new Set(repo.itemIdsByTag(tag));
        rows = rows.filter((r) => ids.has(r.item.id));
      }
      return text(
        rows.length ? rows.map((r) => summaryLine(repo, r.chat, r.item)).join('\n') : 'No chats.',
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
      const chat = repo.getChat(chat_id);
      if (!chat) return { ...text(`Chat ${chat_id} not found.`), isError: true };
      const deadline = Date.now() + wait_seconds * 1000;
      while (Date.now() < deadline && !extra.signal.aborted) {
        const run = repo.listRuns(chat.id).at(-1);
        if (!run || !['queued', 'extracting', 'researching'].includes(run.status)) break;
        await sleep(500);
      }
      const item = repo.getItem(chat.itemId);
      if (!item) return { ...text(`Chat ${chat_id} not found.`), isError: true };
      return text(renderChat(repo, chat, item, { extractions: include_extractions }));
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
      const cols = listCollections(repo, false, true);
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
      const tags = repo.listAllTags();
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
      const rows = repo.listEntitiesByKind(kind, limit);
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
      const out = ingest(req, { repo, adapterFor: (m) => worker.brains.forMode(m) });
      worker.kick();
      return text(
        `${out.deduplicated ? 'Already saved recently; re-running on the existing chat' : 'Queued'} as chat \`${out.chat.id}\` (run \`${out.run.id}\`, requested by device "${session.deviceName}").`,
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
        { repo, adapterFor: (m) => worker.brains.forMode(m) },
      );
      worker.kick();
      return text(`Asked as chat \`${out.chat.id}\` (run \`${out.run.id}\`).`);
    },
  );

  return server;
}

/**
 * Mount the stateless Streamable HTTP endpoint. The auth hook in `server.ts` has already
 * populated `req.session`; requests without one never reach these handlers.
 */
export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  app.post(MCP_PATH, async (req, reply) => {
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    const server = buildMcpServer(deps, session);
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
