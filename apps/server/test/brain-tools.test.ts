import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OPEN_POLICY } from '@doubletake/brain-sdk';
import { describe, expect, it } from 'vitest';
import { buildTools } from '../src/brains/tools/index.js';
import { createSearchProvider, type SearchProvider } from '../src/brains/tools/search.js';

const search: SearchProvider = {
  id: 'fake',
  async search(q, { count }) {
    return Array.from({ length: Math.min(count, 2) }, (_, i) => ({
      title: `${q} ${i}`,
      url: `https://example.com/${i}`,
      snippet: 'snippet',
    }));
  },
};

describe('buildTools', () => {
  it('exposes only what the policy allows', () => {
    const none = buildTools({ ...OPEN_POLICY, webSearch: false, webFetch: false }, { search });
    expect(none.specs).toEqual([]);
    const noSearchBackend = buildTools(OPEN_POLICY, { search: null });
    expect(noSearchBackend.specs.map((s) => s.name)).toEqual(['web_fetch']);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tools-'));
    const all = buildTools(
      { ...OPEN_POLICY, readRoots: [root], writeRoot: path.join(root, 'notes') },
      { search },
    );
    expect(all.specs.map((s) => s.name)).toEqual([
      'web_search',
      'web_fetch',
      'read_file',
      'list_dir',
      'write_sandbox_file',
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses unknown tools and enforces the search budget', async () => {
    const t = buildTools({ ...OPEN_POLICY, maxSearches: 1 }, { search });
    expect((await t.call('read_file', { path: '/etc/passwd' })).ok).toBe(false);
    const first = await t.call('web_search', { query: 'q' });
    expect(first.ok).toBe(true);
    expect(first.text).toContain('<untrusted');
    const second = await t.call('web_search', { query: 'q' });
    expect(second.ok).toBe(false);
    expect(second.text).toContain('budget');
  });

  it('file tools stay inside the roots and the sandbox', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tools-'));
    fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
    const t = buildTools(
      { ...OPEN_POLICY, readRoots: [root], writeRoot: path.join(root, 'notes') },
      { search: null },
    );
    expect((await t.call('read_file', { path: path.join(root, 'a.txt') })).text).toContain('hello');
    expect((await t.call('read_file', { path: '/etc/hosts' })).ok).toBe(false);
    const w = await t.call('write_sandbox_file', { path: 'x/y.md', content: 'note' });
    expect(w.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'notes', 'x', 'y.md'), 'utf8')).toBe('note');
    expect((await t.call('write_sandbox_file', { path: '../esc.md', content: 'x' })).ok).toBe(
      false,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('createSearchProvider', () => {
  it('returns null when off or when a keyed provider has no key', () => {
    const base = { searxngUrl: 'http://127.0.0.1:8888', braveKey: null, tavilyKey: null };
    expect(createSearchProvider({ ...base, provider: 'off' })).toBeNull();
    expect(createSearchProvider({ ...base, provider: 'brave' })).toBeNull();
    expect(createSearchProvider({ ...base, provider: 'searxng' })?.id).toBe('searxng');
    expect(createSearchProvider({ ...base, provider: 'tavily', tavilyKey: 'k' })?.id).toBe(
      'tavily',
    );
  });

  it('maps provider payloads to results', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('brave'))
        return new Response(
          JSON.stringify({
            web: { results: [{ title: 'B', url: 'https://b', description: 'd' }] },
          }),
        );
      return new Response(
        JSON.stringify({ results: [{ title: 'S', url: 'https://s', content: 'c' }] }),
      );
    }) as unknown as typeof fetch;
    const base = { searxngUrl: 'http://127.0.0.1:8888', braveKey: 'bk', tavilyKey: 'tk' };
    const brave = createSearchProvider({ ...base, provider: 'brave' }, fetchImpl);
    expect(await brave?.search('x', { count: 3 })).toEqual([
      { title: 'B', url: 'https://b', snippet: 'd' },
    ]);
    const sx = createSearchProvider({ ...base, provider: 'searxng' }, fetchImpl);
    expect(await sx?.search('x', { count: 3 })).toEqual([
      { title: 'S', url: 'https://s', snippet: 'c' },
    ]);
  });
});
