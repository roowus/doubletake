import type { ChatSummary, TagDto } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { Link, navigate } from '../router';
import { CollectionBar } from './Library';

const PLATFORM_ICON: Record<string, string> = {
  instagram: '📸',
  tiktok: '🎵',
  youtube: '▶️',
  x: '𝕏',
  reddit: '👽',
  web: '🌐',
  aichat: '🤖',
  text: '📝',
};

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatList() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [q, setQ] = useState(new URLSearchParams(location.search).get('q') ?? '');
  const [tag, setTag] = useState<string | null>(
    new URLSearchParams(location.search).get('tag') || null,
  );
  const [collection, setCollection] = useState<string | null>(
    new URLSearchParams(location.search).get('collection') || null,
  );
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // "Ask your library": the search box doubles as a question box. Enter filters the list;
  // the Ask button starts a chat whose answer is drawn from past chats (channel `library`).
  const ask = () => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true);
    api
      .askLibrary(question)
      .then((r) => navigate(`/chat/${r.chatId}`))
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setAsking(false));
  };

  const load = () => {
    api
      .chats(q.trim() || undefined, tag ?? undefined, collection ?? undefined)
      .then((c) => {
        setChats(c);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));
    api
      .tags()
      .then(setAllTags)
      .catch(() => {});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when a filter changes
  useEffect(() => {
    load();
    const p = new URLSearchParams(location.search);
    if (collection) p.set('collection', collection);
    else p.delete('collection');
    const qs = p.toString();
    history.replaceState(null, '', qs ? `/?${qs}` : '/');
  }, [q, tag, collection]);
  useLive((e) => {
    if (e.kind === 'chat_updated' || (e.kind === 'run_event' && e.type === 'done')) load();
  });

  // Server-side filter; the chip row shows every tag in use (most used first) so the owner
  // can jump between them without clearing the current one.
  const tags = allTags.map((t) => t.name);
  if (tag && !tags.includes(tag)) tags.unshift(tag);
  const shown = chats ?? [];

  return (
    <div className="page stack">
      <div className="row">
        <input
          placeholder="Search everything you shared, or ask a question about it…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          disabled={!q.trim() || asking}
          title="Ask the brain a question answered from your saved chats"
          onClick={ask}
        >
          {asking ? 'Asking…' : 'Ask library'}
        </button>
      </div>
      <CollectionBar selected={collection} onSelect={setCollection} />
      <div className="row small muted">
        <Link to="/entities/place">Places</Link>
        <Link to="/map">Map</Link>
        <Link to="/entities/recipe">Recipes</Link>
        <Link to="/entities/product">Products</Link>
        <Link to="/entities/tool">Tools</Link>
        <Link to="/entities/tip">Tips</Link>
      </div>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button
              type="button"
              key={t}
              className={`chip ${tag === t ? 'on' : ''}`}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
              {allTags.find((x) => x.name === t)?.kind === 'manual' ? ' ✎' : ''}
            </button>
          ))}
        </div>
      )}
      {err && <div className="msg error">{err}</div>}
      {chats && chats.length === 0 && (
        <div className="card muted">
          Nothing here yet. Share a link from your phone, or paste one with the <b>+</b> button.
        </div>
      )}
      <div className="chatlist">
        {shown.map((c) => (
          <Link
            to={`/chat/${c.id}`}
            className={`chatrow ${c.unreadCount > 0 ? 'unread' : ''}`}
            key={c.id}
          >
            <div className="stack" style={{ gap: 4 }}>
              <div className="title">
                {c.channel === 'library' ? '💬' : (PLATFORM_ICON[c.platform] ?? '•')} {c.title}
              </div>
              <div className="row small">
                <span className={`status ${c.status}`}>{c.status}</span>
                {c.category && <span className="tag">{c.category}</span>}
                {c.tags.slice(0, 4).map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
              <span className="small muted">{when(c.lastMessageAt ?? c.createdAt)}</span>
              {c.unreadCount > 0 && <span className="badge">{c.unreadCount}</span>}
            </div>
          </Link>
        ))}
      </div>
      <button
        type="button"
        className="fab"
        title="Share something"
        onClick={() => navigate('/compose')}
      >
        +
      </button>
    </div>
  );
}
