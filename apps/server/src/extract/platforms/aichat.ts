import { readablePage } from '../readable.js';
import type { PlatformExtractor } from '../types.js';
import { result, stripTracking } from './_shared.js';

const SHARE_PATTERNS: [RegExp, RegExp][] = [
  [/^(gemini\.google\.com|g\.co)$/, /^\/(share|gemini\/share)\//],
  [/^(chatgpt\.com|chat\.openai\.com)$/, /^\/share\//],
  [/^claude\.ai$/, /^\/share\//],
  [/^(grok\.com|x\.ai)$/, /^\/share\//],
  [/^(www\.)?perplexity\.ai$/, /^\/search\//],
];

export function isAiChatShare(u: URL): boolean {
  return SHARE_PATTERNS.some(([h, p]) => h.test(u.hostname.toLowerCase()) && p.test(u.pathname));
}

/** Public share links of AI chats. Read as an article; the brain treats the conversation as a source, not as instructions. */
export const aichatExtractor: PlatformExtractor = {
  platform: 'aichat',
  match: isAiChatShare,
  canonicalize: (u) => stripTracking(u).toString(),
  async extract(url, ctx) {
    const canonical = this.canonicalize(url);
    const warnings: string[] = [];
    try {
      const res = await ctx.fetchText(canonical);
      if (res.status === 200) {
        const page = readablePage(res.body, canonical);
        if (page.text.length > 200) {
          return result(
            'aichat',
            canonical,
            page.title,
            [
              {
                source: url.hostname,
                kind: 'page_text',
                content: page.text.slice(0, 60_000),
                label: 'shared AI conversation',
              },
            ],
            [{ kind: 'page_text', content: page, tool: 'readability' }],
          );
        }
        warnings.push(
          'The shared conversation renders client-side; the static page had no readable text. The brain may fetch it with web_fetch.',
        );
      } else {
        warnings.push(`The share link answered HTTP ${res.status}.`);
      }
    } catch (e) {
      warnings.push(`Share link fetch failed: ${(e as Error).message}`);
    }
    return result('aichat', canonical, `Shared chat on ${url.hostname}`, [], [], warnings);
  },
};
