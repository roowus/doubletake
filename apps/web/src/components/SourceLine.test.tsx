// @vitest-environment jsdom
import type { ChatDetail } from '@doubletake/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hostOf, SourceLine } from './SourceLine';

const chat: ChatDetail['chat'] = {
  id: 'c1',
  itemId: 'i1',
  title: 'A reel',
  platform: 'instagram',
  channel: 'ig_dm',
  status: 'answered',
  category: null,
  unreadCount: 0,
  lastMessageAt: 't',
  createdAt: '2026-09-07T10:00:00Z',
  sourceUrl: 'https://www.instagram.com/reel/abc/',
  tags: [],
};
const item: ChatDetail['item'] = {
  note: null,
  focus: 'whole',
  modeRequested: 'auto',
  modeEffective: 'quick',
  questionType: null,
  canonicalUrl: 'https://www.instagram.com/reel/abc/',
  sourceUrl: 'https://www.instagram.com/reel/abc/?igsh=x',
  title: 'A reel',
  preview: null,
};

describe('SourceLine', () => {
  it('links the canonical URL and shows the host and date, not the title', () => {
    const html = renderToStaticMarkup(<SourceLine chat={chat} item={item} at={chat.createdAt} />);
    expect(html).toContain('class="m-source"');
    expect(html).toContain('href="https://www.instagram.com/reel/abc/"');
    expect(html).toContain('instagram.com');
    expect(html).toContain('Sep 7');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('igsh'); // tracking parameters never shown
    expect(html).not.toContain('A reel'); // the title belongs to the h1, not this line
  });
  it('renders nothing for typed text without a URL and without a preview', () => {
    const html = renderToStaticMarkup(
      <SourceLine
        chat={{ ...chat, platform: 'text', sourceUrl: null }}
        item={{ ...item, canonicalUrl: null, sourceUrl: null }}
        at={chat.createdAt}
      />,
    );
    expect(html).toBe('');
  });
  it('says "Shared video" for an upload with no host', () => {
    const html = renderToStaticMarkup(
      <SourceLine
        chat={{ ...chat, platform: 'text', sourceUrl: null }}
        item={{
          ...item,
          canonicalUrl: null,
          sourceUrl: null,
          preview: { mediaId: 'm1', kind: 'frame', width: 720, height: 1280 },
        }}
        at={chat.createdAt}
      />,
    );
    expect(html).toContain('Shared video');
  });
  it('never puts the token or the media URL in the markup before the image is fetched', () => {
    const html = renderToStaticMarkup(
      <SourceLine
        chat={chat}
        item={{ ...item, preview: { mediaId: 'm1', kind: 'frame', width: 720, height: 1280 } }}
        at={chat.createdAt}
      />,
    );
    expect(html).not.toContain('/api/chats/');
    expect(html).not.toContain('<img');
  });
  it('hostOf strips www and survives garbage', () => {
    expect(hostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});
