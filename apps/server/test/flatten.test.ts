import { describe, expect, it } from 'vitest';
import { extractionText, parseExtraction } from '../src/extract/flatten.js';

describe('extractionText', () => {
  it('renders worker transcripts as timestamped lines', () => {
    const t = extractionText('transcript', {
      language: 'en',
      segments: [
        { start: 0, end: 2.5, text: ' Hello there ' },
        { start: 65, end: 70, text: 'a minute in' },
      ],
    });
    expect(t).toBe('[0:00] Hello there\n[1:05] a minute in');
  });

  it('renders OCR frames, falling back to merged lines', () => {
    expect(
      extractionText('ocr', { frames: [{ ts: 3, lines: ['SALE', '50% off'] }], merged: [] }),
    ).toBe('[0:03] SALE | 50% off');
    expect(extractionText('ocr', { frames: [], merged: ['just', 'merged'] })).toBe('just\nmerged');
  });

  it('handles yt-dlp, Instagram Graph and Reddit comment shapes', () => {
    expect(
      extractionText('comments', {
        total: 40,
        sampled: [{ id: '1', author: 'ann', text: 'great\n  video', likes: 3 }],
      }),
    ).toBe('40 comments, 1 shown\n- ann (+3): great video');
    expect(
      extractionText('comments', {
        total: 2,
        sampled: [{ id: 'a', text: 'yo', username: 'bob', like_count: 0 }],
      }),
    ).toBe('2 comments, 1 shown\n- bob: yo');
    expect(extractionText('comments', ['first', 'second'])).toBe('- first\n- second');
  });

  it('renders a thread with indented replies', () => {
    expect(
      extractionText('thread', {
        parent: { id: 'p', text: 'is this true?', username: 'ann' },
        replies: [{ id: 'r', text: 'yes', username: 'bob', like_count: 2 }],
      }),
    ).toBe('- ann: is this true?\n  - bob (+2): yes');
  });

  it('renders captions from oembed, reddit and plain strings', () => {
    expect(extractionText('caption', 'plain caption')).toBe('plain caption');
    expect(
      extractionText('caption', { oembed: { title: 'Me at the zoo', author_name: 'jawed' } }),
    ).toBe('Me at the zoo\nby jawed');
    expect(
      extractionText('caption', {
        title: 'Ask',
        selftext: 'body text',
        author: 'u1',
        score: 12,
        url: 'x',
      }),
    ).toBe('Ask\nby u1\n\nbody text\n\nscore 12');
  });

  it('renders frame descriptions and page text, and falls back to JSON', () => {
    expect(
      extractionText('frame_description', { frames: [{ ts: 12, text: 'a cat' }], prompt: 'p' }),
    ).toBe('[0:12] a cat');
    expect(extractionText('page_text', { title: 'T', text: 'Body' })).toBe('T\n\nBody');
    expect(extractionText('weird', { a: 1 })).toBe('{\n "a": 1\n}');
    expect(extractionText('comments', null)).toBe('');
  });

  it('parseExtraction tolerates non-JSON columns', () => {
    expect(parseExtraction('{"a":1}')).toEqual({ a: 1 });
    expect(parseExtraction('raw text')).toBe('raw text');
  });
});
