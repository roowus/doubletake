import type { Platform, UntrustedBlock } from '@doubletake/shared';

/** What a platform extractor learns about a URL before any research happens. */
export interface ExtractResult {
  platform: Platform;
  /** Stable, tracking-free URL used for dedupe and export. */
  canonicalUrl: string;
  title: string;
  /** Text blocks handed to the brain, already labelled by kind. */
  blocks: UntrustedBlock[];
  /** Stored in `extractions` for later re-runs; one row per kind. */
  extractions: { kind: string; content: unknown; tool: string }[];
  /** Human-readable notes about what could not be fetched (surfaced in the chat). */
  warnings: string[];
}

export interface ExtractContext {
  /** Effective research mode; extractors scale their budgets with it. */
  mode: 'quick' | 'standard' | 'deep';
  focus: string;
  signal: AbortSignal;
  /** Opaque helper for HTTP with SSRF guard + size cap. */
  fetchText(
    url: string,
    opts?: { maxBytes?: number; accept?: string },
  ): Promise<{ status: number; body: string; finalUrl: string; contentType: string }>;
}

/**
 * A platform extractor. Add a platform by dropping a file in `src/extract/platforms/`
 * and registering it in `src/extract/registry.ts`. `match` runs against the parsed URL
 * in registration order; the first match wins; `web` is the fallback.
 */
export interface PlatformExtractor {
  platform: Platform;
  /** Which hosts/paths this extractor claims. */
  match(url: URL): boolean;
  /** Strip tracking params, unify mobile/short hosts, etc. Must be pure. */
  canonicalize(url: URL): string;
  /** Pull whatever text is available for this platform. Must not throw on partial failure. */
  extract(url: URL, ctx: ExtractContext): Promise<ExtractResult>;
}
