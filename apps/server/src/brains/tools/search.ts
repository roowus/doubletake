/**
 * Web search providers for the tool loop (docs/BRAIN-ADAPTERS.md §openai-compatible).
 * The provider is a configured backend, so its URL is trusted; results are not (they are
 * wrapped as untrusted content by the tool runner before the model sees them).
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly id: string;
  search(query: string, opts: { count: number; signal?: AbortSignal }): Promise<SearchResult[]>;
}

export interface SearchConfig {
  provider: 'searxng' | 'brave' | 'tavily' | 'off';
  searxngUrl: string;
  braveKey: string | null;
  tavilyKey: string | null;
}

type FetchLike = typeof fetch;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function readJson(res: Response, who: string): Promise<unknown> {
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${who} returned ${res.status}${body ? `: ${body}` : ''}`);
  }
  return res.json();
}

export class SearxngProvider implements SearchProvider {
  readonly id = 'searxng';
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async search(query: string, opts: { count: number; signal?: AbortSignal }) {
    const u = new URL('/search', this.baseUrl);
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    const res = await this.fetchImpl(u, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const data = (await readJson(res, 'SearXNG')) as { results?: unknown[] };
    return (data.results ?? []).slice(0, opts.count).map((r) => {
      const o = r as Record<string, unknown>;
      return { title: str(o.title), url: str(o.url), snippet: str(o.content) };
    });
  }
}

export class BraveProvider implements SearchProvider {
  readonly id = 'brave';
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async search(query: string, opts: { count: number; signal?: AbortSignal }) {
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', query);
    u.searchParams.set('count', String(Math.min(20, Math.max(1, opts.count))));
    const res = await this.fetchImpl(u, {
      headers: { accept: 'application/json', 'X-Subscription-Token': this.apiKey },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const data = (await readJson(res, 'Brave Search')) as { web?: { results?: unknown[] } };
    return (data.web?.results ?? []).slice(0, opts.count).map((r) => {
      const o = r as Record<string, unknown>;
      return { title: str(o.title), url: str(o.url), snippet: str(o.description) };
    });
  }
}

export class TavilyProvider implements SearchProvider {
  readonly id = 'tavily';
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  async search(query: string, opts: { count: number; signal?: AbortSignal }) {
    const res = await this.fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: Math.min(20, Math.max(1, opts.count)) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const data = (await readJson(res, 'Tavily')) as { results?: unknown[] };
    return (data.results ?? []).slice(0, opts.count).map((r) => {
      const o = r as Record<string, unknown>;
      return { title: str(o.title), url: str(o.url), snippet: str(o.content) };
    });
  }
}

/** `null` when no provider is usable (provider `off`, or a key-based provider without its key). */
export function createSearchProvider(
  cfg: SearchConfig,
  fetchImpl: FetchLike = fetch,
): SearchProvider | null {
  switch (cfg.provider) {
    case 'searxng':
      return new SearxngProvider(cfg.searxngUrl, fetchImpl);
    case 'brave':
      return cfg.braveKey ? new BraveProvider(cfg.braveKey, fetchImpl) : null;
    case 'tavily':
      return cfg.tavilyKey ? new TavilyProvider(cfg.tavilyKey, fetchImpl) : null;
    default:
      return null;
  }
}
