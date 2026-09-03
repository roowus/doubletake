import type { PlatformExtractor } from '../types.js';
import { fetchOEmbed, MEDIA_LATER, result, stripHtml } from './_shared.js';

const HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'fxtwitter.com',
  'vxtwitter.com',
  'fixupx.com',
]);

export function xStatus(u: URL): { user: string; id: string } | undefined {
  if (!HOSTS.has(u.hostname.toLowerCase())) return undefined;
  const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
  return m?.[1] && m[2] ? { user: m[1], id: m[2] } : undefined;
}

/** X (Twitter) posts. Text comes from the public oEmbed endpoint (no API key). */
export const xExtractor: PlatformExtractor = {
  platform: 'x',
  match: (u) => xStatus(u) !== undefined,
  canonicalize(u) {
    const s = xStatus(u);
    return s ? `https://x.com/${s.user}/status/${s.id}` : u.toString();
  },
  async extract(url, ctx) {
    const canonical = this.canonicalize(url);
    const s = xStatus(url);
    const oe = await fetchOEmbed('https://publish.twitter.com/oembed', canonical, ctx);
    const text = oe?.html
      ? stripHtml(oe.html)
          .replace(/\s*—\s*.*\(@\w+\).*$/s, '')
          .trim()
      : '';
    const title = text
      ? `${oe?.author_name ?? s?.user ?? 'X'}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`
      : `X post by @${s?.user ?? '?'}`;
    const blocks = text
      ? [
          {
            source: 'x',
            kind: 'caption' as const,
            content: text,
            label: `post by ${oe?.author_name ?? s?.user}`,
          },
        ]
      : [];
    return result(
      'x',
      canonical,
      title,
      blocks,
      [
        {
          kind: 'caption',
          content: { oembed: oe ?? null, text, user: s?.user, id: s?.id },
          tool: 'oembed',
        },
      ],
      [
        oe
          ? MEDIA_LATER
          : 'X oEmbed did not answer (deleted, protected, or rate-limited); only the URL is known.',
      ],
    );
  },
};
