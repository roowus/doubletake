import { EventEmitter } from 'node:events';
import type { BrainAdapter, ResearchBrief, RunOptions, ToolPolicy } from '@doubletake/brain-sdk';
import type { Answer, Mode, QuestionType, RunEvent, UntrustedBlock } from '@doubletake/shared';
import { FOLLOWUP_BUDGET, MODE_BUDGETS, pickModeByKeywords } from '@doubletake/shared';
import { LIBRARY_TEMPLATE, OUTPUT_TEMPLATES, SYSTEM_FRAMING } from '../brains/prompts.js';
import { BrainSet } from '../brains/registry.js';
import type { Config } from '../config/index.js';
import type { ItemRow, Repo, RunRow } from '../db/repo.js';
import { exportItemMarkdown } from '../export/markdown.js';
import { extractionText, parseExtraction } from '../extract/flatten.js';
import { fetchText } from '../extract/http.js';
import { PAGE_ONLY } from '../extract/platforms/_shared.js';
import { extractUrl } from '../extract/registry.js';
import type { ExtractResult } from '../extract/types.js';
import { classifyItem } from '../ingest/classify.js';
import { LIBRARY_TOOL, libraryContext } from '../library/ask.js';
import type { ExtractParams, MediaClient } from '../media/protocol.js';
import { asUntrustedKind, MEDIA_PLATFORMS, runMediaStage } from '../media/stage.js';
import type { Notification } from '../notify/types.js';

const MODE_RANK: Record<Mode, number> = { quick: 0, standard: 1, deep: 2 };
const NO_MORE_RESEARCH =
  /\bno (further|more|additional) (research|investigation|searching)\b|not (needed|necessary|required)\b|sufficient/i;

/**
 * Models sometimes misuse `escalate` to say "no further research needed". Only surface an
 * offer that points at a strictly higher mode and whose reason does not negate itself.
 */
export function escalationIsMeaningful(
  esc: { mode: Mode | string; reason: string },
  current: Mode,
): boolean {
  const target = MODE_RANK[esc.mode as Mode];
  if (target === undefined || target <= MODE_RANK[current]) return false;
  return !NO_MORE_RESEARCH.test(esc.reason ?? '');
}

export interface WorkerEvents {
  run_event: (e: RunEvent) => void;
  chat_updated: (chatId: string) => void;
}

/** `extractions.tool` value for rows a channel wrote before the run (Instagram Graph API). */
export const CHANNEL_TOOL = 'instagram-graph';

/** What the worker needs from the notification layer; the hub implements it. */
export interface RunNotifier {
  notify(n: Notification): Promise<unknown>;
}

/** Push payloads: title and a short status only, never answer text (ADR 0008). */
export function buildNotification(
  item: { title: string | null; note: string | null },
  chatId: string,
  outcome: 'answered' | 'failed' | 'capped',
  publicUrl: string | null,
): Notification {
  const subject = (item.title || item.note || 'your share').trim().slice(0, 80);
  const body =
    outcome === 'answered'
      ? 'Answer ready. Tap to open the chat.'
      : outcome === 'failed'
        ? 'Research failed. Tap to see why.'
        : 'Paused: daily spend cap reached.';
  const path = `/chat/${chatId}`;
  return {
    title: outcome === 'answered' ? subject : `${subject} — ${outcome}`,
    body,
    chatId,
    url: publicUrl ? `${publicUrl.replace(/\/$/, '')}${path}` : path,
    tag: `chat-${chatId}`,
  };
}

/** Small reserve kept under the daily cap so follow-ups still work after research is capped. */
const FOLLOWUP_RESERVE_USD = 0.5;

/**
 * Single-consumer queue: one run at a time, straight from SQLite (`runs.status='queued'`).
 * Survives restarts because state lives in the DB; `requeueInterrupted()` runs at boot.
 */
export class QueueWorker extends EventEmitter {
  private running = false;
  private stopped = false;
  private current: { runId: string; ac: AbortController } | null = null;
  private wake: (() => void) | null = null;

  /** Optional; set by the boot sequence once notifiers are configured. */
  notifier: RunNotifier | null = null;
  /** Optional; the media worker client (null when `DOUBLETAKE_MEDIA_WORKER=off`). */
  media: MediaClient | null = null;

  /** Default adapter plus per-mode bindings; a bare adapter is wrapped as a one-member set. */
  readonly brains: BrainSet;

  constructor(
    private readonly repo: Repo,
    brain: BrainAdapter | BrainSet,
    private readonly cfg: Config,
    media: MediaClient | null = null,
  ) {
    super();
    this.brains = BrainSet.from(brain);
    this.media = media;
  }

  /** Channels that want to know when an item finished (Instagram reacts to the DM). */
  onOutcome:
    | ((item: ItemRow, outcome: 'answered' | 'failed' | 'capped') => Promise<unknown>)
    | null = null;
  /** Channel-supplied media shortcuts for an item (Instagram CDN url); consulted per run. */
  mediaHints: ((item: ItemRow) => ExtractParams['hints']) | null = null;
  /** Locates place entities after a research run (ADR 0022); null when no geocoder is configured. */
  locatePlaces: ((itemId: string) => Promise<void>) | null = null;

  private push(item: ItemRow, chatId: string, outcome: 'answered' | 'failed' | 'capped'): void {
    if (this.onOutcome) this.onOutcome(item, outcome).catch(() => {});
    if (!this.notifier) return;
    const n = buildNotification(item, chatId, outcome, this.cfg.publicUrl);
    this.notifier.notify(n).catch(() => {});
  }

  start(): void {
    this.repo.requeueInterrupted();
    this.stopped = false;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.current?.ac.abort();
    this.wake?.();
    while (this.running) await new Promise((r) => setTimeout(r, 25));
  }

  /** Nudge the loop after enqueueing (otherwise it polls every 2 s). */
  kick(): void {
    this.wake?.();
  }

  cancel(runId: string): boolean {
    if (this.current?.runId === runId) {
      this.current.ac.abort();
      return true;
    }
    return false;
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopped) {
        const run = this.repo.nextQueuedRun();
        if (!run) {
          await new Promise<void>((r) => {
            this.wake = r;
            setTimeout(r, 2000);
          });
          this.wake = null;
          continue;
        }
        await this.process(run);
      }
    } finally {
      this.running = false;
    }
  }

  // ---- one run ----

  private async process(run: RunRow): Promise<void> {
    const ac = new AbortController();
    this.current = { runId: run.id, ac };
    const item = this.repo.getItem(run.itemId);
    const chat = this.repo.getChat(run.chatId);
    if (!item || !chat) {
      this.repo.updateRun(run.id, { status: 'failed', error: 'item or chat vanished' });
      this.current = null;
      return;
    }
    let seq = 0;
    const emit = (type: RunEvent['type'], payload: Record<string, unknown>) => {
      seq += 1;
      this.repo.addRunEvent(run.id, seq, type, payload);
      this.emit('run_event', {
        runId: run.id,
        chatId: run.chatId,
        seq,
        type,
        payload,
        at: new Date().toISOString(),
      } satisfies RunEvent);
    };

    // Daily cap: research runs wait; follow-ups pass while a small reserve remains.
    const spent = this.repo.spentToday();
    const cap = this.cfg.dailyCapUsd;
    const over = run.kind === 'followup' ? spent >= cap + FOLLOWUP_RESERVE_USD : spent >= cap;
    if (cap > 0 && over) {
      this.repo.updateRun(run.id, { status: 'capped', error: `daily cap ${cap} USD reached` });
      this.repo.updateItem(item.id, { status: 'capped' });
      this.repo.addMessage({
        chatId: chat.id,
        role: 'system',
        kind: 'status',
        content: `Paused: today's spend (${spent.toFixed(2)} USD) reached the daily cap (${cap} USD). Re-run tomorrow or raise the cap in settings.`,
        runId: run.id,
      });
      emit('done', { stopReason: 'capped' });
      this.emit('chat_updated', chat.id);
      this.push(item, chat.id, 'capped');
      this.current = null;
      return;
    }

    const started = new Date().toISOString();
    this.repo.updateRun(run.id, { status: 'extracting', startedAt: started });
    this.repo.updateItem(item.id, { status: 'extracting' });
    this.emit('chat_updated', chat.id);
    // Hard ceiling for the whole run. Research runs also get the media budget because the media
    // stage (which has its own per-request timeout) runs before the mode clock is meaningful.
    const budget = MODE_BUDGETS[run.mode as Mode];
    const ceilingMs =
      budget.wallClockMs + (run.kind === 'followup' ? 0 : budget.mediaWallClockMs) + 60_000;
    const timer = setTimeout(() => ac.abort(), ceilingMs);

    try {
      const result =
        run.kind === 'followup'
          ? await this.followUp(run, item, chat.id, chat.brainSessionId, emit, ac.signal)
          : await this.research(run, item, chat.id, emit, ac.signal);
      this.finish(run, item, chat.id, result, emit);
    } catch (e) {
      const msg = ac.signal.aborted ? 'Run cancelled or timed out.' : (e as Error).message;
      this.repo.updateRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: msg,
      });
      this.repo.updateItem(item.id, { status: 'failed' });
      this.repo.addMessage({
        chatId: chat.id,
        role: 'system',
        kind: 'error',
        content: `Run failed: ${msg}`,
        runId: run.id,
        unread: true,
      });
      emit('error', { message: msg });
      emit('done', { stopReason: 'error' });
      this.push(item, chat.id, 'failed');
    } finally {
      clearTimeout(timer);
      this.current = null;
      this.emit('chat_updated', chat.id);
    }
  }

  private policyFor(mode: Mode, kind: 'research' | 'followup'): ToolPolicy {
    const b = MODE_BUDGETS[mode];
    const f = FOLLOWUP_BUDGET;
    return {
      webSearch: true,
      webFetch: true,
      maxSearches: kind === 'followup' ? f.maxSearches : b.maxSearches,
      maxFetches: kind === 'followup' ? f.maxFetches : b.maxFetches,
      readRoots: b.readFiles ? this.cfg.readRoots : [],
      readDeny: this.cfg.readDeny,
      maxReadBytes: 2 * 1024 * 1024,
      writeRoot: b.writeSandbox && kind === 'research' ? this.cfg.notesDir : null,
    };
  }

  private runOptions(
    mode: Mode,
    kind: 'research' | 'followup',
    signal: AbortSignal,
    sessionId: string | null,
    model: string | null,
  ): RunOptions {
    const b = MODE_BUDGETS[mode];
    const m = model ?? this.cfg.brainModel;
    return {
      mode,
      maxTurns: kind === 'followup' ? FOLLOWUP_BUDGET.maxTurns : b.maxTurns,
      maxBudgetUsd: kind === 'followup' ? FOLLOWUP_BUDGET.maxBudgetUsd : b.maxBudgetUsd,
      ...(m ? { model: m } : {}),
      ...(sessionId ? { sessionId } : {}),
      tools: this.policyFor(mode, kind),
      signal,
    };
  }

  private buildBrief(
    item: ItemRow,
    blocks: UntrustedBlock[],
    questionType: QuestionType,
    hints: string[] = [],
  ): ResearchBrief {
    const library = item.channel === 'library';
    return {
      systemFraming: SYSTEM_FRAMING,
      untrusted: blocks,
      note: item.note,
      focus: item.focus,
      questionType,
      outputTemplate: library ? LIBRARY_TEMPLATE : OUTPUT_TEMPLATES[questionType],
      localContextHints: hints,
      sourceUrl: item.canonicalUrl ?? item.sourceUrl,
      title: item.title,
      kind: library ? 'library' : 'share',
    };
  }

  /**
   * Channel `library`: the item is a question over the owner's own library. Retrieval replaces
   * extraction, the classifier is skipped (keywords or the forced mode decide; quick by default
   * so the answer comes from the library rather than the web) and the brief is a library brief.
   */
  private async researchLibrary(
    run: RunRow,
    item: ItemRow,
    chatId: string,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    const forced = item.modeRequested !== 'auto' ? (item.modeRequested as Mode) : null;
    const question = item.note ?? item.text ?? '';
    emit('status', { phase: 'retrieving' });
    const ctx = libraryContext(this.repo, question, { excludeItemId: item.id });
    for (const h of ctx.hits) {
      this.repo.addExtraction({
        itemId: item.id,
        kind: 'page_text',
        tool: LIBRARY_TOOL,
        content: `${h.title} (/chat/${h.chatId})\n\n${h.text}`,
      });
    }
    emit('status', {
      phase: 'retrieved',
      hits: ctx.hits.length,
      chats: ctx.hits.map((h) => h.chatId),
    });

    const mode: Mode = forced ?? pickModeByKeywords(question) ?? 'quick';
    const questionType: QuestionType = 'other';
    const bound = this.brains.forMode(mode);
    const model = bound.model ?? this.cfg.brainModel;
    let current = run;
    if (bound.adapter.id !== run.adapter || model !== run.model) {
      current = { ...run, adapter: bound.adapter.id, model };
      this.repo.updateRun(run.id, { adapter: current.adapter, model });
      emit('status', { phase: 'adapter', adapter: current.adapter, ...(model ? { model } : {}) });
    }
    this.repo.updateRun(run.id, { mode, status: 'researching' });
    this.repo.updateItem(item.id, { modeEffective: mode, questionType, status: 'researching' });
    emit('status', { phase: 'mode', mode, questionType, source: forced ? 'forced' : 'library' });
    this.emit('chat_updated', chatId);

    const brief = this.buildBrief(item, ctx.blocks, questionType, ctx.hints);
    const opts = this.runOptions(mode, 'research', signal, null, bound.model);
    const result = await bound.adapter.run(brief, opts, { emit: (e) => emit(e.type, e.payload) });
    return { ...result, mode, run: current, kind: 'research' as const };
  }

  private async research(
    run: RunRow,
    item: ItemRow,
    chatId: string,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    if (item.channel === 'library') return this.researchLibrary(run, item, chatId, emit, signal);
    // 1. Extract. Forced modes decide extraction depth; auto starts standard and is refined below.
    const forced = item.modeRequested !== 'auto' ? (item.modeRequested as Mode) : null;
    // Provisional adapter for the extraction stage; the effective mode below may rebind it.
    let bound = this.brains.forMode(forced ?? (run.mode as Mode));
    let extraction: ExtractResult | null = null;
    const url = item.canonicalUrl ?? item.sourceUrl;
    const blocks: UntrustedBlock[] = [];
    if (url) {
      emit('status', { phase: 'extracting', url });
      extraction = await extractUrl(url, {
        mode: forced ?? 'standard',
        focus: item.focus,
        signal,
        fetchText: (u, o) => fetchText(u, { ...o, signal }),
      });
      for (const x of extraction.extractions) {
        this.repo.addExtraction({
          itemId: item.id,
          kind: x.kind,
          content: x.content,
          tool: x.tool,
        });
      }
      blocks.push(...extraction.blocks);
      for (const w of extraction.warnings) emit('status', { phase: 'warning', message: w });
      if (extraction.title && (!item.title || isGenericTitle(item.title))) {
        this.repo.updateItem(item.id, { title: extraction.title });
        item = { ...item, title: extraction.title };
      }
      // Extractors may only learn the real URL at fetch time (Reddit app share links 301 to
      // the thread); keep the resolved one so dedupe and export use it.
      if (extraction.canonicalUrl && extraction.canonicalUrl !== url) {
        this.repo.updateItem(item.id, { canonicalUrl: extraction.canonicalUrl });
        item = { ...item, canonicalUrl: extraction.canonicalUrl };
      }
      if (extraction.platform !== item.platform) {
        this.repo.updateItem(item.id, { platform: extraction.platform });
        item = { ...item, platform: extraction.platform };
      }
      // 1b. Media pipeline (download, transcript, frames, OCR, comments) for media platforms.
      if (this.media && this.cfg.media.enabled && MEDIA_PLATFORMS.has(item.platform)) {
        const m = await runMediaStage({
          cfg: this.cfg,
          repo: this.repo,
          brain: this.brains.visionFor(bound.adapter),
          media: this.media,
          item,
          url: item.canonicalUrl ?? url,
          mode: forced ?? 'standard',
          hints: this.mediaHints?.(item) ?? {},
          signal,
          emit: (phase, p) => emit('status', { phase, ...p }),
        });
        blocks.push(...m.blocks);
        // The page extractor's "page-level only" note is moot once the worker supplied media.
        if (m.blocks.length) {
          extraction.warnings = extraction.warnings.filter((w) => w !== PAGE_ONLY);
        }
        for (const w of m.warnings) emit('status', { phase: 'warning', message: w });
        if (m.title && (!item.title || isGenericTitle(item.title))) {
          this.repo.updateItem(item.id, { title: m.title });
          item = { ...item, title: m.title };
        }
        if (m.canonicalUrl && m.canonicalUrl !== (item.canonicalUrl ?? url)) {
          this.repo.updateItem(item.id, { canonicalUrl: m.canonicalUrl });
          item = { ...item, canonicalUrl: m.canonicalUrl };
        }
      }
    }
    // 1c. Extractions a channel stored before the run (Instagram Graph comments / thread) are
    // authoritative for their kind and were not produced above; add them once.
    for (const x of this.repo.listExtractions(item.id)) {
      if (x.tool !== CHANNEL_TOOL) continue;
      const text = extractionText(x.kind, parseExtraction(x.content)).slice(0, 12_000);
      if (!text) continue;
      blocks.push({
        source: item.platform,
        kind: asUntrustedKind(x.kind),
        content: text,
        ...(x.kind === 'thread' ? { label: 'primary thread' } : {}),
      });
    }
    if (item.text?.trim()) {
      blocks.push({ source: 'owner', kind: 'shared_text', content: item.text });
    }

    // 2. Classify (mode + question type), unless already decided by an earlier run on this item.
    emit('status', { phase: 'classifying' });
    const cls = await classifyItem(
      {
        note: item.note,
        title: item.title,
        platform: item.platform,
        focus: item.focus,
        forcedMode: forced ?? (run.mode !== 'standard' ? (run.mode as Mode) : null),
        preview: blocks
          .map((b) => b.content)
          .join('\n')
          .slice(0, 600),
      },
      this.brains.defaultBrain,
      signal,
    );
    const mode = cls.mode;
    const questionType = cls.question_type;
    bound = this.brains.forMode(mode);
    const model = bound.model ?? this.cfg.brainModel;
    let current = run;
    if (bound.adapter.id !== run.adapter || model !== run.model) {
      current = { ...run, adapter: bound.adapter.id, model };
      this.repo.updateRun(run.id, { adapter: current.adapter, model });
      emit('status', { phase: 'adapter', adapter: current.adapter, ...(model ? { model } : {}) });
    }
    this.repo.updateRun(run.id, { mode, status: 'researching' });
    this.repo.updateItem(item.id, { modeEffective: mode, questionType, status: 'researching' });
    emit('status', { phase: 'mode', mode, questionType, source: cls.source });
    this.emit('chat_updated', chatId);

    // 3. Research.
    const brief = this.buildBrief(item, blocks, questionType);
    const opts = this.runOptions(mode, 'research', signal, null, bound.model);
    const result = await bound.adapter.run(brief, opts, { emit: (e) => emit(e.type, e.payload) });
    if (extraction?.warnings.length) {
      result.text = `${result.text}\n\n> Extraction notes: ${extraction.warnings.join('; ')}`;
    }
    return { ...result, mode, run: current, kind: 'research' as const };
  }

  private async followUp(
    run: RunRow,
    item: ItemRow,
    chatId: string,
    sessionId: string | null,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    const mode = (item.modeEffective as Mode | null) ?? 'quick';
    const questionType = (item.questionType as QuestionType | null) ?? 'other';
    const history = this.repo
      .listMessages(chatId)
      .filter((m) => m.role !== 'system' && m.runId !== run.id)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const blocks = this.storedBlocks(item);
    this.repo.updateRun(run.id, { status: 'researching' });
    // Follow-ups stay on the adapter that owns the chat's session; a per-mode model binding for
    // that adapter still applies so the resumed session keeps its model.
    const adapter = this.brains.get(run.adapter);
    const bound = this.brains.forMode(mode);
    const model = bound.adapter === adapter ? bound.model : null;
    emit('status', { phase: 'followup', resume: Boolean(sessionId), adapter: adapter.id });
    const result = await adapter.followUp(
      {
        chatId,
        ...(sessionId ? { sessionId } : {}),
        history,
        brief: this.buildBrief(item, blocks, questionType),
      },
      run.userMessage ?? '',
      this.runOptions(mode, 'followup', signal, sessionId, model),
      { emit: (e) => emit(e.type, e.payload) },
    );
    return { ...result, mode, run, kind: 'followup' as const };
  }

  /** Rebuild untrusted blocks from stored extractions for follow-ups without native resume. */
  private storedBlocks(item: ItemRow): UntrustedBlock[] {
    const out: UntrustedBlock[] = [];
    for (const x of this.repo.listExtractions(item.id)) {
      const text = extractionText(x.kind, parseExtraction(x.content)).slice(0, 8000);
      if (!text) continue;
      const source = x.tool === LIBRARY_TOOL ? 'library' : item.platform;
      out.push({ source, kind: asUntrustedKind(x.kind), content: text });
    }
    if (item.text?.trim()) out.push({ source: 'owner', kind: 'shared_text', content: item.text });
    return out;
  }

  private finish(
    started: RunRow,
    item: ItemRow,
    chatId: string,
    r: Awaited<ReturnType<QueueWorker['research']>> | Awaited<ReturnType<QueueWorker['followUp']>>,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
  ): void {
    // The research stage may have rebound the run to the mode's adapter; trust its copy.
    const run = r.run ?? started;
    const finished = new Date().toISOString();
    const ok = r.stopReason === 'done' || r.stopReason === 'max_turns' || r.stopReason === 'budget';
    if (!ok) throw new Error(r.error ?? `brain stopped: ${r.stopReason}`);
    const cost = r.costUsd ?? null;
    let text = r.text.trim() || '(the model returned no text)';
    if (r.stopReason === 'max_turns') text += '\n\n> Stopped at the turn limit for this mode.';
    if (r.stopReason === 'budget') text += '\n\n> Stopped at the cost budget for this mode.';

    this.repo.updateRun(run.id, {
      status: 'done',
      finishedAt: finished,
      costUsd: cost,
      ...(r.usage ? { tokensIn: r.usage.inputTokens, tokensOut: r.usage.outputTokens } : {}),
    });
    if (cost != null) this.repo.addCost(run.adapter, run.model ?? null, cost, run.id);
    if (r.sessionId)
      this.repo.updateChat(chatId, { brainSessionId: r.sessionId, brainAdapter: run.adapter });

    const structured: Answer | null = r.structured ?? null;
    this.repo.addMessage({
      chatId,
      role: 'assistant',
      kind: r.kind === 'followup' ? 'followup' : 'answer',
      content: text,
      structured,
      runId: run.id,
      unread: true,
    });
    if (structured) {
      if (r.kind === 'research') {
        this.repo.replaceEntities(item.id, run.id, structured.entities);
        if (this.locatePlaces && structured.entities.some((e) => e.kind === 'place')) {
          // Off the run's critical path: the answer, push and export never wait on the geocoder.
          void this.locatePlaces(item.id)
            .then(() => this.emit('chat_updated', chatId))
            .catch(() => {});
        }
      }
      if (structured.tags.length) this.repo.setAutoTags(item.id, structured.tags);
      this.repo.updateItem(item.id, { category: structured.category });
    }
    this.repo.updateItem(item.id, { status: 'answered' });

    // Escalation offer: surfaced as a status message; the user (or UI) decides.
    const esc = r.escalate ?? structured?.escalate;
    if (esc && escalationIsMeaningful(esc, run.mode as Mode)) {
      this.repo.addMessage({
        chatId,
        role: 'system',
        kind: 'status',
        content: `The assistant suggests a ${esc.mode} research run: ${esc.reason}`,
        runId: run.id,
      });
    }

    // FTS + Markdown export.
    const fresh = this.repo.getItem(item.id) ?? item;
    const exported = this.reindex(fresh, chatId, r.mode, structured);
    if (exported.file) emit('status', { phase: 'exported', file: exported.file });
    else if (exported.error)
      emit('status', { phase: 'warning', message: `Markdown export failed: ${exported.error}` });
    emit('done', { stopReason: r.stopReason, costUsd: cost });
    this.push(fresh, chatId, 'answered');
  }

  /**
   * Refresh the FTS row and rewrite the Markdown note for an item from what the database holds.
   * Called after every finished run and after the owner edits tags, so the note and the index
   * never drift from the chat.
   */
  reindex(
    item: ItemRow,
    chatId: string,
    mode: string,
    structured: Answer | null = null,
  ): { file?: string; error?: string } {
    const messages = this.repo.listMessages(chatId).filter((m) => m.role !== 'system');
    const answerText = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');
    const ext = this.repo.listExtractions(item.id);
    const pick = (k: string) =>
      ext
        .filter((e) => e.kind === k)
        .map((e) => extractionText(e.kind, parseExtraction(e.content)))
        .join('\n');
    const entities = this.repo.listEntities(item.id);
    const tags = this.repo.listTags(item.id);
    this.repo.upsertFts(item.id, {
      title: item.title ?? '',
      note: item.note ?? '',
      transcript: `${pick('transcript')}\n${pick('caption')}\n${pick('page_text')}\n${pick('comments')}\n${pick('thread')}`,
      ocr: `${pick('ocr')}\n${pick('frame_description')}`,
      answer: answerText,
      tags: tags.join(' '),
      entities: entities.map((e) => e.name).join(' '),
    });
    const firstAnswer = messages.find((m) => m.role === 'assistant' && m.kind === 'answer');
    const structuredForExport: Answer | null = firstAnswer?.structured
      ? (JSON.parse(firstAnswer.structured) as Answer)
      : structured;
    try {
      const file = exportItemMarkdown({
        notesDir: this.cfg.notesDir,
        itemId: item.id,
        title: item.title ?? 'Untitled',
        sourceUrl: item.canonicalUrl ?? item.sourceUrl,
        platform: item.platform,
        note: item.note,
        mode,
        costUsd: this.repo.listRuns(chatId).reduce((a, x) => a + (x.costUsd ?? 0), 0),
        createdAt: item.createdAt,
        messages: messages.map((m) => ({
          role: m.role,
          kind: m.kind,
          content: m.content,
          createdAt: m.createdAt,
        })),
        structured: structuredForExport,
        tags,
        entities: entities.map((e) => ({ kind: e.kind, name: e.name })),
      });
      return { file };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
}

/** Titles ingest assigns before extraction: platform labels or a bare hostname. */
function isGenericTitle(t: string): boolean {
  return (
    /^(Instagram post|TikTok|YouTube (Short|video)|Post on X|Reddit thread|Shared AI chat|Shared link|Note)$/.test(
      t,
    ) || !t.includes(' ')
  );
}
