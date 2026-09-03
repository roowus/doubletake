import { readablePage } from '../readable.js';
import type { PlatformExtractor } from '../types.js';
import { MEDIA_LATER, result } from './_shared.js';

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

export function instagramPost(u: URL): { kind: 'p' | 'reel' | 'tv'; code: string } | undefined {
  if (!HOSTS.has(u.hostname.toLowerCase())) return undefined;
  const m = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/);
  if (!m?.[1] || !m[2]) return undefined;
  const kind = m[1] === 'p' ? 'p' : m[1] === 'tv' ? 'tv' : 'reel';
  return { kind, code: m[2] };
}

/** Instagram posts and reels. Public page meta only until the media pipeline (M3) and the IG channel (M4). */
export const instagramExtractor: PlatformExtractor = {
  platform: 'instagram',
  match: (u) => instagramPost(u) !== undefined,
  canonicalize(u) {
    const p = instagramPost(u);
    return p ? `https://www.instagram.com/${p.kind}/${p.code}/` : u.toString();
  },
  async extract(url, ctx) {
    const canonical = this.canonicalize(url);
    const p = instagramPost(url);
    const warnings: string[] = [];
    let title = `Instagram ${p?.kind === 'reel' ? 'reel' : 'post'} ${p?.code ?? ''}`.trim();
    const blocks = [];
    let meta: unknown = null;
    try {
      const res = await ctx.fetchText(canonical, { maxBytes: 512 * 1024 });
      if (res.status === 200) {
        const page = readablePage(res.body, canonical);
        if (page.description) {
          blocks.push({
            source: 'instagram',
            kind: 'caption' as const,
            content: page.description,
            label: 'og:description',
          });
          title = page.title || title;
        }
        meta = { title: page.title, description: page.description };
      } else {
        warnings.push(`Instagram answered HTTP ${res.status} for the public page (login wall).`);
      }
    } catch (e) {
      warnings.push(`Instagram page fetch failed: ${(e as Error).message}`);
    }
    warnings.push(MEDIA_LATER);
    return result(
      'instagram',
      canonical,
      title,
      blocks,
      [{ kind: 'caption', content: { meta, ...p }, tool: 'og-meta' }],
      warnings,
    );
  },
};
