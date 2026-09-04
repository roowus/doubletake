import path from 'node:path';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Config } from '../config/index.js';
import { ClaudeAgentSdkAdapter } from './claude-agent-sdk.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { createSearchProvider } from './tools/search.js';
import { fetchPage } from './tools/web-fetch.js';

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
  'openai-compatible': (cfg) =>
    new OpenAICompatibleAdapter(
      {
        baseUrl: cfg.openai.baseUrl,
        apiKey: cfg.openai.apiKey,
        model: cfg.brainModel ?? cfg.openai.model,
        sessionsDir: path.join(cfg.dataDir, 'sessions'),
        prices: cfg.openai.prices,
        vision: cfg.openai.vision,
      },
      { search: createSearchProvider(cfg.search), fetchPage },
    ),
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
