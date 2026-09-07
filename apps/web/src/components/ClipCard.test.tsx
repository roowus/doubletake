// @vitest-environment jsdom
import type { ChatDetail } from '@doubletake/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClipCard, hostOf } from './ClipCard';

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
  createdAt: 't',
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

describe('ClipCard', () => {
  it('links the canonical URL with host, platform icon and title', () => {
    const html = renderToStaticMarkup(<ClipCard chat={chat} item={item} />);
    expect(html).toContain('href="https://www.instagram.com/reel/abc/"');
    expect(html).toContain('instagram.com');
    expect(html).toContain('A reel');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('igsh'); // tracking parameters never shown
  });
  it('renders nothing for typed text without a URL', () => {
    const html = renderToStaticMarkup(
      <ClipCard
        chat={{ ...chat, platform: 'text', sourceUrl: null }}
        item={{ ...item, canonicalUrl: null, sourceUrl: null }}
      />,
    );
    expect(html).toBe('');
  });
  it('never puts the token or the media URL in the markup before the image is fetched', () => {
    const html = renderToStaticMarkup(
      <ClipCard
        chat={chat}
        item={{ ...item, preview: { mediaId: 'm1', kind: 'frame', width: 720, height: 1280 } }}
      />,
    );
    expect(html).not.toContain('/api/chats/');
    expect(html).not.toContain('<img');
    expect(html).toContain('portrait');
  });
  it('hostOf strips www and survives garbage', () => {
    expect(hostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});
