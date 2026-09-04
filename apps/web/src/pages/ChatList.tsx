import type { ChatSummary, TagDto } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon, type IconName, platformIcon } from '../components/Icon';
import { ago } from '../format';
import { useLive } from '../live';
import { Link, navigate } from '../router';
import { CollectionBar } from './Library';

const TAG_LIMIT = 8;

function leadIcon(c: ChatSummary): IconName {
  if (c.channel === 'library') return 'message-square';
  if (c.channel === 'mcp') return 'bot';
  if (c.channel === 'import') return 'inbox';
  return platformIcon(c.platform);
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
  const [showAllTags, setShowAllTags] = useState(false);

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

  const visibleTags = showAllTags ? tags : tags.slice(0, TAG_LIMIT);

  return (
    <div className="page stack loose">
      <search>
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search your items or ask a question"
            placeholder="Search or ask your library…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim() && (
            <button
              type="submit"
              className="primary small"
              disabled={asking}
              title="Answer this question from your saved chats"
            >
              <Icon name="sparkles" size={16} />
              {asking ? 'Asking…' : 'Ask'}
            </button>
          )}
        </form>
      </search>
      <div className="filters">
        <CollectionBar selected={collection} onSelect={setCollection} />
        <nav className="chips scroll" aria-label="Browse by kind">
          <Link to="/entities/place" className="chip">
            <Icon name="map-pin" size={16} />
            Places
          </Link>
          <Link to="/map" className="chip">
            <Icon name="map" size={16} />
            Map
          </Link>
          <Link to="/entities/recipe" className="chip">
            <Icon name="utensils" size={16} />
            Recipes
          </Link>
          <Link to="/entities/product" className="chip">
            <Icon name="shopping-bag" size={16} />
            Products
          </Link>
          <Link to="/entities/tool" className="chip">
            <Icon name="wrench" size={16} />
            Tools
          </Link>
          <Link to="/entities/tip" className="chip">
            <Icon name="lightbulb" size={16} />
            Tips
          </Link>
        </nav>
        {tags.length > 0 && (
          <fieldset className="chips">
            <legend className="sr-only">Filter by tag</legend>
            {visibleTags.map((t) => (
              <button
                type="button"
                key={t}
                className={`chip ${tag === t ? 'on' : ''}`}
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {allTags.find((x) => x.name === t)?.kind === 'manual' && (
                  <Icon name="pencil" size={14} />
                )}
                {t}
              </button>
            ))}
            {tags.length > TAG_LIMIT && (
              <button
                type="button"
                className="chip"
                aria-expanded={showAllTags}
                onClick={() => setShowAllTags((v) => !v)}
              >
                {showAllTags ? 'Show fewer' : `Show all ${tags.length}`}
                <Icon name={showAllTags ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
            )}
          </fieldset>
        )}
      </div>
      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
      {chats && chats.length === 0 && (
        <div className="card quiet empty">
          <Icon name="inbox" className="icon-lg" size={40} />
          <p>Nothing here yet.</p>
          <p className="small">Share a link from your phone, or add one with the + button.</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="chatlist">
          {shown.map((c) => (
            <Link
              to={`/chat/${c.id}`}
              className={`chatrow ${c.unreadCount > 0 ? 'unread' : ''}`}
              key={c.id}
            >
              <span className="lead">
                <Icon name={leadIcon(c)} size={22} />
              </span>
              <div>
                <div className="title clamp-2">{c.title}</div>
                <div className="meta">
                  <span className={`status ${c.status}`}>{c.status}</span>
                  {c.category && <span className="tag">{c.category}</span>}
                  {c.tags.slice(0, 3).map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="trail">
                <time dateTime={c.lastMessageAt ?? c.createdAt}>
                  {ago(c.lastMessageAt ?? c.createdAt)}
                </time>
                {c.unreadCount > 0 && (
                  <span className="badge">
                    {c.unreadCount}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <button
        type="button"
        className="fab"
        aria-label="New item"
        onClick={() => navigate('/compose')}
      >
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}
