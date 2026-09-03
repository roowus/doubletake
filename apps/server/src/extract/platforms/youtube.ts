import type { PlatformExtractor } from '../types.js';
import { fetchOEmbed, MEDIA_LATER, result } from './_shared.js';

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export function youtubeVideoId(u: URL): { id: string; short: boolean } | undefined {
  const host = u.hostname.toLowerCase();
  if (!HOSTS.has(host)) return undefined;
  const parts = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('youtu.be') && parts[0]) return { id: parts[0], short: false };
  if (parts[0] === 'shorts' && parts[1]) return { id: parts[1], short: true };
  if ((parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') && parts[1])
    return { id: parts[1], short: false };
  const v = u.searchParams.get('v');
  if (v) return { id: v, short: false };
  return undefined;
}

/** YouTube videos and Shorts. Shorts canonicalise to the `/shorts/` form so the UI can label them. */
export const youtubeExtractor: PlatformExtractor = {
  platform: 'youtube',
  match: (u) => youtubeVideoId(u) !== undefined,
  canonicalize(u) {
    const v = youtubeVideoId(u);
    if (!v) return u.toString();
    return v.short
      ? `https://www.youtube.com/shorts/${v.id}`
      : `https://www.youtube.com/watch?v=${v.id}`;
  },
  async extract(url, ctx) {
    const canonical = this.canonicalize(url);
    const v = youtubeVideoId(url);
    const oe = await fetchOEmbed('https://www.youtube.com/oembed', canonical, ctx);
    const title = oe?.title ?? `YouTube ${v?.short ? 'Short' : 'video'} ${v?.id ?? ''}`.trim();
    const caption = [oe?.title, oe?.author_name ? `by ${oe.author_name}` : undefined]
      .filter(Boolean)
      .join(' — ');
    const blocks = caption
      ? [
          {
            source: 'youtube',
            kind: 'caption' as const,
            content: caption,
            label: v?.short ? 'short' : 'video',
          },
        ]
      : [];
    return result(
      'youtube',
      canonical,
      title,
      blocks,
      [
        {
          kind: 'caption',
          content: { oembed: oe ?? null, videoId: v?.id, short: v?.short ?? false },
          tool: 'oembed',
        },
      ],
      [oe ? MEDIA_LATER : 'YouTube oEmbed did not answer; only the URL is known.'],
    );
  },
};
