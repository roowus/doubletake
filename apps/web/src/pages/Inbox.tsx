import type { ChatSummary, CollectionDto, TagDto } from '@doubletake/shared';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon, type IconName, platformIcon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ListSkeleton } from '../components/Skeleton';
import { ago } from '../format';
import { useLive } from '../live';
import { Link, navigate } from '../router';

const PLATFORMS: { id: string; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'x', label: 'X' },
  { id: 'web', label: 'Web' },
  { id: 'aichat', label: 'AI chat' },
  { id: 'text', label: 'Text' },
];

const STATUSES: { id: string; label: string }[] = [
  { id: 'answered', label: 'Answered' },
  { id: 'working', label: 'In progress' },
  { id: 'failed', label: 'Failed or capped' },
];

const STATUS_LABEL: Record<string, string> = {
  new: 'Queued',
  extracting: 'Reading',
  researching: 'Researching',
  answered: 'Answered',
  failed: 'Failed',
  capped: 'Capped',
};

type Filters = {
  tag: string;
  collection: string;
  platform: string;
  status: string;
};

const EMPTY: Filters = { tag: '', collection: '', platform: '', status: '' };

function leadIcon(c: ChatSummary): IconName {
  if (c.channel === 'library') return 'message-square';
  if (c.channel === 'mcp') return 'bot';
  if (c.channel === 'import') return 'inbox';
  return platformIcon(c.platform);
}

function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  return {
    tag: p.get('tag') ?? '',
    collection: p.get('collection') ?? '',
    platform: p.get('platform') ?? '',
    status: p.get('status') ?? '',
  };
}

function matchesStatus(c: ChatSummary, status: string): boolean {
  if (!status) return true;
  if (status === 'answered') return c.status === 'answered';
  if (status === 'failed') return c.status === 'failed' || c.status === 'capped';
  return c.status === 'new' || c.status === 'extracting' || c.status === 'researching';
}

export function Inbox() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sheet, setSheet] = useState(false);

  async function load() {
    try {
      const [list, t, cols] = await Promise.all([
        api.chats(q || undefined, filters.tag || undefined, filters.collection || undefined),
        api.tags(),
        api.collections(),
      ]);
      setChats(list);
      setTags(t);
      setCollections(cols);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load reads the latest state
  useEffect(() => {
    void load();
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `/?${qs}` : '/');
  }, [q, filters.tag, filters.collection]);

  useLive((ev) => {
    if (ev.kind === 'chat_updated' || (ev.kind === 'run_event' && ev.type === 'done')) void load();
  });

  const visible = useMemo(() => {
    if (!chats) return null;
    return chats.filter(
      (c) =>
        (!filters.platform || c.platform === filters.platform) && matchesStatus(c, filters.status),
    );
  }, [chats, filters.platform, filters.status]);

  const unread = visible?.filter((c) => c.unreadCount > 0) ?? [];
  const rest = visible?.filter((c) => c.unreadCount === 0) ?? [];

  const activeCount = Object.values(filters).filter(Boolean).length;
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (filters.collection) {
      parts.push(collections.find((c) => c.id === filters.collection)?.name ?? 'Collection');
    }
    if (filters.tag) parts.push(`#${filters.tag}`);
    if (filters.platform) {
      parts.push(PLATFORMS.find((p) => p.id === filters.platform)?.label ?? filters.platform);
    }
    if (filters.status) parts.push(STATUSES.find((s) => s.id === filters.status)?.label ?? '');
    return parts.filter(Boolean).join(' · ');
  }, [filters, collections]);

  async function ask() {
    if (!q.trim() || asking) return;
    setAsking(true);
    setErr(null);
    try {
      const r = await api.askLibrary(q.trim());
      navigate(`/chat/${r.chatId}`);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setAsking(false);
    }
  }

  const toggle = (k: keyof Filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: f[k] === v ? '' : v }));

  const collectionsShown = collections.filter((c) => c.count > 0 || !c.auto);

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Inbox</h1>
      </div>
      <search className="inbox-search">
        <form
          className="searchbar"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Icon name="search" size={18} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your library"
            aria-label="Search your library"
            enterKeyHint="search"
          />
          {q.trim() && (
            <button type="submit" className="small primary" disabled={asking}>
              <Icon name="compass" size={16} />
              {asking ? 'Asking…' : 'Ask'}
            </button>
          )}
        </form>
        <button
          type="button"
          className={`icon ${activeCount ? 'on' : 'ghost'}`}
          aria-label={activeCount ? `Filters (${activeCount} active)` : 'Filters'}
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
        >
          <Icon name="filter" size={20} />
        </button>
      </search>

      {activeCount > 0 && (
        <div className="filter-summary">
          <button
            type="button"
            className="chip on"
            onClick={() => setFilters(EMPTY)}
            aria-label={`Clear filters: ${summary}`}
          >
            {summary}
            <Icon name="x" size={14} className="x" />
          </button>
          <button type="button" className="ghost small" onClick={() => setSheet(true)}>
            Edit
          </button>
        </div>
      )}

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Filter"
        description={
          activeCount ? `${activeCount} active` : 'Narrow the inbox by where, what and how.'
        }
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setFilters(EMPTY)}>
              Clear all
            </button>
            <button type="button" className="primary" onClick={() => setSheet(false)}>
              Show {visible?.length ?? 0}
            </button>
          </>
        }
      >
        <FilterGroup label="Status">
          {STATUSES.map((s) => (
            <FacetChip
              key={s.id}
              on={filters.status === s.id}
              onClick={() => toggle('status', s.id)}
            >
              {s.label}
            </FacetChip>
          ))}
        </FilterGroup>
        <FilterGroup label="Platform">
          {PLATFORMS.map((p) => (
            <FacetChip
              key={p.id}
              on={filters.platform === p.id}
              onClick={() => toggle('platform', p.id)}
              icon={platformIcon(p.id)}
            >
              {p.label}
            </FacetChip>
          ))}
        </FilterGroup>
        {collectionsShown.length > 0 && (
          <FilterGroup label="Collections">
            {collectionsShown.map((c) => (
              <FacetChip
                key={c.id}
                on={filters.collection === c.id}
                onClick={() => toggle('collection', c.id)}
                count={c.count}
              >
                {c.name}
              </FacetChip>
            ))}
          </FilterGroup>
        )}
        {tags.length > 0 && (
          <FilterGroup label="Tags">
            {tags.map((t) => (
              <FacetChip
                key={t.name}
                on={filters.tag === t.name}
                onClick={() => toggle('tag', t.name)}
                count={t.count}
              >
                #{t.name}
              </FacetChip>
            ))}
          </FilterGroup>
        )}
      </Sheet>

      {err && (
        <div className="banner error" role="alert">
          {err}
        </div>
      )}

      {!visible && !err && <ListSkeleton rows={6} label="Loading your inbox" />}
      {visible && visible.length === 0 && !err && (
        <div className="card quiet empty">
          <Icon name="inbox" size={28} />
          {chats && chats.length > 0 ? (
            <>
              <strong>Nothing matches</strong>
              <span>Loosen the filters or search for something else.</span>
            </>
          ) : q ? (
            <>
              <strong>No saved item mentions that</strong>
              <span>Press Ask to have the library answer it from what you have.</span>
            </>
          ) : (
            <>
              <strong>Nothing here yet</strong>
              <span>Share a link from your phone, or add one from the Add tab.</span>
            </>
          )}
        </div>
      )}

      {unread.length > 0 && (
        <section className="stack tight" aria-label="Unread">
          <h2 className="section-title">Unread · {unread.length}</h2>
          <ChatRows chats={unread} />
        </section>
      )}
      {rest.length > 0 && (
        <section className="stack tight" aria-label={unread.length ? 'Earlier' : 'Chats'}>
          {unread.length > 0 && <h2 className="section-title">Earlier</h2>}
          <ChatRows chats={rest} />
        </section>
      )}
    </div>
  );
}

function ChatRows({ chats }: { chats: ChatSummary[] }) {
  return (
    <div className="chatlist">
      {chats.map((c) => {
        const working =
          c.status === 'new' || c.status === 'extracting' || c.status === 'researching';
        const bad = c.status === 'failed' || c.status === 'capped';
        return (
          <Link
            key={c.id}
            to={`/chat/${c.id}`}
            className={`chatrow${c.unreadCount ? ' unread' : ''}`}
          >
            <span className="lead" aria-hidden="true">
              <Icon name={leadIcon(c)} size={20} />
            </span>
            <span className="body">
              <span className="title clamp-2">{c.title}</span>
              {(working || bad || c.category || c.tags.length > 0) && (
                <span className="meta">
                  {(working || bad) && (
                    <span className={`status ${c.status}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  )}
                  {c.category && <span className="cat">{c.category}</span>}
                  {c.tags.slice(0, 3).map((t) => (
                    <span key={t} className="hash">
                      #{t}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="trail">
              <time dateTime={c.lastMessageAt ?? c.createdAt}>
                {ago(c.lastMessageAt ?? c.createdAt)}
              </time>
              {c.unreadCount > 0 && (
                <span className="badge" title={`${c.unreadCount} unread`}>
                  {c.unreadCount}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="filter-group">
      <legend className="section-title">{label}</legend>
      <div className="chips">{children}</div>
    </fieldset>
  );
}

function FacetChip({
  on,
  onClick,
  icon,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  icon?: IconName;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}
