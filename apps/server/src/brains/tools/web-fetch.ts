import { fetchText } from '../../extract/http.js';
import { readablePage } from '../../extract/readable.js';

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<FetchedPage>;

/** Readable text of a public web page: SSRF-guarded fetch, HTML → article text, 200 KB cap. */
export async function fetchPage(
  url: string,
  signal?: AbortSignal,
  maxChars = 200_000,
): Promise<FetchedPage> {
  const res = await fetchText(url, { maxBytes: 4 * 1024 * 1024, ...(signal ? { signal } : {}) });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
  const isHtml = /html|xml/i.test(res.contentType);
  let title = '';
  let text = res.body;
  if (isHtml) {
    const page = readablePage(res.body, res.finalUrl);
    title = page.title;
    text = page.text;
  }
  const truncated = text.length > maxChars;
  return { url: res.finalUrl, title, text: truncated ? text.slice(0, maxChars) : text, truncated };
}
