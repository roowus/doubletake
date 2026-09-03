import type { Platform, UntrustedBlock } from '@doubletake/shared';
import type { ExtractContext, ExtractResult } from '../types.js';

export const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'igsh',
  'igshid',
  'fbclid',
  'gclid',
  'si',
  'feature',
  'ref',
  'ref_src',
  'ref_url',
  's',
  't',
  '_r',
  'is_from_webapp',
  'sender_device',
  'web_id',
  'share_id',
  'share_app_id',
  'share_link_id',
  'source',
  'share_source',
]);

export function stripTracking(url: URL, keep: string[] = []): URL {
  const u = new URL(url.toString());
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(k) && !keep.includes(k)) u.searchParams.delete(k);
  }
  u.hash = '';
  return u;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  html?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

export async function fetchOEmbed(
  endpoint: string,
  target: string,
  ctx: ExtractContext,
): Promise<OEmbed | undefined> {
  const u = new URL(endpoint);
  u.searchParams.set('url', target);
  u.searchParams.set('format', 'json');
  try {
    const res = await ctx.fetchText(u.toString(), {
      accept: 'application/json',
      maxBytes: 256 * 1024,
    });
    if (res.status !== 200) return undefined;
    return JSON.parse(res.body) as OEmbed;
  } catch {
    return undefined;
  }
}

export function result(
  platform: Platform,
  canonicalUrl: string,
  title: string,
  blocks: UntrustedBlock[],
  extractions: ExtractResult['extractions'],
  warnings: string[] = [],
): ExtractResult {
  return { platform, canonicalUrl, title, blocks, extractions, warnings };
}

export const MEDIA_LATER =
  'Video/audio transcription, OCR and comments arrive with the media pipeline (M3); this run used the page text and caption only.';
