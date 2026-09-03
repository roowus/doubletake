import type { ChatSummary } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { Link, navigate } from '../router';

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
  const [tag, setTag] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api
      .chats(q.trim() || undefined)
      .then((c) => {
        setChats(c);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the query changes
  useEffect(() => {
    load();
  }, [q]);
  useLive((e) => {
    if (e.kind === 'chat_updated' || (e.kind === 'run_event' && e.type === 'done')) load();
  });

  const tags = [...new Set((chats ?? []).flatMap((c) => c.tags))].sort();
  const shown = (chats ?? []).filter((c) => !tag || c.tags.includes(tag));

  return (
    <div className="page stack">
      <div className="row">
        <input
          placeholder="Search everything you shared…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
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
                {PLATFORM_ICON[c.platform] ?? '•'} {c.title}
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
