/**
 * Collections (docs/DATA-MODEL.md §tags / collections). A collection is a saved query:
 *   category:<c>   items whose run classified them as that category
 *   entity:<kind>  items with at least one extracted entity of that kind
 *   tag:<name>     items carrying that tag
 *   <free text>    an FTS search
 * `manual` collections list items explicitly via `collection_items` instead.
 * Auto collections (one per category, one per entity kind) are seeded at boot and can only be
 * hidden, never deleted.
 */

import { Category, EntityKind } from '@doubletake/shared';
import { ftsQuery } from '../api/fts.js';
import type { Repo } from '../db/repo.js';

export interface CollectionDto {
  id: string;
  name: string;
  query: string;
  manual: boolean;
  auto: boolean;
  hidden: boolean;
  count: number;
}

const CATEGORY_NAMES: Record<Category, string> = {
  place: 'Places',
  food: 'Food',
  product: 'Products',
  tech: 'Tech',
  skill: 'Skills',
  health: 'Health',
  travel: 'Travel',
  finance: 'Finance',
  entertainment: 'Entertainment',
  news: 'News',
  other: 'Other',
};

const ENTITY_NAMES: Record<EntityKind, string> = {
  place: 'Places to visit',
  recipe: 'Recipes',
  product: 'Products mentioned',
  tool: 'Tools',
  tip: 'Tips',
  media: 'Media',
  person: 'People',
  event: 'Events',
  other: 'Other things',
};

/** Idempotent: inserts the auto collections that do not exist yet. Returns how many were added. */
export function seedAutoCollections(repo: Repo): number {
  let added = 0;
  for (const c of Category.options) {
    const query = `category:${c}`;
    if (!repo.findCollectionByQuery(query)) {
      repo.createCollection({ name: CATEGORY_NAMES[c], query, manual: false, auto: true });
      added++;
    }
  }
  for (const k of EntityKind.options) {
    const query = `entity:${k}`;
    if (!repo.findCollectionByQuery(query)) {
      repo.createCollection({ name: ENTITY_NAMES[k], query, manual: false, auto: true });
      added++;
    }
  }
  return added;
}

/** Item ids matching a collection, in no particular order (the caller keeps chat-list order). */
export function resolveCollection(
  repo: Repo,
  c: { id: string; query: string; manual: boolean },
): Set<string> {
  if (c.manual) return new Set(repo.collectionItemIds(c.id));
  return new Set(resolveQuery(repo, c.query));
}

export function resolveQuery(repo: Repo, query: string): string[] {
  const q = query.trim();
  const m = q.match(/^(category|entity|tag):(.+)$/);
  if (m?.[1] && m[2] !== undefined) {
    const arg = m[2].trim().toLowerCase();
    if (m[1] === 'category') return repo.itemIdsByCategory(arg);
    if (m[1] === 'entity') return repo.itemIdsByEntityKind(arg);
    return repo.itemIdsByTag(arg);
  }
  if (!q) return [];
  return repo.searchFts(ftsQuery(q), 500);
}

export function listCollections(
  repo: Repo,
  includeHidden: boolean,
  onlyNonEmpty: boolean,
): CollectionDto[] {
  const out: CollectionDto[] = [];
  for (const c of repo.listCollections(includeHidden)) {
    const count = resolveCollection(repo, c).size;
    if (onlyNonEmpty && c.auto && count === 0) continue;
    out.push({ ...c, count });
  }
  // Manual first (owner-made), then auto by count desc, then name.
  return out.sort((a, b) =>
    a.manual !== b.manual ? (a.manual ? -1 : 1) : b.count - a.count || a.name.localeCompare(b.name),
  );
}
