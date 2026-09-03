import path from 'node:path';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Config } from '../config/index.js';
import { ClaudeAgentSdkAdapter } from './claude-agent-sdk.js';

export type BrainFactory = (cfg: Config) => BrainAdapter;

/**
 * Adapter registry. Adding a brain = one entry here plus a doc section in BRAIN-ADAPTERS.md.
 * `config.brain` selects the default; per-run overrides come through the API later (M5).
 */
export const BRAIN_FACTORIES: Record<string, BrainFactory> = {
  'claude-agent-sdk': (cfg) =>
    new ClaudeAgentSdkAdapter({
      cwd: path.join(cfg.dataDir, 'agent-cwd'),
      ...(cfg.brainModel ? { model: cfg.brainModel } : {}),
    }),
};

export function createBrain(cfg: Config, id = cfg.brain): BrainAdapter {
  const factory = BRAIN_FACTORIES[id];
  if (!factory) {
    throw new Error(
      `Unknown brain adapter "${id}". Known: ${Object.keys(BRAIN_FACTORIES).join(', ')}`,
    );
  }
  return factory(cfg);
}
