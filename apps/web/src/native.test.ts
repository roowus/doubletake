// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePairingInput, pendingShareToPath, targetPath } from './native';

describe('parsePairingInput', () => {
  it('accepts the QR URL form', () => {
    expect(parsePairingInput('https://mac.tail1234.ts.net/?code=ab12cd')).toEqual({
      url: 'https://mac.tail1234.ts.net',
      code: 'ab12cd',
    });
  });
  it('accepts the JSON form', () => {
    expect(parsePairingInput('{"url":"https://h.ts.net","code":"XY"}')).toEqual({
      url: 'https://h.ts.net',
      code: 'XY',
    });
  });
  it('treats anything else as a bare code, upper-cased', () => {
    expect(parsePairingInput(' k9m2pq ')).toEqual({ code: 'K9M2PQ' });
    expect(parsePairingInput('')).toEqual({});
  });
});

describe('targetPath', () => {
  it('prefers chatId, then the path of url, then root', () => {
    expect(targetPath({ chatId: 'c1', url: 'https://h/chat/other' })).toBe('/chat/c1');
    expect(targetPath({ url: 'https://h.ts.net/chat/c2' })).toBe('/chat/c2');
    expect(targetPath({ url: '/chat/c3' })).toBe('/chat/c3');
    expect(targetPath({})).toBe('/');
  });
});

describe('pendingShareToPath', () => {
  it('carries url/text/title and marks the android_share channel', () => {
    const p = pendingShareToPath({ url: 'https://x.com/a/status/1', title: 'T' });
    const u = new URL(p, 'https://localhost');
    expect(u.pathname).toBe('/share');
    expect(u.searchParams.get('url')).toBe('https://x.com/a/status/1');
    expect(u.searchParams.get('title')).toBe('T');
    expect(u.searchParams.get('channel')).toBe('android_share');
  });
});
