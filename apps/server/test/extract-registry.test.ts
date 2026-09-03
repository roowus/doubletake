import { describe, expect, it } from 'vitest';
import { detectPlatform, firstUrlIn } from '../src/extract/registry.js';

const cases: [string, string, string][] = [
  [
    'https://www.instagram.com/reel/C9abc_DEF/?igsh=xyz',
    'instagram',
    'https://www.instagram.com/reel/C9abc_DEF/',
  ],
  ['https://instagram.com/p/Cxyz123/', 'instagram', 'https://www.instagram.com/p/Cxyz123/'],
  [
    'https://www.instagram.com/someuser/reels/C9abc/',
    'instagram',
    'https://www.instagram.com/reel/C9abc/',
  ],
  ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    'youtube',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ],
  [
    'https://youtube.com/shorts/abc123DEF45?feature=share',
    'youtube',
    'https://www.youtube.com/shorts/abc123DEF45',
  ],
  ['https://twitter.com/jack/status/20?s=20&t=xx', 'x', 'https://x.com/jack/status/20'],
  ['https://x.com/jack/status/20/photo/1', 'x', 'https://x.com/jack/status/20'],
  [
    'https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1',
    'tiktok',
    'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  ],
  ['https://vm.tiktok.com/ZMabc123/', 'tiktok', 'https://vm.tiktok.com/ZMabc123/'],
  [
    'https://old.reddit.com/r/skiing/comments/1abcd2/five_tips/?utm_source=share',
    'reddit',
    'https://www.reddit.com/r/skiing/comments/1abcd2/',
  ],
  ['https://chatgpt.com/share/abc-123', 'aichat', 'https://chatgpt.com/share/abc-123'],
  ['https://gemini.google.com/share/abc123', 'aichat', 'https://gemini.google.com/share/abc123'],
  ['https://claude.ai/share/abc-123', 'aichat', 'https://claude.ai/share/abc-123'],
  [
    'https://example.com/article?utm_campaign=x&id=5#top',
    'web',
    'https://example.com/article?id=5',
  ],
  ['https://x.com/home', 'web', 'https://x.com/home'],
];

describe('platform registry', () => {
  for (const [input, platform, canonical] of cases) {
    it(`${input} → ${platform}`, () => {
      expect(detectPlatform(input)).toEqual({ platform, canonicalUrl: canonical });
    });
  }
  it('rejects non-http schemes', () => {
    expect(detectPlatform('file:///etc/passwd')).toBeUndefined();
    expect(detectPlatform('not a url')).toBeUndefined();
  });
  it('finds the first URL in shared text', () => {
    expect(firstUrlIn('check this https://youtu.be/abc?si=1. wild')).toBe(
      'https://youtu.be/abc?si=1',
    );
    expect(firstUrlIn('no link')).toBeUndefined();
  });
});
