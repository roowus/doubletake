import type { CollectionDto, EntityHit, EntityKind } from '@doubletake/shared';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
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
    <div className="card stack entity" style={{ gap: 6 }}>
      <div className="row">
        <b style={{ flex: 1 }}>{hit.name}</b>
        {hit.url && (
          <a href={hit.url} target="_blank" rel="noopener noreferrer" className="small">
            link ↗
          </a>
        )}
        {maps && (
          <a href={maps} target="_blank" rel="noopener noreferrer" className="small">
            map ↗
          </a>
        )}
      </div>
      {[...shown, ...extra].map(([k, v]) => (
        <div className="small" key={k}>
          <span className="muted">{k.replace(/_/g, ' ')}: </span>
          {attrText(v)}
        </div>
      ))}
      <div className="row small muted">
        <Link to={`/chat/${hit.chatId}`}>from: {hit.itemTitle}</Link>
        <span>{hit.platform}</span>
        <span>{new Date(hit.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
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
    <div className="page stack">
      <div className="chips">
        {ENTITY_KINDS.map((k) => (
          <Link key={k} to={`/entities/${k}`} className={`chip ${k === kind ? 'on' : ''}`}>
            {KINDS[k].title}
          </Link>
        ))}
      </div>
      <div className="row">
        <h3 style={{ margin: 0, flex: 1 }}>{spec.title}</h3>
        {kind === 'place' && (
          <Link to="/map" className="small">
            map view
          </Link>
        )}
        <input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 200 }}
        />
      </div>
      {err && <div className="msg error">{err}</div>}
      {hits && shown.length === 0 && <div className="card muted">{spec.empty}</div>}
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
    <div className="stack" style={{ gap: 6 }}>
      <div className="chips">
        {cols.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`chip ${selected === c.id ? 'on' : ''}`}
            title={c.manual ? 'Manual list' : c.query}
            onClick={() => onSelect(selected === c.id ? null : c.id)}
          >
            {c.manual ? '☰ ' : c.auto ? '' : '🔍 '}
            {c.name} <span className="muted">{c.count}</span>
            {c.shareUrl && <span title="Shared read-only link">🔗</span>}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => setCreating(creating ? null : 'manual')}
        >
          + collection
        </button>
        {cur && !cur.auto && (
          <button
            type="button"
            className="chip"
            onClick={() => share(cur)}
            title={cur.shareUrl ? 'Revoke the read-only link' : 'Create a read-only link'}
          >
            {cur.shareUrl ? 'unshare' : 'share'}
          </button>
        )}
        {cur && (
          <button type="button" className="chip" onClick={() => hide(cur)} title="Hide or delete">
            {cur.auto ? 'hide' : 'delete'} “{cur.name}”
          </button>
        )}
      </div>
      {cur?.shareUrl && (
        <div className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>
          Shared read-only{shared === cur.shareUrl ? ' (link copied)' : ''}:{' '}
          <a href={cur.shareUrl} target="_blank" rel="noreferrer">
            {cur.shareUrl}
          </a>
        </div>
      )}
      {creating && (
        <form
          className="row card"
          style={{ gap: 6, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && (creating === 'manual' || query.trim())) void create();
          }}
        >
          <select
            value={creating}
            onChange={(e) => setCreating(e.target.value as 'manual' | 'search')}
          >
            <option value="manual">Manual list</option>
            <option value="search">Saved search</option>
          </select>
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            style={{ flex: 1, minWidth: 120 }}
          />
          {creating === 'search' && (
            <input
              placeholder="query — words, or tag:x / category:x / entity:x"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 2, minWidth: 200 }}
            />
          )}
          {preview != null && <span className="small muted">{preview} match</span>}
          <button type="submit" className="primary">
            Create
          </button>
          <button type="button" className="ghost" onClick={() => setCreating(null)}>
            Cancel
          </button>
        </form>
      )}
      {err && <div className="msg error">{err}</div>}
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
    <div className="stack" style={{ gap: 4 }}>
      <div className="row small">
        <button type="button" className="chip" onClick={() => setOpen(!open)}>
          ☰ {inNames.length ? inNames.join(', ') : 'Add to collection'}
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
            <input name="name" className="tag-input" placeholder="new list…" maxLength={60} />
          </form>
        </div>
      )}
      {err && <div className="msg error">{err}</div>}
    </div>
  );
}
