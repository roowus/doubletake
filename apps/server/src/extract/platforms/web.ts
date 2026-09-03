import type { UntrustedBlock } from '@doubletake/shared';
import { readablePage } from '../readable.js';
import type { PlatformExtractor } from '../types.js';
import { result, stripTracking } from './_shared.js';

/** Fallback for any http(s) URL: readable article text. */
export const webExtractor: PlatformExtractor = {
  platform: 'web',
  match: () => true,
  canonicalize: (u) => stripTracking(u).toString(),
  async extract(url, ctx) {
    const res = await ctx.fetchText(url.toString());
    if (res.status >= 400) {
      return result(
        'web',
        stripTracking(url).toString(),
        url.hostname,
        [],
        [],
        [`The page returned HTTP ${res.status}; nothing could be read from it.`],
      );
    }
    const page = readablePage(res.body, res.finalUrl);
    const cap = ctx.mode === 'quick' ? 12_000 : ctx.mode === 'standard' ? 40_000 : 120_000;
    const text =
      page.text.length > cap
        ? `${page.text.slice(0, cap)}\n\n[truncated at ${cap} characters]`
        : page.text;
    const blocks: UntrustedBlock[] = [
      { source: url.hostname, kind: 'page_text', content: text, label: page.title },
    ];
    if (page.description)
      blocks.unshift({
        source: url.hostname,
        kind: 'caption',
        content: page.description,
        label: 'meta description',
      });
    return result('web', stripTracking(new URL(res.finalUrl)).toString(), page.title, blocks, [
      { kind: 'page_text', content: { ...page, text }, tool: 'readability' },
    ]);
  },
};
