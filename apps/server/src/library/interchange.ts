/**
 * Karakeep and Memos interchange (ADR 0024). Export the library in the shapes those tools
 * import; import a Karakeep export file as items. No brain runs are queued by default: an
 * import must never spend money on its own.
 */

import type { IngestRequest, Mode, Platform } from '@doubletake/shared';
import { z } from 'zod';
import type { Repo } from '../db/repo.js';
import { detectPlatform } from '../extract/registry.js';
import type { AdapterPick } from '../ingest/index.js';
import { titleFromText, titleFromUrl } from '../ingest/index.js';

// ---- Karakeep export file (packages/shared/import-export/exporters.ts in karakeep, main) ----

export const KarakeepList = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  type: z.enum(['manual', 'smart']),
  query: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const KarakeepBookmark = z.object({
  /** Unix seconds. */
  createdAt: z.number(),
  title: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  /** List ids (matching `lists[].id`). */
  lists: z.array(z.string()).default([]),
  content: z
    .union([
      z.object({ type: z.literal('link'), url: z.string() }),
      z.object({ type: z.literal('text'), text: z.string() }),
    ])
    .nullable(),
  note: z.string().nullable(),
  archived: z.boolean().default(false),
});

export const KarakeepExport = z.object({
  bookmarks: z.array(KarakeepBookmark),
  lists: z.array(KarakeepList).optional(),
});
export type KarakeepExport = z.infer<typeof KarakeepExport>;

const MAX_TEXT = 20000;
const MAX_NOTE = 4000;

/** Owner note plus, after a rule, the first answer: what Karakeep shows under "Note". */
function noteWithAnswer(repo: Repo, itemId: string, note: string | null): string | null {
  const chat = repo.getChatByItem(itemId);
  const answer = chat
    ? repo.listMessages(chat.id).find((m) => m.role === 'assistant' && m.kind === 'answer')?.content
    : undefined;
  const parts = [note?.trim(), answer?.trim()].filter((p): p is string => !!p);
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

export function exportKarakeep(repo: Repo): KarakeepExport {
  const manual = repo.listCollections(true).filter((c) => c.manual);
  const lists = manual.map((c) => ({
    id: c.id,
    name: c.name,
    description: null,
    icon: '🔁',
    type: 'manual' as const,
    query: null,
    parentId: null,
  }));
  const bookmarks: KarakeepExport['bookmarks'] = [];
  for (const item of repo.listItems(100_000)) {
    // Questions over the library are not saved things; nobody wants them in a bookmark manager.
    if (item.channel === 'library') continue;
    const url = item.canonicalUrl ?? item.sourceUrl;
    const content = url
      ? { type: 'link' as const, url }
      : item.text
        ? { type: 'text' as const, text: item.text }
        : null;
    if (!content) continue;
    bookmarks.push({
      createdAt: Math.floor(new Date(item.createdAt).getTime() / 1000),
      title: item.title,
      tags: repo.listTags(item.id),
      lists: repo.collectionsForItem(item.id).filter((id) => manual.some((c) => c.id === id)),
      content,
      note: noteWithAnswer(repo, item.id, item.note),
      archived: false,
    });
  }
  return { bookmarks, lists };
}

// ---- Memos ----

export interface MemosMemo {
  /** Markdown; Memos derives tags from `#tag` tokens inside it. */
  content: string;
  visibility: 'PRIVATE';
  /** RFC 3339, so it can be posted as `create_time` (unverified: JSON casing over HTTP). */
  create_time: string;
}

function memoTag(name: string): string {
  return `#${name.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_/-]/gu, '')}`;
}

export function exportMemos(repo: Repo): { memos: MemosMemo[] } {
  const memos: MemosMemo[] = [];
  for (const item of repo.listItems(100_000)) {
    if (item.channel === 'library') continue;
    const url = item.canonicalUrl ?? item.sourceUrl;
    const lines: string[] = [`## ${item.title ?? 'Untitled'}`];
    if (url) lines.push('', url);
    else if (item.text) lines.push('', item.text);
    if (item.note?.trim()) lines.push('', `> ${item.note.trim().replace(/\n/g, '\n> ')}`);
    const chat = repo.getChatByItem(item.id);
    const answer = chat
      ? repo.listMessages(chat.id).find((m) => m.role === 'assistant' && m.kind === 'answer')
      : undefined;
    if (answer) lines.push('', answer.content.trim());
    const tags = repo
      .listTags(item.id)
      .map(memoTag)
      .filter((t) => t.length > 1);
    if (tags.length) lines.push('', tags.join(' '));
    memos.push({ content: lines.join('\n'), visibility: 'PRIVATE', create_time: item.createdAt });
  }
  return { memos };
}

// ---- Karakeep import ----

export interface ImportOptions {
  /** Queue a research run for every imported item. Default: none (imports are free). */
  research?: Mode | null;
  adapterFor?: AdapterPick;
}

export interface ImportSummary {
  imported: number;
  /** Already in the library (same permalink), or a bookmark with no usable content. */
  skipped: number;
  collections: number;
  runs: number;
}

export function importKarakeep(
  repo: Repo,
  file: KarakeepExport,
  opts: ImportOptions = {},
): ImportSummary {
  const summary: ImportSummary = { imported: 0, skipped: 0, collections: 0, runs: 0 };
  // Karakeep list id → our collection id. Smart lists are queries in a syntax we do not speak;
  // only manual lists become collections, and only when a bookmark actually references them.
  const listById = new Map(
    (file.lists ?? []).filter((l) => l.type === 'manual').map((l) => [l.id, l]),
  );
  const collectionFor = new Map<string, string>();
  const collectionId = (listId: string): string | null => {
    const known = collectionFor.get(listId);
    if (known) return known;
    const list = listById.get(listId);
    if (!list) return null;
    const name = list.name.trim().slice(0, 80) || 'Imported';
    let id = repo.findCollectionByName(name)?.id;
    if (!id) {
      id = repo.createCollection({ name, query: '', manual: true, auto: false });
      summary.collections += 1;
    }
    collectionFor.set(listId, id);
    return id;
  };

  for (const b of file.bookmarks) {
    if (!b.content) {
      summary.skipped += 1;
      continue;
    }
    let platform: Platform = 'text';
    let canonicalUrl: string | null = null;
    let req: IngestRequest;
    let title: string;
    const note = b.note?.trim() ? b.note.trim().slice(0, MAX_NOTE) : undefined;
    if (b.content.type === 'link') {
      const det = detectPlatform(b.content.url);
      if (!det) {
        summary.skipped += 1;
        continue;
      }
      platform = det.platform;
      canonicalUrl = det.canonicalUrl;
      if (repo.findItemByCanonicalUrl(canonicalUrl)) {
        summary.skipped += 1;
        continue;
      }
      req = {
        url: b.content.url,
        channel: 'import',
        focus: 'whole',
        modeHint: 'auto',
        ...(note ? { note } : {}),
      };
      title = b.title?.trim() || titleFromUrl(b.content.url, platform);
    } else {
      const text = b.content.text.trim().slice(0, MAX_TEXT);
      if (!text) {
        summary.skipped += 1;
        continue;
      }
      req = {
        text,
        channel: 'import',
        focus: 'whole',
        modeHint: 'auto',
        ...(note ? { note } : {}),
      };
      title = b.title?.trim() || titleFromText(text);
    }
    const { item, chat } = repo.createItemWithChat(
      req,
      platform,
      canonicalUrl,
      title.slice(0, 200),
    );
    const created = new Date(b.createdAt * 1000);
    if (Number.isFinite(created.getTime()) && created.getTime() > 0) {
      repo.updateItem(item.id, { createdAt: created.toISOString() });
    }
    for (const tag of b.tags) repo.addManualTag(item.id, tag);
    for (const listId of b.lists) {
      const cid = collectionId(listId);
      if (cid) repo.addCollectionItem(cid, item.id);
    }
    if (note) repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: note });
    // Searchable at once, even without a run (the worker reindexes after research anyway).
    repo.upsertFts(item.id, {
      title,
      note: note ?? '',
      transcript: req.text ?? '',
      ocr: '',
      answer: '',
      tags: b.tags.join(' '),
      entities: '',
    });
    if (opts.research && opts.adapterFor) {
      const bound = opts.adapterFor(opts.research);
      repo.createRun({
        itemId: item.id,
        chatId: chat.id,
        kind: 'research',
        mode: opts.research,
        adapter: bound.adapter.id,
        model: bound.model,
      });
      repo.updateItem(item.id, { modeRequested: opts.research });
      summary.runs += 1;
    }
    summary.imported += 1;
  }
  return summary;
}
