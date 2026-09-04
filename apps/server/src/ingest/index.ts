import type { IngestRequest, Mode, Platform } from '@doubletake/shared';
import { resolveRequestedMode } from '@doubletake/shared';
import type { ChatRow, ItemRow, Repo, RunRow } from '../db/repo.js';
import { detectPlatform, firstUrlIn } from '../extract/registry.js';

export interface IngestOutcome {
  item: ItemRow;
  chat: ChatRow;
  run: RunRow;
  /** True when the same URL + focus was shared in the last 24 h and we re-ran on the existing chat. */
  deduplicated: boolean;
}

/** Which adapter (and model) a new research run is recorded with, given its provisional mode. */
export type AdapterPick = (mode: Mode) => { adapter: { id: string }; model: string | null };

export type IngestDeps = { repo: Repo } & ({ adapterId: string } | { adapterFor: AdapterPick });

function pickAdapter(deps: IngestDeps): AdapterPick {
  return 'adapterFor' in deps
    ? deps.adapterFor
    : () => ({ adapter: { id: deps.adapterId }, model: null });
}

const DEDUPE_HOURS = 24;

/**
 * Normalise a share into item + chat + queued run. Free text with a URL inside becomes a URL share
 * (share sheets send "caption + link"); text without a URL is a `text` item. Mode is decided later by
 * the worker (keywords, then classifier) unless the sharer forced one.
 */
export function ingest(req: IngestRequest, deps: IngestDeps): IngestOutcome {
  if (req.channel === 'library') return ingestLibraryQuestion(req, deps);
  const { repo } = deps;
  const url = req.url ?? (req.text ? firstUrlIn(req.text) : undefined);
  let platform: Platform = 'text';
  let canonicalUrl: string | null = null;
  if (url) {
    const det = detectPlatform(url);
    if (!det) throw new IngestError('unsupported URL (only http/https)');
    platform = det.platform;
    canonicalUrl = det.canonicalUrl;
  }
  const forcedMode: Mode | null = resolveRequestedMode(req.modeHint);
  const normalised: IngestRequest = {
    ...req,
    ...(url ? { url } : {}),
    ...(req.text && url && req.text.trim() === url ? { text: undefined } : {}),
  };

  if (canonicalUrl) {
    const dup = repo.findRecentDuplicate(canonicalUrl, req.focus, DEDUPE_HOURS);
    if (dup) {
      const chat = repo.getChatByItem(dup.id);
      if (chat) {
        // Re-share within the window: new research run on the existing chat, note appended.
        if (req.note?.trim()) {
          repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: req.note });
        }
        const mode = forcedMode ?? (dup.modeEffective as Mode | null) ?? 'standard';
        const bound = pickAdapter(deps)(mode);
        const run = repo.createRun({
          itemId: dup.id,
          chatId: chat.id,
          kind: 'research',
          mode,
          adapter: bound.adapter.id,
          model: bound.model,
        });
        repo.updateItem(dup.id, {
          status: 'new',
          ...(req.note ? { note: [dup.note, req.note].filter(Boolean).join('\n\n') } : {}),
        });
        return { item: dup, chat, run, deduplicated: true };
      }
    }
  }

  const title = canonicalUrl ? titleFromUrl(canonicalUrl, platform) : titleFromText(req.text ?? '');
  const { item, chat } = repo.createItemWithChat(normalised, platform, canonicalUrl, title);
  // Placeholder until the worker classifies; forced modes are final. The worker rebinds the
  // adapter if classification lands on a mode with a different binding.
  const mode = forcedMode ?? 'standard';
  const bound = pickAdapter(deps)(mode);
  const run = repo.createRun({
    itemId: item.id,
    chatId: chat.id,
    kind: 'research',
    mode,
    adapter: bound.adapter.id,
    model: bound.model,
  });
  if (req.note?.trim()) {
    repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: req.note });
  }
  return { item, chat, run, deduplicated: false };
}

export class IngestError extends Error {}

/**
 * Channel `library`: `text` (or `note`) is a question about what the owner saved earlier. No URL
 * detection, no dedupe, platform `text`; the question becomes the item note (so it shows as the
 * first message of the chat and as `ResearchBrief.note`) and the worker retrieves the context
 * (ADR 0021).
 */
function ingestLibraryQuestion(req: IngestRequest, deps: IngestDeps): IngestOutcome {
  const { repo } = deps;
  const question = (req.text ?? req.note ?? '').trim();
  if (!question) throw new IngestError('a question is required');
  const forcedMode: Mode | null = resolveRequestedMode(req.modeHint);
  const normalised: IngestRequest = {
    channel: 'library',
    focus: 'whole',
    modeHint: req.modeHint,
    note: question,
  };
  const { item, chat } = repo.createItemWithChat(normalised, 'text', null, titleFromText(question));
  const mode = forcedMode ?? 'quick';
  const bound = pickAdapter(deps)(mode);
  const run = repo.createRun({
    itemId: item.id,
    chatId: chat.id,
    kind: 'research',
    mode,
    adapter: bound.adapter.id,
    model: bound.model,
  });
  repo.addMessage({ chatId: chat.id, role: 'user', kind: 'question', content: question });
  return { item, chat, run, deduplicated: false };
}

export function titleFromUrl(url: string, platform: Platform): string {
  try {
    const u = new URL(url);
    const label: Record<Platform, string> = {
      instagram: 'Instagram post',
      tiktok: 'TikTok',
      youtube: u.pathname.startsWith('/shorts/') ? 'YouTube Short' : 'YouTube video',
      x: 'Post on X',
      reddit: 'Reddit thread',
      aichat: 'Shared AI chat',
      web: u.hostname.replace(/^www\./, ''),
      text: 'Note',
    };
    return label[platform];
  } catch {
    return 'Shared link';
  }
}

export function titleFromText(text: string): string {
  const first = text.trim().split(/\r?\n/)[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || 'Note';
}
