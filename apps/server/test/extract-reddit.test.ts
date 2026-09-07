import { describe, expect, it, vi } from 'vitest';
import {
  parseRedditAtom,
  redditExtractor,
  redditRetryDelayMs,
  redditShareLink,
} from '../src/extract/platforms/reddit.js';
import type { ExtractContext } from '../src/extract/types.js';

const THREAD = 'https://www.reddit.com/r/skiing/comments/1w6g3j2/why_south_american_skiing/';
const ATOM = `<?xml version="1.0"?><feed>
<entry><author><name>/u/op</name></author><content type="html">&lt;table&gt;&lt;tr&gt;&lt;td&gt; Credit to the studio. &amp;#32; submitted by &amp;#32; &lt;a href="https://www.reddit.com/user/op"&gt;/u/op&lt;/a&gt; &lt;span&gt;&lt;a href="https://example.com/article"&gt;[link]&lt;/a&gt;&lt;/span&gt; &lt;span&gt;&lt;a href="${THREAD}"&gt;[comments]&lt;/a&gt;&lt;/span&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content><id>t3_1w6g3j2</id><title>Why South American Skiing Has Never Reached Its Full Potential</title></entry>
<entry><author><name>/u/alice</name></author><content type="html">&lt;div class="md"&gt;&lt;p&gt;Money....&lt;/p&gt;&lt;/div&gt;</content><id>t1_a</id><title>/u/alice on Why</title></entry>
<entry><author><name>/u/bob</name></author><content type="html">&lt;div class="md"&gt;&lt;p&gt;Weather &amp;amp; terrain&lt;/p&gt;&lt;/div&gt;</content><id>t1_b</id><title>/u/bob on Why</title></entry>
</feed>`;

function ctx(
  routes: Record<string, { status: number; body: string; finalUrl?: string; contentType?: string }>,
  log: string[] = [],
): ExtractContext {
  return {
    mode: 'standard',
    focus: 'whole',
    signal: new AbortController().signal,
    async fetchText(url) {
      log.push(url);
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      if (!key) return { status: 404, body: '', finalUrl: url, contentType: 'text/html' };
      const r = routes[key] as (typeof routes)[string];
      return {
        status: r.status,
        body: r.body,
        finalUrl: r.finalUrl ?? url,
        contentType: r.contentType ?? 'text/html',
      };
    },
  };
}

describe('reddit extractor', () => {
  it('recognises app share links and leaves them unresolved until extract time', () => {
    const u = new URL('https://www.reddit.com/r/skiing/s/GrNIvq5MEU');
    expect(redditShareLink(u)).toEqual({ sub: 'skiing', share: 'GrNIvq5MEU' });
    expect(redditExtractor.match(u)).toBe(true);
    expect(redditExtractor.canonicalize(u)).toBe('https://www.reddit.com/r/skiing/s/GrNIvq5MEU');
    expect(
      redditShareLink(new URL('https://www.reddit.com/r/skiing/comments/abc/')),
    ).toBeUndefined();
  });

  it('parses the Atom feed into post + flat comments', () => {
    const a = parseRedditAtom(ATOM, 10);
    expect(a.title).toBe('Why South American Skiing Has Never Reached Its Full Potential');
    expect(a.author).toBe('op');
    expect(a.link).toBe('https://example.com/article');
    expect(a.body).toBe('Credit to the studio.');
    expect(a.comments).toEqual(['- u/alice: Money....', '- u/bob: Weather & terrain']);
    expect(parseRedditAtom(ATOM, 1).comments).toHaveLength(1);
  });

  it('follows a share-link redirect, falls back to Atom when .json is refused', async () => {
    const log: string[] = [];
    const c = ctx(
      {
        'https://www.reddit.com/r/skiing/s/GrNIvq5MEU': {
          status: 200,
          body: '<html/>',
          finalUrl: `${THREAD}?share_id=x&utm_source=share`,
        },
        'https://www.reddit.com/r/skiing/comments/1w6g3j2.json': {
          status: 403,
          body: '<html>blocked</html>',
        },
        'https://www.reddit.com/r/skiing/comments/1w6g3j2/.rss': {
          status: 200,
          body: ATOM,
          contentType: 'application/atom+xml',
        },
      },
      log,
    );
    const r = await redditExtractor.extract(
      new URL('https://www.reddit.com/r/skiing/s/GrNIvq5MEU'),
      c,
    );
    expect(r.platform).toBe('reddit');
    expect(r.canonicalUrl).toBe('https://www.reddit.com/r/skiing/comments/1w6g3j2/');
    expect(r.title).toBe('Why South American Skiing Has Never Reached Its Full Potential');
    expect(r.blocks.map((b) => b.kind)).toEqual(['caption', 'comments']);
    expect(r.blocks[0]?.content).toContain('Link: https://example.com/article');
    expect(r.blocks[1]?.content).toContain('u/alice');
    expect(r.warnings.some((w) => w.includes('Atom feed'))).toBe(true);
    expect(log).toHaveLength(3);
  });

  it('prefers the JSON view when it is served', async () => {
    const json = JSON.stringify([
      {
        data: {
          children: [
            { kind: 't3', data: { title: 'T', selftext: 'S', author: 'a', subreddit: 'skiing' } },
          ],
        },
      },
      { data: { children: [{ kind: 't1', data: { body: 'hi', author: 'b', score: 3 } }] } },
    ]);
    const c = ctx({
      'https://www.reddit.com/r/skiing/comments/abc.json': {
        status: 200,
        body: json,
        contentType: 'application/json; charset=UTF-8',
      },
    });
    const r = await redditExtractor.extract(
      new URL('https://old.reddit.com/r/skiing/comments/abc/x/'),
      c,
    );
    expect(r.title).toBe('T');
    expect(r.blocks[1]?.label).toContain('score-ordered');
    expect(r.warnings).toEqual([]);
  });

  it('turns rate-limit headers into a bounded delay', () => {
    expect(redditRetryDelayMs({ 'x-ratelimit-reset': '41' })).toBe(42_000);
    expect(redditRetryDelayMs({ 'retry-after': '2', 'x-ratelimit-reset': '41' })).toBe(3_000);
    expect(redditRetryDelayMs({ 'x-ratelimit-reset': '600' })).toBeUndefined();
    expect(redditRetryDelayMs({ 'x-ratelimit-reset': 'soon' })).toBeUndefined();
    expect(redditRetryDelayMs(undefined)).toBeUndefined();
  });

  it('waits out a 429 on the Atom feed and retries once', async () => {
    vi.useFakeTimers();
    try {
      let feedHits = 0;
      const c: ExtractContext = {
        mode: 'quick',
        focus: 'whole',
        signal: new AbortController().signal,
        async fetchText(url) {
          if (url.includes('.json'))
            return { status: 403, body: 'blocked', finalUrl: url, contentType: 'text/html' };
          feedHits += 1;
          if (feedHits === 1)
            return {
              status: 429,
              body: '',
              finalUrl: url,
              contentType: 'text/html',
              headers: { 'x-ratelimit-reset': '3' },
            };
          return { status: 200, body: ATOM, finalUrl: url, contentType: 'application/atom+xml' };
        },
      };
      const pending = redditExtractor.extract(new URL(THREAD), c);
      await vi.advanceTimersByTimeAsync(4_100);
      const r = await pending;
      expect(feedHits).toBe(2);
      expect(r.title).toBe('Why South American Skiing Has Never Reached Its Full Potential');
      expect(r.warnings.some((w) => w.includes('Atom feed'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a 429 whose reset is too far away', async () => {
    let feedHits = 0;
    const c: ExtractContext = {
      mode: 'quick',
      focus: 'whole',
      signal: new AbortController().signal,
      async fetchText(url) {
        if (url.includes('.json'))
          return { status: 403, body: 'blocked', finalUrl: url, contentType: 'text/html' };
        feedHits += 1;
        return {
          status: 429,
          body: '',
          finalUrl: url,
          contentType: 'text/html',
          headers: { 'x-ratelimit-reset': '900' },
        };
      },
    };
    const r = await redditExtractor.extract(new URL(THREAD), c);
    expect(feedHits).toBe(1);
    expect(r.warnings).toContain('Reddit answered HTTP 429.');
  });
});
