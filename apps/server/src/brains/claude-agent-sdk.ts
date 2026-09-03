import * as sdk from '@anthropic-ai/claude-agent-sdk';
import type {
  BrainAdapter,
  BrainCapabilities,
  ChatContext,
  EventSink,
  ResearchBrief,
  RunOptions,
  RunResult,
  ToolPolicy,
} from '@doubletake/brain-sdk';
import { parseAnswerBlock } from '@doubletake/shared';
import { z } from 'zod';
import { listDirChecked, readFileChecked, writeFileChecked } from './fs-policy.js';
import { renderBrief, renderFollowUp, SYSTEM_FRAMING } from './prompts.js';

type Query = typeof sdk.query;
type SDKMessage = sdk.SDKMessage;

export interface ClaudeAgentSdkConfig {
  /** Default model id; per-run `opts.model` wins. */
  model?: string | undefined;
  /** Working directory for the spawned CLI. Keep it inside the data dir so nothing of the owner's is implicit context. */
  cwd: string;
  /** Path to the `claude` executable when it is not on PATH. */
  pathToClaudeCodeExecutable?: string | undefined;
  /** Injection seam for tests. */
  query?: Query;
  env?: Record<string, string | undefined>;
}

type EmitType = 'status' | 'tool_call' | 'tool_result' | 'text' | 'error';
const MCP_NAME = 'doubletake';
const READ_TOOLS = ['mcp__doubletake__read_file', 'mcp__doubletake__list_dir'];
const WRITE_TOOL = 'mcp__doubletake__write_sandbox_file';

/**
 * Brain adapter over the Claude Agent SDK. Tools are our own MCP tools (path-policy enforced in code)
 * plus the SDK's built-in WebSearch/WebFetch; nothing else is allowed, and `canUseTool` is the second gate.
 */
export class ClaudeAgentSdkAdapter implements BrainAdapter {
  readonly id = 'claude-agent-sdk';
  private readonly q: Query;

  constructor(private readonly cfg: ClaudeAgentSdkConfig) {
    this.q = cfg.query ?? sdk.query;
  }

  capabilities(): BrainCapabilities {
    return { resume: true, vision: true, streaming: true, costReporting: true, tools: 'native' };
  }

  async run(brief: ResearchBrief, opts: RunOptions, sink: EventSink): Promise<RunResult> {
    const prompt = renderBrief(brief, opts.tools, opts.mode);
    return this.execute(prompt, opts, sink, { fresh: true });
  }

  async followUp(
    chat: ChatContext,
    userMessage: string,
    opts: RunOptions,
    sink: EventSink,
  ): Promise<RunResult> {
    const canResume = Boolean(chat.sessionId ?? opts.sessionId);
    const prompt = renderFollowUp(chat, userMessage, canResume);
    const sessionId = chat.sessionId ?? opts.sessionId;
    return this.execute(prompt, sessionId ? { ...opts, sessionId } : opts, sink, {
      fresh: !canResume,
    });
  }

  async classify(prompt: string, signal?: AbortSignal): Promise<string> {
    const ac = new AbortController();
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    let text = '';
    const it = this.q({
      prompt,
      options: {
        cwd: this.cfg.cwd,
        ...(this.cfg.env ? { env: this.cfg.env as Record<string, string> } : {}),
        ...(this.cfg.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: this.cfg.pathToClaudeCodeExecutable }
          : {}),
        systemPrompt: 'Answer with the requested JSON only, no prose.',
        tools: [],
        allowedTools: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        maxBudgetUsd: 0.05,
        abortController: ac,
        persistSession: false,
      },
    });
    for await (const m of it) {
      if (m.type === 'result' && m.subtype === 'success') text = m.result;
    }
    return text;
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const out = await this.classify('Reply with exactly: {"ok":true}');
      return out.includes('"ok"')
        ? { ok: true }
        : { ok: false, detail: `unexpected reply: ${out.slice(0, 120)}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  // ---- internals ----

  private mcpServer(policy: ToolPolicy) {
    const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
    const err = (s: string) => ({
      content: [{ type: 'text' as const, text: `Refused: ${s}` }],
      isError: true,
    });
    return sdk.createSdkMcpServer({
      name: MCP_NAME,
      version: '0.1.0',
      tools: [
        sdk.tool(
          'read_file',
          "Read a text file from the owner's computer. Secrets folders and files are blocked; large files are truncated.",
          { path: z.string().describe('Absolute path or ~/relative path') },
          async ({ path }) => {
            const r = readFileChecked(path, policy);
            if (!r.ok) return err(r.reason);
            return text(
              r.truncated
                ? `${r.content}\n\n[truncated to ${policy.maxReadBytes} bytes]`
                : r.content,
            );
          },
          { annotations: { readOnlyHint: true } },
        ),
        sdk.tool(
          'list_dir',
          "List a directory on the owner's computer (blocked entries are hidden).",
          { path: z.string() },
          async ({ path }) => {
            const r = listDirChecked(path, policy);
            if (!r.ok) return err(r.reason);
            return text(
              r.entries
                .map((e) => `${e.kind === 'dir' ? 'd' : e.kind === 'file' ? 'f' : '?'} ${e.name}`)
                .join('\n') || '(empty)',
            );
          },
          { annotations: { readOnlyHint: true } },
        ),
        sdk.tool(
          'write_sandbox_file',
          "Save a markdown report or note into the owner's Doubletake notes folder. Only that folder is writable.",
          { path: z.string().describe('Path inside the notes folder'), content: z.string() },
          async ({ path, content }) => {
            const r = writeFileChecked(path, content, policy);
            if (!r.ok) return err(r.reason);
            return text(`Saved ${r.realPath}`);
          },
        ),
      ],
    });
  }

  private async execute(
    prompt: string,
    opts: RunOptions,
    sink: EventSink,
    flags: { fresh: boolean },
  ): Promise<RunResult> {
    const policy = opts.tools;
    const counters = { searches: 0, fetches: 0 };
    const allowed: string[] = [];
    if (policy.webSearch) allowed.push('WebSearch');
    if (policy.webFetch) allowed.push('WebFetch');
    if (policy.readRoots.length) allowed.push(...READ_TOOLS);
    if (policy.writeRoot) allowed.push(WRITE_TOOL);

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    opts.signal.addEventListener('abort', onAbort, { once: true });

    let sessionId: string | undefined = opts.sessionId;
    let lastText = '';
    let result: RunResult | undefined;
    const emit = (type: EmitType, payload: Record<string, unknown>) => sink.emit({ type, payload });

    const canUseTool: sdk.CanUseTool = async (toolName, input) => {
      if (!allowed.includes(toolName))
        return { behavior: 'deny', message: `${toolName} is not available in this run.` };
      if (toolName === 'WebSearch') {
        if (++counters.searches > policy.maxSearches)
          return {
            behavior: 'deny',
            message: `Search budget of ${policy.maxSearches} used up; answer with what you have.`,
          };
      }
      if (toolName === 'WebFetch') {
        if (++counters.fetches > policy.maxFetches)
          return {
            behavior: 'deny',
            message: `Fetch budget of ${policy.maxFetches} used up; answer with what you have.`,
          };
      }
      return { behavior: 'allow', updatedInput: input };
    };

    try {
      const it = this.q({
        prompt,
        options: {
          cwd: this.cfg.cwd,
          ...(this.cfg.env ? { env: this.cfg.env as Record<string, string> } : {}),
          ...(this.cfg.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: this.cfg.pathToClaudeCodeExecutable }
            : {}),
          systemPrompt: SYSTEM_FRAMING,
          ...((opts.model ?? this.cfg.model)
            ? { model: (opts.model ?? this.cfg.model) as string }
            : {}),
          maxTurns: opts.maxTurns,
          maxBudgetUsd: opts.maxBudgetUsd,
          permissionMode: 'dontAsk',
          tools: allowed.filter((t) => !t.startsWith('mcp__')),
          allowedTools: allowed,
          disallowedTools: [
            'Bash',
            'Edit',
            'Write',
            'Read',
            'Glob',
            'Grep',
            'NotebookEdit',
            'Agent',
            'Task',
            'TodoWrite',
            'Skill',
            'KillShell',
            'BashOutput',
          ],
          mcpServers: { [MCP_NAME]: this.mcpServer(policy) },
          canUseTool,
          abortController: ac,
          ...(opts.sessionId && !flags.fresh ? { resume: opts.sessionId } : {}),
          settingSources: [],
        },
      });

      for await (const m of it) {
        // Capture the session id from the very first message so a later failure still leaves the chat resumable.
        if ('session_id' in m && typeof (m as { session_id?: unknown }).session_id === 'string')
          sessionId = (m as { session_id: string }).session_id;
        this.handleMessage(m, emit, (t) => {
          lastText = t;
        });
        if (m.type === 'result') result = this.toResult(m, lastText, sessionId);
      }
    } catch (e) {
      if (opts.signal.aborted)
        return { text: lastText, stopReason: 'aborted', ...(sessionId ? { sessionId } : {}) };
      return {
        text: lastText,
        stopReason: 'error',
        error: (e as Error).message,
        ...(sessionId ? { sessionId } : {}),
      };
    } finally {
      opts.signal.removeEventListener('abort', onAbort);
    }
    if (opts.signal.aborted)
      return { text: lastText, stopReason: 'aborted', ...(sessionId ? { sessionId } : {}) };
    return (
      result ?? {
        text: lastText,
        stopReason: 'error',
        error: 'the agent ended without a result message',
        ...(sessionId ? { sessionId } : {}),
      }
    );
  }

  private handleMessage(
    m: SDKMessage,
    emit: (type: EmitType, payload: Record<string, unknown>) => void,
    setText: (t: string) => void,
  ) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init')
          emit('status', { phase: 'agent_started', model: m.model, tools: m.tools });
        return;
      case 'assistant': {
        const texts: string[] = [];
        for (const block of m.message.content) {
          if (block.type === 'text') texts.push(block.text);
          else if (block.type === 'tool_use')
            emit('tool_call', { id: block.id, name: block.name, input: block.input });
        }
        if (texts.length) {
          const t = texts.join('\n');
          setText(t);
          emit('text', { text: t });
        }
        return;
      }
      case 'user': {
        const content = m.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              typeof block === 'object' &&
              block &&
              'type' in block &&
              block.type === 'tool_result'
            ) {
              const c = (block as { content?: unknown; tool_use_id: string; is_error?: boolean })
                .content;
              const preview = typeof c === 'string' ? c : JSON.stringify(c ?? '');
              emit('tool_result', {
                id: (block as { tool_use_id: string }).tool_use_id,
                isError: Boolean((block as { is_error?: boolean }).is_error),
                preview: preview.slice(0, 500),
              });
            }
          }
        }
        return;
      }
      default:
        return;
    }
  }

  private toResult(
    m: sdk.SDKResultMessage,
    lastText: string,
    sessionId: string | undefined,
  ): RunResult {
    const usage = m.usage
      ? {
          inputTokens: m.usage.input_tokens ?? 0,
          outputTokens: m.usage.output_tokens ?? 0,
          cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
        }
      : undefined;
    const base: Partial<RunResult> = {
      ...((sessionId ?? m.session_id) ? { sessionId: sessionId ?? m.session_id } : {}),
      ...(typeof m.total_cost_usd === 'number' ? { costUsd: m.total_cost_usd } : {}),
      ...(usage ? { usage } : {}),
    };
    if (m.subtype === 'success' && !m.is_error) {
      const { text, structured } = parseAnswerBlock(m.result || lastText);
      return {
        ...base,
        text,
        ...(structured ? { structured } : {}),
        ...(structured?.escalate ? { escalate: structured.escalate } : {}),
        stopReason: 'done',
      };
    }
    const { text, structured } = parseAnswerBlock(lastText);
    const subtype = m.subtype as string;
    const stopReason: RunResult['stopReason'] =
      subtype === 'error_max_turns'
        ? 'max_turns'
        : subtype === 'error_max_budget_usd'
          ? 'budget'
          : 'error';
    const errors = 'errors' in m && Array.isArray(m.errors) ? m.errors.join('; ') : subtype;
    return { ...base, text, ...(structured ? { structured } : {}), stopReason, error: errors };
  }
}
