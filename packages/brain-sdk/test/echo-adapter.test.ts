import { describe, expect, it } from 'vitest';
import type { BrainAdapter } from '../src/index.js';
import { runContractTests } from '../src/index.js';

/** Minimal in-memory adapter proving the harness itself works. */
function makeEcho(): BrainAdapter {
  return {
    id: 'echo',
    capabilities: () => ({
      resume: false,
      vision: false,
      streaming: false,
      costReporting: false,
      tools: 'none',
    }),
    async run(brief, opts, sink) {
      if (opts.signal.aborted) return { text: '', stopReason: 'aborted' };
      sink.emit({ type: 'text', payload: { text: brief.note ?? '' } });
      return { text: `echo: ${brief.note ?? ''}`, stopReason: 'done', costUsd: 0 };
    },
    async followUp(_chat, msg) {
      return { text: `echo: ${msg}`, stopReason: 'done' };
    },
    async healthcheck() {
      return { ok: true };
    },
  };
}

runContractTests('echo', makeEcho, { describe, it, expect });
