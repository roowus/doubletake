import type { PlatformExtractor } from '../types.js';
import { fetchOEmbed, MEDIA_LATER, result } from './_shared.js';

const HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

export function tiktokVideo(u: URL): { user?: string; id: string } | undefined {
  if (!HOSTS.has(u.hostname.toLowerCase())) return undefined;
  const m = u.pathname.match(/^\/@([\w.-]+)\/(?:video|photo)\/(\d+)/);
  if (m?.[2]) return m[1] ? { user: m[1], id: m[2] } : { id: m[2] };
  const e = u.pathname.match(/^\/(?:embed\/v2\/|v\/)(\d+)/);
  return e?.[1] ? { id: e[1] } : undefined;
}

/** TikTok videos. Short links (vm./vt.) are resolved by following redirects first. */
export const tiktokExtractor: PlatformExtractor = {
  platform: 'tiktok',
  match: (u) => HOSTS.has(u.hostname.toLowerCase()),
  canonicalize(u) {
    const v = tiktokVideo(u);
    if (!v) return `https://${u.hostname}${u.pathname}`;
    return v.user
      ? `https://www.tiktok.com/@${v.user}/video/${v.id}`
      : `https://www.tiktok.com/embed/v2/${v.id}`;
  },
  async extract(url, ctx) {
    let target = url;
    const warnings: string[] = [];
    if (!tiktokVideo(url)) {
      try {
        const res = await ctx.fetchText(url.toString(), { maxBytes: 64 * 1024 });
        target = new URL(res.finalUrl);
      } catch (e) {
        warnings.push(`Could not resolve the TikTok short link: ${(e as Error).message}`);
      }
    }
    const canonical = this.canonicalize(target);
    const v = tiktokVideo(target);
    const oe = await fetchOEmbed('https://www.tiktok.com/oembed', canonical, ctx);
    const title = oe?.title?.trim() || `TikTok by @${v?.user ?? '?'}`;
    const blocks = oe?.title
      ? [
          {
            source: 'tiktok',
            kind: 'caption' as const,
            content: oe.title,
            label: `caption by ${oe.author_name ?? v?.user}`,
          },
        ]
      : [];
    warnings.push(oe ? MEDIA_LATER : 'TikTok oEmbed did not answer; only the URL is known.');
    return result(
      'tiktok',
      canonical,
      title,
      blocks,
      [{ kind: 'caption', content: { oembed: oe ?? null, ...v }, tool: 'oembed' }],
      warnings,
    );
  },
};
