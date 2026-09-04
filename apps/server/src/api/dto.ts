import type {
  Answer,
  ChatDetail,
  ChatSummary,
  EntityHit,
  MessageDto,
  RunDto,
} from '@doubletake/shared';
import type { ChatRow, ItemRow, MessageRow, Repo, RunRow } from '../db/repo.js';
import { extractionText, parseExtraction } from '../extract/flatten.js';

export function toChatSummary(repo: Repo, chat: ChatRow, item: ItemRow): ChatSummary {
  return {
    id: chat.id,
    itemId: item.id,
    title: item.title ?? 'Untitled',
    platform: item.platform as ChatSummary['platform'],
    status: item.status as ChatSummary['status'],
    category: (item.category as ChatSummary['category']) ?? null,
    unreadCount: chat.unreadCount,
    lastMessageAt: chat.lastMessageAt,
    createdAt: chat.createdAt,
    sourceUrl: item.canonicalUrl ?? item.sourceUrl,
    tags: repo.listTags(item.id),
  };
}

export function toMessageDto(m: MessageRow): MessageDto {
  let structured: Answer | null = null;
  if (m.structured) {
    try {
      structured = JSON.parse(m.structured) as Answer;
    } catch {
      structured = null;
    }
  }
  return {
    id: m.id,
    role: m.role as MessageDto['role'],
    kind: m.kind as MessageDto['kind'],
    content: m.content,
    structured,
    runId: m.runId,
    createdAt: m.createdAt,
  };
}

export function toRunDto(r: RunRow): RunDto {
  return {
    id: r.id,
    kind: r.kind as RunDto['kind'],
    mode: r.mode as RunDto['mode'],
    adapter: r.adapter,
    model: r.model,
    status: r.status as RunDto['status'],
    costUsd: r.costUsd,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    error: r.error,
  };
}

export function toChatDetail(repo: Repo, chat: ChatRow, item: ItemRow): ChatDetail {
  return {
    chat: toChatSummary(repo, chat, item),
    item: {
      note: item.note,
      focus: item.focus,
      modeRequested: item.modeRequested as ChatDetail['item']['modeRequested'],
      modeEffective: (item.modeEffective as ChatDetail['item']['modeEffective']) ?? null,
      questionType: (item.questionType as ChatDetail['item']['questionType']) ?? null,
      canonicalUrl: item.canonicalUrl,
    },
    messages: repo.listMessages(chat.id).map(toMessageDto),
    runs: repo.listRuns(chat.id).map(toRunDto),
    entities: repo.listEntities(item.id).map((e) => ({
      kind: e.kind as ChatDetail['entities'][number]['kind'],
      name: e.name,
      attributes: safeJson(e.attributes),
      ...(e.url ? { url: e.url } : {}),
      confidence: e.confidence ?? 0.7,
    })),
    extractions: latestExtractions(repo.listExtractions(item.id)),
  };
}

/** Re-runs store a fresh set of extractions; show only the newest per kind+tool. */
function latestExtractions(rows: ReturnType<Repo['listExtractions']>): ChatDetail['extractions'] {
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const e of rows) {
    const key = `${e.kind}|${e.tool ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || e.createdAt > prev.createdAt) byKey.set(key, e);
  }
  return [...byKey.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      tool: e.tool,
      createdAt: e.createdAt,
      text: extractionText(e.kind, parseExtraction(e.content)),
    }))
    .filter((e) => e.text.length > 0);
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One entity plus where it came from, for the per-kind entity views. */
export function toEntityHit(r: ReturnType<Repo['listEntitiesByKind']>[number]): EntityHit {
  return {
    kind: r.entity.kind as EntityHit['kind'],
    name: r.entity.name,
    attributes: safeJson(r.entity.attributes),
    ...(r.entity.url ? { url: r.entity.url } : {}),
    confidence: r.entity.confidence ?? 0.7,
    chatId: r.chatId,
    itemTitle: r.item.title ?? r.item.sourceUrl ?? 'Untitled',
    platform: r.item.platform as EntityHit['platform'],
    createdAt: r.item.createdAt,
  };
}
