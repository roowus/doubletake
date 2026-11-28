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
 * The one line that says what this page is about: platform glyph, host, date, and the shared
 * thing's thumbnail when there is one. It replaces the old clip card (ADR 0034): the page is
 * the answer, and the clip is context that fits in a line. An uploaded photo or video has no
 * host, so it shows the thumbnail and a plain "Shared photo / video" label instead.
 */
export function SourceLine({ chat, item, at }: Pick<ChatDetail, 'chat' | 'item'> & { at: string }) {
  const url = item.canonicalUrl ?? item.sourceUrl ?? chat.sourceUrl;
  const host = hostOf(url);
  const img = useAuthedImage(
    item.preview ? `/api/chats/${chat.id}/media/${item.preview.mediaId}` : null,
  );
  const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sep = <span className="sep">·</span>;
  if (!url || !host) {
    if (!item.preview) return null;
    const video = item.preview.kind === 'frame';
    const label = video ? 'Shared video' : 'Shared photo';
    return (
      <div className="m-source">
        {img ? (
          <img src={img} alt="" className="m-source-thumb" loading="lazy" />
        ) : (
          <Icon name={video ? 'film' : 'image'} size={13} />
        )}
        <span>{label}</span>
        {sep}
        <span>{when}</span>
      </div>
    );
  }
  return (
    <div className="m-source">
      {img ? (
        <img src={img} alt="" className="m-source-thumb" loading="lazy" />
      ) : (
        <Icon name={platformIcon(chat.platform)} size={13} />
      )}
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${host}`}>
        {host}
      </a>
      {sep}
      <span>{when}</span>
    </div>
  );
}
