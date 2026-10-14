/**
 * Collections (docs/DATA-MODEL.md §tags / collections). A collection is a saved query:
 *   category:<c>   items whose run classified them as that category
 *   entity:<kind>  items with at least one extracted entity of that kind
 *   tag:<name>     items carrying that tag
 *   <free text>    an FTS search
 * `manual` collections list items explicitly via `collection_items` instead.
 * Auto collections (one per category, one per entity kind) are seeded at boot and can only be
 * hidden, never deleted.
 *
 * Every function here is async: they read through `Repo`, whose pg dialect returns lazily-awaited
 * values behind synchronous signatures (dialect contract at the top of `db/repo.ts`, ADR 0032).
 * On SQLite the same calls are plain values and `await` is a no-op, so self-hosted behaviour is
 * unchanged.
 */

import { Category, EntityKind } from '@doubletake/shared';
import { ftsQuery } from '../api/fts.js';
import type { Repo, TenantCtx } from '../db/repo.js';

export interface CollectionDto {
  id: string;
  name: string;
  query: string;
  manual: boolean;
  auto: boolean;
  hidden: boolean;
  count: number;
  /** Public read-only page URL when shared (ADR 0025), else null. */
  shareUrl: string | null;
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
export async function seedAutoCollections(
  repo: Repo,
  ctx?: TenantCtx | undefined,
): Promise<number> {
  let added = 0;
  for (const c of Category.options) {
    const query = `category:${c}`;
    if (!(await repo.findCollectionByQuery(query, ctx))) {
      repo.createCollection({ name: CATEGORY_NAMES[c], query, manual: false, auto: true }, ctx);
      added++;
    }
  }
  for (const k of EntityKind.options) {
    const query = `entity:${k}`;
    if (!(await repo.findCollectionByQuery(query, ctx))) {
      repo.createCollection({ name: ENTITY_NAMES[k], query, manual: false, auto: true }, ctx);
      added++;
    }
  }
  return added;
}

/** Item ids matching a collection, in no particular order (the caller keeps chat-list order). */
export async function resolveCollection(
  repo: Repo,
  c: { id: string; query: string; manual: boolean },
  ctx?: TenantCtx | undefined,
): Promise<Set<string>> {
  if (c.manual) return new Set(await repo.collectionItemIds(c.id, ctx));
  return new Set(await resolveQuery(repo, c.query, ctx));
}

export async function resolveQuery(
  repo: Repo,
  query: string,
  ctx?: TenantCtx | undefined,
): Promise<string[]> {
  const q = query.trim();
  const m = q.match(/^(category|entity|tag):(.+)$/);
  if (m?.[1] && m[2] !== undefined) {
    const arg = m[2].trim().toLowerCase();
    if (m[1] === 'category') return await repo.itemIdsByCategory(arg, ctx);
    if (m[1] === 'entity') return await repo.itemIdsByEntityKind(arg, ctx);
    return await repo.itemIdsByTag(arg, ctx);
  }
  if (!q) return [];
  return await repo.searchFts(ftsQuery(q), 500, ctx);
}

export async function listCollections(
  repo: Repo,
  includeHidden: boolean,
  onlyNonEmpty: boolean,
  /** Turns a share token into the public page URL (ADR 0025); omit → `shareUrl: null`. */
  toShareUrl?: (token: string) => string,
  ctx?: TenantCtx | undefined,
): Promise<CollectionDto[]> {
  const out: CollectionDto[] = [];
  for (const { shareToken, ...c } of await repo.listCollections(includeHidden, ctx)) {
    const count = (await resolveCollection(repo, c, ctx)).size;
    if (onlyNonEmpty && c.auto && count === 0) continue;
    out.push({ ...c, count, shareUrl: shareToken && toShareUrl ? toShareUrl(shareToken) : null });
  }
  // Manual first (owner-made), then auto by count desc, then name.
  return out.sort((a, b) =>
    a.manual !== b.manual ? (a.manual ? -1 : 1) : b.count - a.count || a.name.localeCompare(b.name),
  );
}
