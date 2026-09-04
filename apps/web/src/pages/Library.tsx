import type { CollectionDto, EntityHit, EntityKind } from '@doubletake/shared';
import { Fragment, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Icon } from '../components/Icon';
import { ago } from '../format';
import { useLive } from '../live';
import { Link } from '../router';

/** Per-kind title, empty-state and the attribute keys worth surfacing on a card. */
const KINDS: Record<EntityKind, { title: string; empty: string; attrs: string[] }> = {
  place: {
    title: 'Places to visit',
    empty: 'No places yet.',
    attrs: ['city', 'country', 'address', 'type', 'price'],
  },
  recipe: {
    title: 'Recipes',
    empty: 'No recipes yet.',
    attrs: ['cuisine', 'time', 'servings', 'ingredients'],
  },
  product: {
    title: 'Products mentioned',
    empty: 'No products yet.',
    attrs: ['brand', 'price', 'category'],
  },
  tool: {
    title: 'Tools',
    empty: 'No tools yet.',
    attrs: ['install', 'language', 'platform', 'license'],
  },
  tip: { title: 'Tips', empty: 'No tips yet.', attrs: ['topic', 'summary'] },
  media: { title: 'Media', empty: 'No media yet.', attrs: ['creator', 'type', 'year'] },
  person: { title: 'People', empty: 'No people yet.', attrs: ['role', 'handle', 'known_for'] },
  event: { title: 'Events', empty: 'No events yet.', attrs: ['date', 'location', 'price'] },
  other: { title: 'Other things', empty: 'Nothing here yet.', attrs: [] },
};

export const ENTITY_KINDS = Object.keys(KINDS) as EntityKind[];

function attrText(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(attrText).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Places get a Maps link even when the model gave no URL. */
export function mapsUrl(hit: EntityHit): string | null {
  if (hit.kind !== 'place') return null;
  const a = hit.attributes;
  const explicit = a.maps_url ?? a.map_url ?? a.google_maps;
  if (typeof explicit === 'string' && explicit.startsWith('http')) return explicit;
  const q = [hit.name, a.city, a.country].map(attrText).filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function EntityCard({ hit }: { hit: EntityHit }) {
  const spec = KINDS[hit.kind];
  const shown = spec.attrs
    .map((k) => [k, attrText(hit.attributes[k])] as const)
    .filter(([, v]) => v.length > 0);
  const extra = Object.entries(hit.attributes)
    .filter(([k, v]) => !spec.attrs.includes(k) && attrText(v).length > 0)
    .slice(0, 3);
  const maps = mapsUrl(hit);
  return (
    <article className="card stack tight entity">
      <div className="row top">
        <span className="name clamp-2">{hit.name}</span>
        <span className="links">
          {hit.url && (
            <a
              href={hit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-link"
              aria-label={`Open link for ${hit.name}`}
              title="Open link"
            >
              <Icon name="external-link" />
            </a>
          )}
          {maps && (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-link"
              aria-label={`Open ${hit.name} in maps`}
              title="Open in maps"
            >
              <Icon name="map-pin" />
            </a>
          )}
        </span>
      </div>
      {shown.length + extra.length > 0 && (
        <dl className="kv">
          {[...shown, ...extra].map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k.replace(/_/g, ' ')}</dt>
              <dd>{attrText(v)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <div className="foot">
        <Link to={`/chat/${hit.chatId}`} className="truncate">
          {hit.itemTitle}
        </Link>
        <span>·</span>
        <span>{hit.platform}</span>
        <span>·</span>
        <time dateTime={hit.createdAt}>{ago(hit.createdAt)}</time>
      </div>
    </article>
  );
}

export function Entities({ kind }: { kind: EntityKind }) {
  const [hits, setHits] = useState<EntityHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const load = () => {
    api
      .entities(kind)
      .then((h) => {
        setHits(h);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  };
  useEffect(load, [kind]);
  useLive((e) => {
    if (e.kind === 'chat_updated') load();
  });
  const spec = KINDS[kind];
  const f = filter.trim().toLowerCase();
  const shown = (hits ?? []).filter(
    (h) => !f || h.name.toLowerCase().includes(f) || h.itemTitle.toLowerCase().includes(f),
  );
  return (
    <div className="page stack loose">
      <div className="page-head">
        <Link to="/" className="icon-link" aria-label="Back to chats">
          <Icon name="arrow-left" />
        </Link>
        <h2>{spec.title}</h2>
        {kind === 'place' && (
          <Link to="/map" className="icon-link" aria-label="Map view" title="Map view">
            <Icon name="map" />
          </Link>
        )}
      </div>
      <nav className="chips scroll" aria-label="Kinds">
        {ENTITY_KINDS.map((k) => (
          <Link
            key={k}
            to={`/entities/${k}`}
            className="chip"
            aria-current={k === kind ? 'page' : undefined}
          >
            {KINDS[k].title}
          </Link>
        ))}
      </nav>
      <label className="field">
        <span className="sr-only">Filter {spec.title.toLowerCase()}</span>
        <input
          type="search"
          placeholder={`Filter ${spec.title.toLowerCase()}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
      {!hits && !err && (
        <div className="muted small" aria-busy="true">
          Loading…
        </div>
      )}
      {hits && shown.length === 0 && (
        <div className="card quiet empty">
          <Icon name="inbox" className="icon-lg" />
          <p>{spec.empty}</p>
        </div>
      )}
      <div className="entities">
        {shown.map((h) => (
          <EntityCard hit={h} key={`${h.chatId}:${h.name}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Collections chip row for the chat list: auto (by category / entity kind), manual lists and
 * saved searches. Selecting one filters the list server-side (`?collection=<id>`).
 */
export function CollectionBar({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [cols, setCols] = useState<CollectionDto[]>([]);
  const [creating, setCreating] = useState<null | 'manual' | 'search'>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    api
      .collections()
      .then(setCols)
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

  const cur = cols.find((c) => c.id === selected);

  async function create() {
    try {
      const c = await api.createCollection(
        name.trim(),
        creating === 'search' ? query.trim() : undefined,
      );
      setCreating(null);
      setName('');
      setQuery('');
      load();
      onSelect(c.id);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  const [shared, setShared] = useState<string | null>(null);
  async function share(c: CollectionDto) {
    try {
      if (c.shareUrl) {
        await api.unshareCollection(c.id);
        setShared(null);
      } else {
        const r = await api.shareCollection(c.id);
        setShared(r.shareUrl);
        try {
          await navigator.clipboard.writeText(r.shareUrl);
        } catch {
          // clipboard needs a secure context; the link is shown below anyway
        }
      }
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  async function hide(c: CollectionDto) {
    try {
      if (c.auto) await api.updateCollection(c.id, { hidden: true });
      else if (confirm(`Delete collection "${c.name}"? Items stay in your library.`))
        await api.deleteCollection(c.id);
      else return;
      if (selected === c.id) onSelect(null);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }

  return (
    <div className="stack tight">
      <fieldset className="chips scroll">
        <legend className="sr-only">Collections</legend>
        {cols.map((c) => (
          <button
            type="button"
            key={c.id}
            className="chip"
            aria-pressed={selected === c.id}
            title={c.manual ? 'Manual list' : c.query}
            onClick={() => onSelect(selected === c.id ? null : c.id)}
          >
            {c.manual ? (
              <Icon name="list" size={16} />
            ) : c.auto ? null : (
              <Icon name="bookmark-search" size={16} />
            )}
            {c.name}
            <span className="count">{c.count}</span>
            {c.shareUrl && <Icon name="link" size={14} label="Shared read-only link" />}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          aria-expanded={creating !== null}
          onClick={() => setCreating(creating ? null : 'manual')}
        >
          <Icon name="plus" size={16} />
          Collection
        </button>
        {cur && !cur.auto && (
          <button
            type="button"
            className="chip"
            onClick={() => share(cur)}
            title={cur.shareUrl ? 'Revoke the read-only link' : 'Create a read-only link'}
          >
            <Icon name="share" size={16} />
            {cur.shareUrl ? 'Unshare' : 'Share'}
          </button>
        )}
        {cur && (
          <button
            type="button"
            className="chip"
            onClick={() => hide(cur)}
            title={cur.auto ? 'Hide this collection' : 'Delete this collection'}
          >
            <Icon name={cur.auto ? 'x' : 'trash'} size={16} />
            {cur.auto ? 'Hide' : 'Delete'}
          </button>
        )}
      </fieldset>
      {cur?.shareUrl && (
        <p className="small muted truncate">
          Shared read-only{shared === cur.shareUrl ? ' (link copied)' : ''}:{' '}
          <a href={cur.shareUrl} target="_blank" rel="noreferrer">
            {cur.shareUrl}
          </a>
        </p>
      )}
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
    </div>
  );
}

/** Add-to / remove-from manual collections for one chat (used in the chat header). */
export function CollectionPicker({ chatId }: { chatId: string }) {
  const [cols, setCols] = useState<CollectionDto[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    Promise.all([api.collections(true), api.chatCollections(chatId)])
      .then(([c, m]) => {
        setCols(c.filter((x) => x.manual));
        setMine(m.collectionIds);
      })
      .catch(() => {});
  };
  useEffect(load, [chatId]);
  async function toggle(c: CollectionDto) {
    try {
      if (mine.includes(c.id)) await api.removeFromCollection(c.id, chatId);
      else await api.addToCollection(c.id, chatId);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  async function createAndAdd(name: string) {
    try {
      const c = await api.createCollection(name);
      await api.addToCollection(c.id, chatId);
      load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  const inNames = cols.filter((c) => mine.includes(c.id)).map((c) => c.name);
  return (
    <div className="stack tight">
      <div className="row">
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="list" size={16} />
          <span className="truncate">
            {inNames.length ? inNames.join(', ') : 'Add to collection'}
          </span>
        </button>
      </div>
      {open && (
        <div className="chips">
          {cols.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`chip ${mine.includes(c.id) ? 'on' : ''}`}
              onClick={() => toggle(c)}
            >
              {c.name}
            </button>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement;
              if (input.value.trim()) {
                void createAndAdd(input.value.trim());
                input.value = '';
              }
            }}
          >
            <input
              name="name"
              className="tag-input"
              placeholder="New list…"
              aria-label="New collection name"
              maxLength={60}
            />
          </form>
        </div>
      )}
      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}
