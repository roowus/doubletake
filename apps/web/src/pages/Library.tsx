import type { CollectionDto, EntityKind, TagDto } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Confirm } from '../components/Confirm';
import { Icon, type IconName } from '../components/Icon';
import { Menu } from '../components/Menu';
import { ListSkeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { useLive } from '../live';
import { Link } from '../router';

/**
 * Library tab: where the chip rows of the old list went. Collections as tiles, entity kinds
 * as tiles with counts (taken from the seeded `entity:<kind>` auto collections, so no extra
 * requests), the map, then every tag in use. Tapping a tile opens the same filtered views as
 * before (`/?collection=`, `/entities/<kind>`, `/?tag=`).
 */

const KIND_TILES: { kind: EntityKind; label: string; icon: IconName }[] = [
  { kind: 'place', label: 'Places', icon: 'map-pin' },
  { kind: 'recipe', label: 'Recipes', icon: 'utensils' },
  { kind: 'product', label: 'Products', icon: 'shopping-bag' },
  { kind: 'tool', label: 'Tools', icon: 'wrench' },
  { kind: 'tip', label: 'Tips', icon: 'lightbulb' },
  { kind: 'media', label: 'Media', icon: 'film' },
  { kind: 'person', label: 'People', icon: 'user' },
  { kind: 'event', label: 'Events', icon: 'calendar' },
];

export function Library() {
  const [cols, setCols] = useState<CollectionDto[] | null>(null);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | 'manual' | 'search'>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<CollectionDto | null>(null);

  const load = () => {
    api
      .collections()
      .then((c) => {
        setCols(c);
        setErr(null);
      })
      .catch((e) => setErr(String(e.message ?? e)));
    api
      .tags()
      .then(setTags)
      .catch(() => {});
  };
  useEffect(load, []);
  useLive((e) => {
    if (e.kind === 'chat_updated') load();
  });
  useEffect(() => {
    if (creating !== 'search' || !query.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .previewCollection(query.trim())
        .then((r) => setPreview(r.count))
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [creating, query]);

  async function create() {
    try {
      await api.createCollection(name.trim(), creating === 'search' ? query.trim() : undefined);
      setCreating(null);
      setName('');
      setQuery('');
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }

  async function share(c: CollectionDto) {
    try {
      if (c.shareUrl) {
        await api.unshareCollection(c.id);
        toast(`"${c.name}" is private again`);
      } else {
        const r = await api.shareCollection(c.id);
        let copied = false;
        try {
          await navigator.clipboard.writeText(r.shareUrl);
          copied = true;
        } catch {
          // clipboard needs a secure context; the link is shown in the toast anyway
        }
        toast(copied ? 'Link copied' : 'Read-only link', r.shareUrl);
      }
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  async function hide(c: CollectionDto) {
    try {
      await api.updateCollection(c.id, { hidden: true });
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  async function remove(c: CollectionDto) {
    try {
      await api.deleteCollection(c.id);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }

  const all = cols ?? [];
  const entityCount = (kind: EntityKind) =>
    all.find((c) => c.query === `entity:${kind}`)?.count ?? 0;
  // Manual lists and saved searches first (they are the owner's), then categories.
  const yours = all.filter((c) => !c.auto);
  const categories = all.filter((c) => c.auto && c.query.startsWith('category:') && c.count > 0);

  return (
    <div className="page stack loose">
      <header className="page-head">
        <h1>Library</h1>
        <button
          type="button"
          className="ghost"
          aria-expanded={creating !== null}
          onClick={() => setCreating(creating ? null : 'manual')}
        >
          <Icon name="plus" size={18} />
          New collection
        </button>
      </header>

      {creating && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && (creating === 'manual' || query.trim())) void create();
          }}
        >
          <label className="field">
            <span className="label">Type</span>
            <select
              value={creating}
              onChange={(e) => setCreating(e.target.value as 'manual' | 'search')}
            >
              <option value="manual">Manual list</option>
              <option value="search">Saved search</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          {creating === 'search' && (
            <label className="field">
              <span className="label">Query</span>
              <input
                placeholder="words, or tag:x / category:x / entity:x"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="help">
                {preview != null
                  ? `${preview} matching item${preview === 1 ? '' : 's'}`
                  : 'Matches update as you type.'}
              </span>
            </label>
          )}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => setCreating(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Create
            </button>
          </div>
        </form>
      )}

      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}

      <section className="stack tight" aria-labelledby="lib-things">
        <h2 id="lib-things" className="section-title">
          Things
        </h2>
        <ul className="tiles">
          {KIND_TILES.map((t) => (
            <li key={t.kind}>
              <Link to={`/entities/${t.kind}`} className="tile">
                <Icon name={t.icon} size={22} />
                <span className="tile-label">{t.label}</span>
                <span className="tile-count">{entityCount(t.kind)}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link to="/map" className="tile">
              <Icon name="map" size={22} />
              <span className="tile-label">Map</span>
              <span className="tile-count">{entityCount('place')}</span>
            </Link>
          </li>
        </ul>
      </section>

      <section className="stack tight" aria-labelledby="lib-collections">
        <h2 id="lib-collections" className="section-title">
          Collections
        </h2>
        {!cols ? (
          <ListSkeleton rows={3} label="Loading collections" />
        ) : yours.length === 0 && categories.length === 0 ? (
          <p className="muted">
            Collections group items. Categories appear here as items are researched; make your own
            list or saved search with <strong>New collection</strong>.
          </p>
        ) : (
          <ul className="tiles">
            {yours.map((c) => (
              <li key={c.id} className="tile-wrap">
                <Link
                  to={`/?collection=${c.id}`}
                  className="tile"
                  title={c.manual ? 'Manual list' : c.query}
                >
                  <Icon name={c.manual ? 'list' : 'bookmark-search'} size={22} />
                  <span className="tile-label">{c.name}</span>
                  <span className="tile-count">
                    {c.count}
                    {c.shareUrl && <Icon name="link" size={14} label="Shared read-only link" />}
                  </span>
                </Link>
                <Menu
                  label={`Options for ${c.name}`}
                  className="ghost icon tile-menu"
                  trigger={<Icon name="more-vertical" size={18} />}
                  items={[
                    {
                      label: c.shareUrl ? 'Stop sharing' : 'Share read-only link',
                      icon: c.shareUrl ? 'x' : 'share',
                      onSelect: () => void share(c),
                    },
                    'separator',
                    {
                      label: 'Delete collection',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => setToDelete(c),
                    },
                  ]}
                />
              </li>
            ))}
            {categories.map((c) => (
              <li key={c.id} className="tile-wrap">
                <Link to={`/?collection=${c.id}`} className="tile" title={c.query}>
                  <Icon name="folder" size={22} />
                  <span className="tile-label">{c.name}</span>
                  <span className="tile-count">{c.count}</span>
                </Link>
                <Menu
                  label={`Options for ${c.name}`}
                  className="ghost icon tile-menu"
                  trigger={<Icon name="more-vertical" size={18} />}
                  items={[{ label: 'Hide from Library', icon: 'x', onSelect: () => void hide(c) }]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Confirm
        open={toDelete !== null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title={`Delete "${toDelete?.name ?? ''}"?`}
        body="Items stay in your library; only the collection goes away."
        action="Delete"
        onConfirm={() => (toDelete ? remove(toDelete) : undefined)}
      />

      <section className="stack tight" aria-labelledby="lib-tags">
        <h2 id="lib-tags" className="section-title">
          Tags
        </h2>
        {tags.length === 0 ? (
          <p className="muted">Tags arrive with each answer; add your own from a chat's header.</p>
        ) : (
          <ul className="taglist">
            {tags.map((t) => (
              <li key={t.name}>
                <Link to={`/?tag=${encodeURIComponent(t.name)}`} className="taglist-row">
                  <Icon name="tag" size={16} />
                  <span className="taglist-name">{t.name}</span>
                  <span className="taglist-count">{t.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
