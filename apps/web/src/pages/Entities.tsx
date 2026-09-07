import type { CollectionDto, EntityHit, EntityKind } from '@doubletake/shared';
import { Fragment, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Icon, platformIcon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeleton';
import { ago } from '../format';
import { useLive } from '../live';
import { Link } from '../router';

/** Per-kind title, empty-state and the attribute keys worth surfacing on a card. */
const KINDS: Record<EntityKind, { title: string; empty: string; attrs: string[] }> = {
  place: {
    title: 'Places to visit',
    empty: 'No places yet. Research a post about somewhere and it lands here.',
    attrs: ['city', 'country', 'address', 'type', 'price'],
  },
  recipe: {
    title: 'Recipes',
    empty: 'No recipes yet. Share a cooking video or a recipe page to start the list.',
    attrs: ['cuisine', 'time', 'servings', 'ingredients'],
  },
  product: {
    title: 'Products mentioned',
    empty: 'No products yet. Anything an answer names and prices shows up here.',
    attrs: ['brand', 'price', 'category'],
  },
  tool: {
    title: 'Tools',
    empty: 'No tools yet. Share a repo, an app or a how-to and the tools it uses appear here.',
    attrs: ['install', 'language', 'platform', 'license'],
  },
  tip: {
    title: 'Tips',
    empty: 'No tips yet. Practical advice pulled from answers collects here.',
    attrs: ['topic', 'summary'],
  },
  media: {
    title: 'Media',
    empty: 'No media yet. Books, films, podcasts and albums that answers mention go here.',
    attrs: ['creator', 'type', 'year'],
  },
  person: {
    title: 'People',
    empty: 'No people yet. Creators and names worth remembering collect here.',
    attrs: ['role', 'handle', 'known_for'],
  },
  event: {
    title: 'Events',
    empty: 'No events yet. Dated things from your answers collect here.',
    attrs: ['date', 'location', 'price'],
  },
  other: {
    title: 'Other things',
    empty: 'Nothing here yet. Things that fit no other kind land here.',
    attrs: [],
  },
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
        <Icon name={platformIcon(hit.platform)} size={14} />
        <Link to={`/chat/${hit.chatId}`} className="truncate">
          {hit.itemTitle}
        </Link>
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
    <div className="page stack loose entities-page">
      <div className="page-head">
        <Link to="/library" className="icon-link" aria-label="Back to Library">
          <Icon name="arrow-left" />
        </Link>
        <h1>
          {spec.title}
          {hits && <span className="count-badge">{hits.length}</span>}
        </h1>
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
      <div className="searchbar">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder={`Filter ${spec.title.toLowerCase()}`}
          aria-label={`Filter ${spec.title.toLowerCase()}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {err && (
        <div className="banner error" role="alert">
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
      {!hits && !err && <ListSkeleton rows={5} label={`Loading ${spec.title.toLowerCase()}`} />}
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
