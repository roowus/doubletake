/**
 * Cross-library chat: turn a question into the untrusted blocks a brain needs to answer it
 * from what the owner saved earlier (docs/ARCHITECTURE.md §8 "Library chat", ADR 0021).
 *
 * Retrieval is plain FTS5 over items_fts (title, note, extractions, answers). For each hit we
 * hand the brain the item's title, note, tags, entities, the latest assistant answer and a
 * short slice of the extracted text, labelled with the chat's /chat/<id> path so the answer
 * can cite it. Past answers are our own output, but they were produced from scraped content,
 * so they stay inside untrusted blocks like everything else.
 */

import type { UntrustedBlock } from '@doubletake/shared';
import type { Repo } from '../db/repo.js';
import { extractionText, parseExtraction } from '../extract/flatten.js';

/** Extraction `tool` under which the retrieved context is stored on the asking item. */
export const LIBRARY_TOOL = 'library-fts';

export interface LibraryHit {
  itemId: string;
  chatId: string;
  title: string;
  /** Text handed to the brain for this hit (already capped). */
  text: string;
}

export interface LibraryContext {
  hits: LibraryHit[];
  blocks: UntrustedBlock[];
  /** One line per consulted chat, for `ResearchBrief.localContextHints`. */
  hints: string[];
}

export interface AskOptions {
  /** Item asking the question; never retrieved as its own context. */
  excludeItemId?: string;
  /** Max chats consulted (default 8). */
  limit?: number;
  /** Max characters per hit (default 3000). */
  perHitChars?: number;
  /** Max characters across all hits (default 16000). */
  totalChars?: number;
}

/**
 * Question words and glue that never identify a saved item. Everything else is kept, so a
 * question phrased around a real term ("ski wax", "that sourdough schedule") still hits.
 */
const STOPWORDS = new Set(
  (
    'a an the and or of to in on at for with about from by as is are was were be been being ' +
    'do does did done have has had i me my mine we our you your it its this that these those ' +
    'there here what which who whom whose when where why how did anything something everything ' +
    'any some all one ones thing things stuff saved save shared share said say tell show find ' +
    'remember recall know knew look looked looking see saw again earlier before ago recently ' +
    'ever once last week month year today yesterday please can could would should will shall ' +
    'was there any what did i save'
  ).split(/\s+/),
);

/**
 * FTS5 query for a natural-language question: stopwords dropped, remaining terms prefix-matched
 * and OR-ed so a partial overlap still ranks (bm25 orders the best overlap first). The normal
 * list search (`api/fts.ts`) ANDs terms because there the owner types keywords, not sentences.
 */
export function libraryQuery(question: string): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of question.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const t = raw.trim();
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
  }
  return terms.map((t) => `"${t}"*`).join(' OR ');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function libraryContext(
  repo: Repo,
  question: string,
  opts: AskOptions = {},
): LibraryContext {
  const limit = opts.limit ?? 8;
  const perHit = opts.perHitChars ?? 3000;
  const total = opts.totalChars ?? 16000;
  const query = libraryQuery(question);
  const hits: LibraryHit[] = [];
  const blocks: UntrustedBlock[] = [];
  const hints: string[] = [];
  if (!query) return { hits, blocks, hints };

  let used = 0;
  // Over-fetch a little so excluding the asking item and other library questions still fills `limit`.
  for (const itemId of repo.searchFts(query, limit * 2 + 2)) {
    if (hits.length >= limit || used >= total) break;
    if (itemId === opts.excludeItemId) continue;
    const item = repo.getItem(itemId);
    const chat = repo.getChatByItem(itemId);
    if (!item || !chat || item.channel === 'library') continue;

    const parts: string[] = [];
    if (item.note?.trim()) parts.push(`Note: ${item.note.trim()}`);
    const url = item.canonicalUrl ?? item.sourceUrl;
    if (url) parts.push(`Source: ${url}`);
    const tags = repo.listTags(itemId);
    if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
    const entities = repo.listEntities(itemId);
    if (entities.length) {
      parts.push(
        `Entities: ${entities
          .slice(0, 12)
          .map((e) => `${e.name} (${e.kind})`)
          .join('; ')}`,
      );
    }
    const answer = repo
      .listMessages(chat.id)
      .filter((m) => m.role === 'assistant' && m.kind === 'answer')
      .at(-1);
    if (answer) parts.push(`Answer:\n${answer.content.trim()}`);
    const budgetLeft = perHit - parts.join('\n').length;
    if (budgetLeft > 200) {
      const snippets: string[] = [];
      for (const x of repo.listExtractions(itemId)) {
        if (x.tool === LIBRARY_TOOL) continue;
        const text = extractionText(x.kind, parseExtraction(x.content)).trim();
        if (text) snippets.push(`[${x.kind}] ${text}`);
      }
      if (snippets.length) parts.push(`Extracted text:\n${clip(snippets.join('\n'), budgetLeft)}`);
    }
    const text = clip(parts.join('\n\n'), Math.min(perHit, total - used));
    if (!text.trim()) continue;
    used += text.length;
    const title = item.title ?? 'Untitled';
    hits.push({ itemId, chatId: chat.id, title, text });
    blocks.push({
      source: 'library',
      kind: 'page_text',
      label: `${title} (/chat/${chat.id})`,
      content: text,
    });
    hints.push(`${title}: /chat/${chat.id}`);
  }
  return { hits, blocks, hints };
}
