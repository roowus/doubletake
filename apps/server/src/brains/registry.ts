import path from 'node:path';
import type { BrainAdapter } from '@doubletake/brain-sdk';
import type { Mode } from '@doubletake/shared';
import type { Config } from '../config/index.js';
import { ClaudeAgentSdkAdapter } from './claude-agent-sdk.js';
import { HEADLESS_PRESETS, HeadlessCliAdapter } from './headless-cli.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { createSearchProvider } from './tools/search.js';
import { fetchPage } from './tools/web-fetch.js';

export type BrainFactory = (cfg: Config) => BrainAdapter;

/**
 * Adapter registry. Adding a brain = one entry here plus a doc section in BRAIN-ADAPTERS.md.
 * `config.brain` selects the default; `config.brainModes` binds other adapters to modes.
 */
export const BRAIN_FACTORIES: Record<string, BrainFactory> = {
  'claude-agent-sdk': (cfg) =>
    new ClaudeAgentSdkAdapter({
      cwd: path.join(cfg.dataDir, 'agent-cwd'),
      ...(cfg.brainModel ? { model: cfg.brainModel } : {}),
    }),
  'headless-cli': (cfg) => {
    const base = HEADLESS_PRESETS[cfg.headless.preset];
    if (!base) {
      throw new Error(
        `Unknown headless preset "${cfg.headless.preset}". Known: ${Object.keys(HEADLESS_PRESETS).join(', ')}`,
      );
    }
    return new HeadlessCliAdapter({
      preset: {
        ...base,
        ...(cfg.headless.command ? { command: cfg.headless.command } : {}),
        ...(cfg.headless.args ? { args: cfg.headless.args } : {}),
      },
      runsDir: path.join(cfg.dataDir, 'runs'),
      ...(cfg.brainModel ? { model: cfg.brainModel } : {}),
      ...(cfg.headless.timeoutMs ? { timeoutMs: cfg.headless.timeoutMs } : {}),
    });
  },
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

export interface ModeBinding {
  adapter: BrainAdapter;
  /** Model override for this mode (`adapter@model`); null = the adapter's own default. */
  model: string | null;
}

export interface BrainHealth {
  id: string;
  ok: boolean;
  detail: string | null;
  default: boolean;
  /** Modes explicitly bound to this adapter (the default serves the rest). */
  modes: Mode[];
  checkedAt: string;
}

const MODES: Mode[] = ['quick', 'standard', 'deep'];
const HEALTH_TTL_MS = 5 * 60_000;
const HEALTH_TIMEOUT_MS = 20_000;

/**
 * The configured adapters: one default plus optional per-mode bindings. Research runs use the
 * adapter bound to their effective mode; follow-ups use the adapter that produced the chat's
 * session (`chat.brainAdapter`) so sessions can resume. Unknown ids fall back to the default.
 */
export class BrainSet {
  private readonly byId = new Map<string, BrainAdapter>();
  private health: { at: number; result: BrainHealth[] } | null = null;
  private healthInFlight: Promise<BrainHealth[]> | null = null;

  constructor(
    readonly defaultBrain: BrainAdapter,
    private readonly modes: Partial<Record<Mode, { adapter: string; model: string | null }>> = {},
    extra: BrainAdapter[] = [],
  ) {
    this.byId.set(defaultBrain.id, defaultBrain);
    for (const b of extra) this.byId.set(b.id, b);
    for (const m of MODES) {
      const id = modes[m]?.adapter;
      if (id && !this.byId.has(id)) {
        throw new Error(`Mode "${m}" is bound to unknown adapter "${id}"`);
      }
    }
  }

  /** Instantiates the default and every adapter named by a per-mode binding. */
  static fromConfig(cfg: Config): BrainSet {
    const def = createBrain(cfg);
    const extra: BrainAdapter[] = [];
    for (const m of MODES) {
      const id = cfg.brainModes[m]?.adapter;
      if (id && id !== def.id && !extra.some((b) => b.id === id)) extra.push(createBrain(cfg, id));
    }
    return new BrainSet(def, cfg.brainModes, extra);
  }

  /** Accepts a bare adapter (tests, simple boots) or an existing set. */
  static from(b: BrainAdapter | BrainSet): BrainSet {
    return b instanceof BrainSet ? b : new BrainSet(b);
  }

  all(): BrainAdapter[] {
    return [...this.byId.values()];
  }

  /** The adapter recorded on a run; unknown ids (config changed since) fall back to the default. */
  get(id: string): BrainAdapter {
    return this.byId.get(id) ?? this.defaultBrain;
  }

  forMode(mode: Mode): ModeBinding {
    const bound = this.modes[mode];
    return bound
      ? { adapter: this.get(bound.adapter), model: bound.model }
      : { adapter: this.defaultBrain, model: null };
  }

  /** Adapter that can describe frames for this run: the run's own if it has vision, else the default. */
  visionFor(adapter: BrainAdapter): BrainAdapter {
    return adapter.describeImages ? adapter : this.defaultBrain;
  }

  /** Healthchecks for every adapter, cached for five minutes (the SDK one costs a model call). */
  async healthchecks(refresh = false): Promise<BrainHealth[]> {
    if (!refresh && this.health && Date.now() - this.health.at < HEALTH_TTL_MS) {
      return this.health.result;
    }
    if (this.healthInFlight) return this.healthInFlight;
    this.healthInFlight = Promise.all(this.all().map((b) => this.check(b)))
      .then((result) => {
        this.health = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        this.healthInFlight = null;
      });
    return this.healthInFlight;
  }

  private async check(b: BrainAdapter): Promise<BrainHealth> {
    const modes = MODES.filter((m) => this.modes[m]?.adapter === b.id);
    const base = { id: b.id, default: b === this.defaultBrain, modes };
    let timer: NodeJS.Timeout | undefined;
    try {
      const r = await Promise.race([
        b.healthcheck(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(
            () => rej(new Error(`healthcheck timed out after ${HEALTH_TIMEOUT_MS} ms`)),
            HEALTH_TIMEOUT_MS,
          );
        }),
      ]);
      return { ...base, ok: r.ok, detail: r.detail ?? null, checkedAt: new Date().toISOString() };
    } catch (e) {
      return {
        ...base,
        ok: false,
        detail: (e as Error).message,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
