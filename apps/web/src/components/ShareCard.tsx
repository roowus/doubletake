import type { ChatDetail } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { fetchWithRetry, getToken } from '../api';
import { apiBase } from '../native';
import { Icon, platformIcon } from './Icon';

/**
 * Loads a token-gated image as a blob URL so the device token travels in a header, never in
 * the `src` (and therefore never in server logs, browser history or a copied link).
 */
export function useAuthedImage(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    const token = getToken();
    fetchWithRetry(apiBase() + url, {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b || cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return src;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The shared thing itself, shown on the owner's side of the chat above their note: platform,
 * title, the link, and one still image when the media worker saved a thumbnail or frame.
 * An uploaded photo or video (no URL, but a preview) gets a non-link card with the image;
 * typed text (no URL, no media) has no card, its text is already the first user message.
 */
export function ShareCard({ chat, item }: Pick<ChatDetail, 'chat' | 'item'>) {
  const url = item.canonicalUrl ?? item.sourceUrl ?? chat.sourceUrl;
  const host = hostOf(url);
  const img = useAuthedImage(
    item.preview ? `/api/chats/${chat.id}/media/${item.preview.mediaId}` : null,
  );
  const portrait =
    !!item.preview?.width && !!item.preview?.height && item.preview.height > item.preview.width;
  if (!url || !host) {
    if (!item.preview) return null;
    // Uploaded file: the preview is the photo itself (kind image) or a frame of the video.
    const video = item.preview.kind === 'frame';
    const label = video ? 'Shared video' : 'Shared photo';
    return (
      <section
        className={`msg user share upload${img ? ' has-image' : ''}${portrait ? ' portrait' : ''}`}
        aria-label={label}
      >
        {img && <img src={img} alt={label} className="share-thumb" loading="lazy" />}
        <span className="share-body">
          <span className="row small muted">
            <Icon name={video ? 'film' : 'image'} size={14} />
            <span className="grow">{label}</span>
          </span>
        </span>
      </section>
    );
  }
  const title = item.title && item.title !== url ? item.title : null;
  return (
    <a
      className={`msg user share${img ? ' has-image' : ''}${portrait ? ' portrait' : ''}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open the shared ${chat.platform} link on ${host}`}
    >
      {img && <img src={img} alt="" className="share-thumb" loading="lazy" />}
      <span className="share-body">
        <span className="row small muted">
          <Icon name={platformIcon(chat.platform)} size={14} />
          <span className="grow">{host}</span>
          <Icon name="external-link" size={14} />
        </span>
        {title && <span className="share-title clamp-2">{title}</span>}
        <span className="share-url mono clamp-1">{url.replace(/^https?:\/\//, '')}</span>
      </span>
    </a>
  );
}
