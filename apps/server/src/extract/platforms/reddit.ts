import type { UntrustedBlock } from '@doubletake/shared';
import { MODE_BUDGETS } from '@doubletake/shared';
import type { PlatformExtractor } from '../types.js';
import { result, stripHtml } from './_shared.js';

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
  const s = u.pathname.match(/^\/comments\/([a-z0-9]+)/i);
  return s?.[1] ? { id: s[1] } : undefined;
}

/**
 * Share links minted by the Reddit apps: `https://www.reddit.com/r/<sub>/s/<opaque>`. The
 * opaque id is not the post id; Reddit 301s it to the real thread, so it is only resolvable
 * at extract time.
 */
export function redditShareLink(u: URL): { sub: string; share: string } | undefined {
  if (!HOSTS.has(u.hostname.toLowerCase())) return undefined;
  const m = u.pathname.match(/^\/r\/([\w]+)\/s\/([A-Za-z0-9]+)/);
  return m?.[1] && m[2] ? { sub: m[1], share: m[2] } : undefined;
}

/** Comments and the post itself from Reddit's Atom feed, used when `.json` is refused. */
export function parseRedditAtom(
  xml: string,
  cap: number,
): {
  title: string | undefined;
  author: string | undefined;
  body: string | undefined;
  link: string | undefined;
  comments: string[];
} {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1] ?? '');
  const field = (e: string, re: RegExp) => e.match(re)?.[1];
  // Entries carry HTML escaped inside XML: one pass yields HTML, the second yields text.
  const xmlDecode = (s: string) => stripHtml(s);
  const decode = (s: string) => stripHtml(xmlDecode(s));
  let title: string | undefined;
  let author: string | undefined;
  let body: string | undefined;
  let link: string | undefined;
  const comments: string[] = [];
  for (const e of entries) {
    const id = field(e, /<id>([^<]+)<\/id>/) ?? '';
    const who = (field(e, /<name>([^<]+)<\/name>/) ?? '/u/?').replace(/^\/u\//, '');
    const raw = field(e, /<content[^>]*>([\s\S]*?)<\/content>/) ?? '';
    const content = stripHtml(xmlDecode(raw));
    if (id.startsWith('t3_')) {
      title = decode(field(e, /<title>([\s\S]*?)<\/title>/) ?? '');
      author = who;
      const outbound = xmlDecode(raw).match(/href="(https?:\/\/(?!www\.reddit\.com)[^"]+)"/);
      link = outbound?.[1];
      body = content
        .replace(/submitted by\s+\/u\/\S+/, '')
        .replace(/\[link\]|\[comments\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (id.startsWith('t1_') && content) {
      if (comments.length >= cap) continue;
      comments.push(`- u/${who}: ${content.replace(/\s+/g, ' ').trim()}`);
    }
  }
  return { title, author, body, link, comments };
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
  match: (u) => redditPost(u) !== undefined || redditShareLink(u) !== undefined,
  canonicalize(u) {
    const p = redditPost(u);
    if (!p) {
      const s = redditShareLink(u);
      // Share links stay as-is until extract() follows the redirect; the worker then stores
      // the resolved thread URL as the canonical one.
      return s ? `https://www.reddit.com/r/${s.sub}/s/${s.share}` : u.toString();
    }
    return p.sub
      ? `https://www.reddit.com/r/${p.sub}/comments/${p.id}/`
      : `https://www.reddit.com/comments/${p.id}/`;
  },
  async extract(url, ctx) {
    const warnings: string[] = [];
    const blocks: UntrustedBlock[] = [];
    let post: Record<string, unknown> = {};
    const comments: string[] = [];
    let canonical = this.canonicalize(url);
    let p = redditPost(url);
    const cap = MODE_BUDGETS[ctx.mode].commentsMax;

    // App share links: follow the 301 to learn the real thread id.
    if (!p && redditShareLink(url)) {
      try {
        const res = await ctx.fetchText(canonical, { maxBytes: 64 * 1024 });
        const resolved = redditPost(new URL(res.finalUrl));
        if (resolved) {
          p = resolved;
          canonical = this.canonicalize(new URL(res.finalUrl));
        } else warnings.push('Reddit share link did not resolve to a thread.');
      } catch (e) {
        warnings.push(`Reddit share link could not be resolved: ${(e as Error).message}`);
      }
    }

    const base = canonical.replace(/\/$/, '');
    let gotJson = false;
    if (p) {
      try {
        const res = await ctx.fetchText(`${base}.json?raw_json=1&limit=200`, {
          accept: 'application/json',
          maxBytes: 4 * 1024 * 1024,
        });
        if (res.status === 200 && res.contentType.includes('json')) {
          const json = JSON.parse(res.body) as {
            data?: { children?: { kind: string; data: Record<string, unknown> }[] };
          }[];
          post = json[0]?.data?.children?.[0]?.data ?? {};
          flatten(
            json[1]?.data?.children as { kind: string; data: RedditComment }[] | undefined,
            0,
            comments,
            cap,
          );
          gotJson = true;
        }
      } catch {
        /* fall back to the Atom feed below */
      }
    }
    // Reddit refuses anonymous `.json` from many networks (HTTP 403 "blocked by network
    // security") but still serves the Atom feed of the same thread.
    if (p && !gotJson) {
      try {
        const res = await ctx.fetchText(`${base}/.rss?limit=200`, {
          accept: 'application/atom+xml,application/xml,text/xml',
          maxBytes: 4 * 1024 * 1024,
        });
        if (res.status === 200) {
          const atom = parseRedditAtom(res.body, cap);
          if (atom.title) post.title = atom.title;
          if (atom.author) post.author = atom.author;
          if (atom.body) post.selftext = atom.body;
          if (atom.link) post.url = atom.link;
          post.subreddit = p.sub;
          comments.push(...atom.comments);
          warnings.push(
            'Reddit refused the JSON view; the Atom feed was used instead (no scores, flat comments).',
          );
        } else {
          warnings.push(`Reddit answered HTTP ${res.status}.`);
        }
      } catch (e) {
        warnings.push(`Reddit fetch failed: ${(e as Error).message}`);
      }
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
        label: gotJson
          ? `${comments.length} comments, score-ordered`
          : `${comments.length} comments`,
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
