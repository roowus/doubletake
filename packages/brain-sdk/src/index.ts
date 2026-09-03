import type { Answer, Mode, QuestionType, RunEventType, UntrustedBlock } from '@doubletake/shared';

export type { Answer, Mode, QuestionType, UntrustedBlock };

export interface ToolPolicy {
  webSearch: boolean;
  maxSearches: number;
  webFetch: boolean;
  maxFetches: number;
  readRoots: string[];
  readDeny: string[];
  maxReadBytes: number;
  /** Notes dir, or null when this run may not write. */
  writeRoot: string | null;
}

export interface RunOptions {
  mode: Mode;
  maxTurns: number;
  maxBudgetUsd: number;
  model?: string;
  /** From a previous RunResult when capabilities().resume is true. */
  sessionId?: string;
  tools: ToolPolicy;
  signal: AbortSignal;
}

export interface ResearchBrief {
  systemFraming: string;
  untrusted: UntrustedBlock[];
  note: string | null;
  focus: string;
  questionType: QuestionType;
  outputTemplate: string;
  localContextHints: string[];
  sourceUrl: string | null;
  title: string | null;
}

export interface ChatContext {
  chatId: string;
  sessionId?: string;
  /** Prior turns in order, for adapters without native resume. */
  history: { role: 'user' | 'assistant'; content: string }[];
  brief: ResearchBrief;
}

export interface BrainEvent {
  type: RunEventType;
  payload: Record<string, unknown>;
}

export interface EventSink {
  emit(event: BrainEvent): void;
}

export interface RunResult {
  text: string;
  structured?: Answer;
  sessionId?: string;
  costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  escalate?: { mode: 'standard' | 'deep'; reason: string };
  stopReason: 'done' | 'max_turns' | 'budget' | 'error' | 'aborted';
  error?: string;
}

export interface BrainCapabilities {
  resume: boolean;
  vision: boolean;
  streaming: boolean;
  costReporting: boolean;
  tools: 'native' | 'loop' | 'none';
}

export interface ImageInput {
  path: string;
  mimeType: string;
}

export interface BrainAdapter {
  readonly id: string;
  capabilities(): BrainCapabilities;
  run(brief: ResearchBrief, opts: RunOptions, sink: EventSink): Promise<RunResult>;
  followUp(
    chat: ChatContext,
    userMessage: string,
    opts: RunOptions,
    sink: EventSink,
  ): Promise<RunResult>;
  describeImages?(images: ImageInput[], prompt: string): Promise<string[]>;
  classify?(prompt: string, signal?: AbortSignal): Promise<string>;
  healthcheck(): Promise<{ ok: boolean; detail?: string }>;
}

export type { ContractHooks } from './contract.js';
export { OPEN_POLICY, runContractTests, sampleBrief, sampleOptions } from './contract.js';
