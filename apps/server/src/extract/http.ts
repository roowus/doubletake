import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function isPrivateAddress(addr: string): boolean {
  if (net.isIPv4(addr)) return PRIVATE_V4.some((re) => re.test(addr));
  if (net.isIPv6(addr)) {
    const a = addr.toLowerCase();
    return (
      a === '::1' ||
      a === '::' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe80') ||
      a.startsWith('::ffff:')
    );
  }
  return true;
}

/** Fetch a URL as text with an SSRF guard (public addresses only) and a byte cap. Follows ≤5 redirects, re-checking each hop. */
export async function fetchText(
  url: string,
  opts: { maxBytes?: number; accept?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ status: number; body: string; finalUrl: string; contentType: string }> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:')
      throw new Error('only http(s) URLs may be fetched');
    if (current.username || current.password)
      throw new Error('credentials in URLs are not allowed');
    const host = current.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal'))
      throw new Error('refusing to fetch a local hostname');
    const addrs = net.isIP(host)
      ? [host]
      : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (addrs.length === 0 || addrs.some(isPrivateAddress))
      throw new Error(`refusing to fetch a private address for ${host}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: opts.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'user-agent':
            'Mozilla/5.0 (compatible; Doubletake/0.1; +https://github.com/roowus/doubletake)',
          'accept-language': 'en',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location') as string, current);
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      return {
        status: res.status,
        body: Buffer.concat(chunks).toString('utf8'),
        finalUrl: current.toString(),
        contentType,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw new Error('too many redirects');
}
