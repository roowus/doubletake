import type { Platform } from '@doubletake/shared';
import { aichatExtractor } from './platforms/aichat.js';
import { instagramExtractor } from './platforms/instagram.js';
import { redditExtractor } from './platforms/reddit.js';
import { tiktokExtractor } from './platforms/tiktok.js';
import { webExtractor } from './platforms/web.js';
import { xExtractor } from './platforms/x.js';
import { youtubeExtractor } from './platforms/youtube.js';
import type { ExtractContext, ExtractResult, PlatformExtractor } from './types.js';

/**
 * Registration order matters: the first `match` wins and `web` must stay last.
 * To add a platform: create `platforms/<name>.ts` exporting a PlatformExtractor,
 * add its id to `Platform` in packages/shared/src/schemas.ts, import it here,
 * and document it in docs/MEDIA-PIPELINE.md.
 */
export const EXTRACTORS: readonly PlatformExtractor[] = [
  instagramExtractor,
  tiktokExtractor,
  youtubeExtractor,
  xExtractor,
  redditExtractor,
  aichatExtractor,
  webExtractor,
];

export function pickExtractor(url: URL): PlatformExtractor {
  return EXTRACTORS.find((e) => e.match(url)) ?? webExtractor;
}

export function detectPlatform(
  url: string,
): { platform: Platform; canonicalUrl: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const ex = pickExtractor(u);
  return { platform: ex.platform, canonicalUrl: ex.canonicalize(u) };
}

export async function extractUrl(url: string, ctx: ExtractContext): Promise<ExtractResult> {
  const u = new URL(url);
  const ex = pickExtractor(u);
  try {
    return await ex.extract(u, ctx);
  } catch (e) {
    return {
      platform: ex.platform,
      canonicalUrl: ex.canonicalize(u),
      title: u.hostname,
      blocks: [],
      extractions: [],
      warnings: [`Extraction failed: ${(e as Error).message}`],
    };
  }
}

/** Pull the first http(s) URL out of free text (share sheets often send "caption + link"). */
export function firstUrlIn(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m?.[0]?.replace(/[.,;:!?]+$/, '');
}
