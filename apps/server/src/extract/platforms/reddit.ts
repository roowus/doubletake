import type { UntrustedBlock } from '@doubletake/shared';
import { MODE_BUDGETS } from '@doubletake/shared';
import type { PlatformExtractor } from '../types.js';
import { result } from './_shared.js';

const HOSTS = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'm.reddit.com',
  'redd.it',
  'www.redd.it',
]);

export function redditPost(u: URL): { sub?: string; id: string } | undefined {
  if (!HOSTS.has(u.hostname.toLowerCase())) return undefined;
  if (u.hostname.endsWith('redd.it')) {
    const id = u.pathname.split('/').filter(Boolean)[0];
    return id ? { id } : undefined;
  }
  const m = u.pathname.match(/^\/r\/([\w]+)\/comments\/([a-z0-9]+)/i);
  if (m?.[1] && m[2]) return { sub: m[1], id: m[2] };
  const s = u.pathname.match(/^\/(?:comments|s)\/([a-z0-9]+)/i);
  return s?.[1] ? { id: s[1] } : undefined;
}

interface RedditComment {
  body?: string;
  author?: string;
  score?: number;
  replies?: { data?: { children?: { kind: string; data: RedditComment }[] } } | '';
}

function flatten(
  children: { kind: string; data: RedditComment }[] | undefined,
  depth: number,
  out: string[],
  cap: number,
) {
  for (const c of children ?? []) {
    if (out.length >= cap) return;
    if (c.kind !== 't1' || !c.data.body) continue;
    out.push(
      `${'  '.repeat(depth)}- u/${c.data.author ?? '?'} (${c.data.score ?? 0}): ${c.data.body.replace(/\s+/g, ' ').trim()}`,
    );
    const r = c.data.replies;
    if (r && typeof r === 'object') flatten(r.data?.children, depth + 1, out, cap);
  }
}

/** Reddit threads via the public `.json` view: title, self text and a capped comment tree. */
export const redditExtractor: PlatformExtractor = {
  platform: 'reddit',
  match: (u) => redditPost(u) !== undefined,
  canonicalize(u) {
    const p = redditPost(u);
    if (!p) return u.toString();
    return p.sub
      ? `https://www.reddit.com/r/${p.sub}/comments/${p.id}/`
      : `https://www.reddit.com/comments/${p.id}/`;
  },
  async extract(url, ctx) {
    const canonical = this.canonicalize(url);
    const p = redditPost(url);
    const warnings: string[] = [];
    const blocks: UntrustedBlock[] = [];
    let post: Record<string, unknown> = {};
    const comments: string[] = [];
    try {
      const res = await ctx.fetchText(`${canonical.replace(/\/$/, '')}.json?raw_json=1&limit=200`, {
        accept: 'application/json',
        maxBytes: 4 * 1024 * 1024,
      });
      if (res.status === 200) {
        const json = JSON.parse(res.body) as {
          data?: { children?: { kind: string; data: Record<string, unknown> }[] };
        }[];
        post = json[0]?.data?.children?.[0]?.data ?? {};
        flatten(
          json[1]?.data?.children as { kind: string; data: RedditComment }[] | undefined,
          0,
          comments,
          MODE_BUDGETS[ctx.mode].commentsMax,
        );
      } else {
        warnings.push(`Reddit answered HTTP ${res.status}.`);
      }
    } catch (e) {
      warnings.push(`Reddit fetch failed: ${(e as Error).message}`);
    }
    const title = (post.title as string | undefined) ?? `Reddit post ${p?.id ?? ''}`.trim();
    const body = [
      post.title,
      post.selftext,
      post.url && !String(post.url).includes('reddit.com') ? `Link: ${post.url}` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
    if (body)
      blocks.push({
        source: 'reddit',
        kind: 'caption',
        content: body,
        label: `r/${(post.subreddit as string) ?? p?.sub ?? '?'} post by u/${(post.author as string) ?? '?'}`,
      });
    if (comments.length)
      blocks.push({
        source: 'reddit',
        kind: 'comments',
        content: comments.join('\n'),
        label: `${comments.length} comments, score-ordered`,
      });
    return result(
      'reddit',
      canonical,
      title,
      blocks,
      [
        {
          kind: 'caption',
          content: {
            title: post.title,
            selftext: post.selftext,
            author: post.author,
            score: post.score,
            url: post.url,
          },
          tool: 'reddit-json',
        },
        { kind: 'comments', content: comments, tool: 'reddit-json' },
      ],
      warnings,
    );
  },
};
