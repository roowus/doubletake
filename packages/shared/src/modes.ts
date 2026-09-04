import type { Mode, ModeRequested } from './schemas.js';

export interface ModeBudget {
  maxTurns: number;
  maxBudgetUsd: number;
  maxSearches: number;
  maxFetches: number;
  readFiles: boolean;
  writeSandbox: boolean;
  /** Research phase (classify + agent) wall clock. */
  wallClockMs: number;
  /** Media pipeline wall clock (download, transcription, frames, OCR, vision); separate so a slow
   *  download cannot starve the research phase. */
  mediaWallClockMs: number;
  modelTier: 'fast' | 'default' | 'best';
  framesMax: number;
  commentsMax: number;
}

export const MODE_BUDGETS: Record<Mode, ModeBudget> = {
  quick: {
    maxTurns: 6,
    maxBudgetUsd: 0.15,
    maxSearches: 3,
    maxFetches: 3,
    readFiles: false,
    writeSandbox: false,
    wallClockMs: 90_000,
    mediaWallClockMs: 3 * 60_000,
    modelTier: 'fast',
    framesMax: 4,
    commentsMax: 20,
  },
  standard: {
    maxTurns: 20,
    maxBudgetUsd: 0.75,
    maxSearches: 10,
    maxFetches: 10,
    readFiles: true,
    writeSandbox: false,
    wallClockMs: 6 * 60_000,
    mediaWallClockMs: 10 * 60_000,
    modelTier: 'default',
    framesMax: 12,
    commentsMax: 100,
  },
  deep: {
    maxTurns: 60,
    maxBudgetUsd: 3.0,
    maxSearches: 1000,
    maxFetches: 1000,
    readFiles: true,
    writeSandbox: true,
    wallClockMs: 25 * 60_000,
    mediaWallClockMs: 20 * 60_000,
    modelTier: 'best',
    framesMax: 40,
    commentsMax: 500,
  },
};

export const FOLLOWUP_BUDGET = {
  maxTurns: 3,
  maxBudgetUsd: 0.1,
  maxSearches: 2,
  maxFetches: 2,
} as const;

const QUICK_WORDS = ['quick', 'tl;dr', 'tldr', 'just save', 'save this', 'later'];
const DEEP_WORDS = ['deep dive', 'deep', 'research', 'compare', 'thorough', 'everything about'];
const STANDARD_WORDS = ['is this true', 'is this real', 'legit', 'explain', 'how', 'what is'];

/** Keyword rules from RESEARCH-MODES.md. Returns null when no rule matches. */
export function pickModeByKeywords(note: string | undefined | null): Mode | null {
  if (!note) return null;
  const n = note.toLowerCase();
  const hit = (words: string[]) => words.some((w) => n.includes(w));
  if (hit(QUICK_WORDS)) return 'quick';
  if (hit(DEEP_WORDS)) return 'deep';
  if (hit(STANDARD_WORDS)) return 'standard';
  return null;
}

export function resolveRequestedMode(requested: ModeRequested): Mode | null {
  return requested === 'auto' ? null : requested;
}
