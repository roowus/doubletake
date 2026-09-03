import { EventEmitter } from 'node:events';
import type { BrainAdapter, ResearchBrief, RunOptions, ToolPolicy } from '@doubletake/brain-sdk';
import type { Answer, Mode, QuestionType, RunEvent, UntrustedBlock } from '@doubletake/shared';
import { FOLLOWUP_BUDGET, MODE_BUDGETS } from '@doubletake/shared';
import { OUTPUT_TEMPLATES, SYSTEM_FRAMING } from '../brains/prompts.js';
import type { Config } from '../config/index.js';
import type { ItemRow, Repo, RunRow } from '../db/repo.js';
import { exportItemMarkdown } from '../export/markdown.js';
import { fetchText } from '../extract/http.js';
import { extractUrl } from '../extract/registry.js';
import type { ExtractResult } from '../extract/types.js';
import { classifyItem } from '../ingest/classify.js';

export interface WorkerEvents {
  run_event: (e: RunEvent) => void;
  chat_updated: (chatId: string) => void;
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

  constructor(
    private readonly repo: Repo,
    private readonly brain: BrainAdapter,
    private readonly cfg: Config,
  ) {
    super();
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
      this.current = null;
      return;
    }

    const started = new Date().toISOString();
    this.repo.updateRun(run.id, { status: 'extracting', startedAt: started });
    this.repo.updateItem(item.id, { status: 'extracting' });
    this.emit('chat_updated', chat.id);
    const timer = setTimeout(() => ac.abort(), MODE_BUDGETS[run.mode as Mode].wallClockMs + 60_000);

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
  ): RunOptions {
    const b = MODE_BUDGETS[mode];
    return {
      mode,
      maxTurns: kind === 'followup' ? FOLLOWUP_BUDGET.maxTurns : b.maxTurns,
      maxBudgetUsd: kind === 'followup' ? FOLLOWUP_BUDGET.maxBudgetUsd : b.maxBudgetUsd,
      ...(this.cfg.brainModel ? { model: this.cfg.brainModel } : {}),
      ...(sessionId ? { sessionId } : {}),
      tools: this.policyFor(mode, kind),
      signal,
    };
  }

  private buildBrief(
    item: ItemRow,
    blocks: UntrustedBlock[],
    questionType: QuestionType,
  ): ResearchBrief {
    return {
      systemFraming: SYSTEM_FRAMING,
      untrusted: blocks,
      note: item.note,
      focus: item.focus,
      questionType,
      outputTemplate: OUTPUT_TEMPLATES[questionType],
      localContextHints: [],
      sourceUrl: item.canonicalUrl ?? item.sourceUrl,
      title: item.title,
    };
  }

  private async research(
    run: RunRow,
    item: ItemRow,
    chatId: string,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    // 1. Extract. Forced modes decide extraction depth; auto starts standard and is refined below.
    const forced = item.modeRequested !== 'auto' ? (item.modeRequested as Mode) : null;
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
      this.brain,
      signal,
    );
    const mode = cls.mode;
    const questionType = cls.question_type;
    this.repo.updateRun(run.id, { mode, status: 'researching' });
    this.repo.updateItem(item.id, { modeEffective: mode, questionType, status: 'researching' });
    emit('status', { phase: 'mode', mode, questionType, source: cls.source });
    this.emit('chat_updated', chatId);

    // 3. Research.
    const brief = this.buildBrief(item, blocks, questionType);
    const opts = this.runOptions(mode, 'research', signal, null);
    const result = await this.brain.run(brief, opts, { emit: (e) => emit(e.type, e.payload) });
    if (extraction?.warnings.length) {
      result.text = `${result.text}\n\n> Extraction notes: ${extraction.warnings.join('; ')}`;
    }
    return { ...result, mode, kind: 'research' as const };
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
    emit('status', { phase: 'followup', resume: Boolean(sessionId) });
    const result = await this.brain.followUp(
      {
        chatId,
        ...(sessionId ? { sessionId } : {}),
        history,
        brief: this.buildBrief(item, blocks, questionType),
      },
      run.userMessage ?? '',
      this.runOptions(mode, 'followup', signal, sessionId),
      { emit: (e) => emit(e.type, e.payload) },
    );
    return { ...result, mode, kind: 'followup' as const };
  }

  /** Rebuild untrusted blocks from stored extractions for follow-ups without native resume. */
  private storedBlocks(item: ItemRow): UntrustedBlock[] {
    const out: UntrustedBlock[] = [];
    for (const x of this.repo.listExtractions(item.id)) {
      let content: unknown;
      try {
        content = JSON.parse(x.content);
      } catch {
        content = x.content;
      }
      const text = typeof content === 'string' ? content : JSON.stringify(content).slice(0, 8000);
      out.push({ source: item.platform, kind: asUntrustedKind(x.kind), content: text });
    }
    if (item.text?.trim()) out.push({ source: 'owner', kind: 'shared_text', content: item.text });
    return out;
  }

  private finish(
    run: RunRow,
    item: ItemRow,
    chatId: string,
    r: Awaited<ReturnType<QueueWorker['research']>> | Awaited<ReturnType<QueueWorker['followUp']>>,
    emit: (t: RunEvent['type'], p: Record<string, unknown>) => void,
  ): void {
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
      if (r.kind === 'research') this.repo.replaceEntities(item.id, run.id, structured.entities);
      if (structured.tags.length) this.repo.setAutoTags(item.id, structured.tags);
      this.repo.updateItem(item.id, { category: structured.category });
    }
    this.repo.updateItem(item.id, { status: 'answered' });

    // Escalation offer: surfaced as a status message; the user (or UI) decides.
    const esc = r.escalate ?? structured?.escalate;
    if (esc) {
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
    const messages = this.repo.listMessages(chatId).filter((m) => m.role !== 'system');
    const answerText = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n');
    const ext = this.repo.listExtractions(item.id);
    const pick = (k: string) =>
      ext
        .filter((e) => e.kind === k)
        .map((e) => e.content)
        .join('\n');
    this.repo.upsertFts(item.id, {
      title: fresh.title ?? '',
      note: fresh.note ?? '',
      transcript: `${pick('transcript')}\n${pick('caption')}\n${pick('page_text')}`,
      ocr: pick('ocr'),
      answer: answerText,
      tags: this.repo.listTags(item.id).join(' '),
      entities: this.repo
        .listEntities(item.id)
        .map((e) => e.name)
        .join(' '),
    });
    const firstAnswer = messages.find((m) => m.role === 'assistant' && m.kind === 'answer');
    const structuredForExport: Answer | null = firstAnswer?.structured
      ? (JSON.parse(firstAnswer.structured) as Answer)
      : structured;
    try {
      const file = exportItemMarkdown({
        notesDir: this.cfg.notesDir,
        itemId: item.id,
        title: fresh.title ?? 'Untitled',
        sourceUrl: fresh.canonicalUrl ?? fresh.sourceUrl,
        platform: fresh.platform,
        note: fresh.note,
        mode: r.mode,
        costUsd: this.repo.listRuns(chatId).reduce((a, x) => a + (x.costUsd ?? 0), 0),
        createdAt: fresh.createdAt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
        structured: structuredForExport,
      });
      emit('status', { phase: 'exported', file });
    } catch (e) {
      emit('status', {
        phase: 'warning',
        message: `Markdown export failed: ${(e as Error).message}`,
      });
    }
    emit('done', { stopReason: r.stopReason, costUsd: cost });
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

function asUntrustedKind(kind: string): UntrustedBlock['kind'] {
  const known: UntrustedBlock['kind'][] = [
    'transcript',
    'ocr',
    'frame_description',
    'caption',
    'comments',
    'page_text',
    'thread',
    'shared_text',
  ];
  return (known as string[]).includes(kind) ? (kind as UntrustedBlock['kind']) : 'page_text';
}
