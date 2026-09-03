import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface ReadablePage {
  title: string;
  text: string;
  byline?: string;
  siteName?: string;
  description?: string;
}

/** Readability over linkedom: cheap, no browser. Falls back to stripped body text. */
export function readablePage(html: string, url: string): ReadablePage {
  const { document } = parseHTML(html);
  const meta = (name: string) =>
    document
      .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
      ?.getAttribute('content') ?? undefined;
  const fallbackTitle = document.querySelector('title')?.textContent?.trim() || url;
  try {
    // linkedom's Document is close enough to DOM for Readability; cast through unknown.
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
      { charThreshold: 200 },
    ).parse();
    if (article?.textContent && article.textContent.trim().length > 0) {
      const out: ReadablePage = {
        title: article.title?.trim() || meta('og:title') || fallbackTitle,
        text: article.textContent.replace(/\n{3,}/g, '\n\n').trim(),
      };
      if (article.byline) out.byline = article.byline;
      if (article.siteName) out.siteName = article.siteName;
      const desc = meta('og:description') ?? meta('description');
      if (desc) out.description = desc;
      return out;
    }
  } catch {
    // fall through
  }
  for (const el of document.querySelectorAll('script,style,noscript,svg')) el.remove();
  const text = (document.body?.textContent ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const out: ReadablePage = { title: meta('og:title') || fallbackTitle, text };
  const desc = meta('og:description') ?? meta('description');
  if (desc) out.description = desc;
  return out;
}
