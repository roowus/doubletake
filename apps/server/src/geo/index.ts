/**
 * Place geocoding for the map view (ADR 0022).
 *
 * A place entity gets coordinates in one of two ways: the brain already put `lat`/`lon` into its
 * attributes, or we ask a Nominatim-compatible `/search` endpoint for the entity's name plus its
 * city/region/country attributes. Results, including misses, are cached in `place_geo` keyed by
 * the query string, so a place is looked up once per distinct wording and never on a hot path.
 */

import type { EntityGeo } from '@doubletake/shared';
import type { Config } from '../config/index.js';
import type { Repo } from '../db/repo.js';

const USER_AGENT = 'Doubletake/0.1 (+https://github.com/roowus/doubletake)';
/** Public Nominatim allows one request per second; self-hosted instances ignore the pause. */
const PUBLIC_NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const MAX_QUERY_CHARS = 200;

interface PlaceLike {
  name: string;
  attributes: Record<string, unknown>;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Coordinates the brain itself put on the entity (`lat`/`lon`, `latitude`/`longitude`, or `coordinates`). */
export function brainCoords(attrs: Record<string, unknown>): { lat: number; lon: number } | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const n = num(attrs[k]);
      if (n !== null) return n;
    }
    return null;
  };
  let lat = pick('lat', 'latitude');
  let lon = pick('lon', 'lng', 'longitude');
  const c = attrs.coordinates ?? attrs.coords ?? attrs.location;
  if ((lat === null || lon === null) && c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    lat ??= num(o.lat) ?? num(o.latitude);
    lon ??= num(o.lon) ?? num(o.lng) ?? num(o.longitude);
  }
  if ((lat === null || lon === null) && typeof c === 'string') {
    const m = c.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      lat ??= Number(m[1]);
      lon ??= Number(m[2]);
    }
  }
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Free-text query for the geocoder: name plus whichever locality attributes the brain filled in. */
export function geocodeQuery(place: PlaceLike): string {
  const parts = [place.name];
  for (const k of ['address', 'city', 'town', 'region', 'state', 'country']) {
    const v = place.attributes[k];
    if (typeof v === 'string' && v.trim() && !parts.includes(v.trim())) parts.push(v.trim());
  }
  return parts.join(', ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

export interface GeocoderOptions {
  fetchImpl?: typeof fetch;
  /** Override the inter-request pause (tests). */
  pauseMs?: number;
  log?: { warn: (...a: unknown[]) => void };
}

export class Geocoder {
  private readonly fetchImpl: typeof fetch;
  private readonly pauseMs: number;
  private readonly log: { warn: (...a: unknown[]) => void };
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cfg: Config['geocoder'],
    private readonly repo: Repo,
    opts: GeocoderOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? console;
    let host = '';
    try {
      host = new URL(cfg.url).host;
    } catch {
      host = '';
    }
    this.pauseMs = opts.pauseMs ?? (host === PUBLIC_NOMINATIM_HOST ? 1100 : 0);
  }

  get enabled(): boolean {
    return this.cfg.provider !== 'off' && this.cfg.url.length > 0;
  }

  /**
   * Resolve one place: brain coordinates win and cost nothing; otherwise the cache, then the
   * network. Returns null when nothing is known (and records the miss so we do not retry).
   */
  async locate(place: PlaceLike): Promise<EntityGeo | null> {
    const own = brainCoords(place.attributes);
    if (own) return { ...own, label: null, source: 'brain' };
    const query = geocodeQuery(place);
    if (!query) return null;
    const cached = this.repo.getPlaceGeo(query);
    if (cached) return toGeo(cached);
    if (!this.enabled) return null;
    const hit = await this.enqueue(() => this.search(query));
    this.repo.putPlaceGeo({
      query,
      lat: hit?.lat ?? null,
      lon: hit?.lon ?? null,
      label: hit?.label ?? null,
      provider: this.cfg.provider,
    });
    return hit ? { ...hit, source: 'geocoder' } : null;
  }

  /** Locate every place of an item after a research run; failures only log. */
  async locateItem(itemId: string): Promise<void> {
    for (const e of this.repo.listEntities(itemId)) {
      if (e.kind !== 'place') continue;
      let attrs: Record<string, unknown> = {};
      try {
        const v = JSON.parse(e.attributes);
        if (v && typeof v === 'object') attrs = v as Record<string, unknown>;
      } catch {
        attrs = {};
      }
      try {
        await this.locate({ name: e.name, attributes: attrs });
      } catch (err) {
        this.log.warn(`geocode failed for "${e.name}": ${(err as Error).message}`);
      }
    }
  }

  /** Serialise requests and honour the public instance's one-per-second policy. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const r = await fn();
      if (this.pauseMs > 0) await new Promise((res) => setTimeout(res, this.pauseMs));
      return r;
    });
    this.chain = next.catch(() => {});
    return next;
  }

  private async search(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
    const u = new URL('/search', this.cfg.url);
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '1');
    if (this.cfg.email) u.searchParams.set('email', this.cfg.email);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await this.fetchImpl(u, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, 'accept-language': 'en' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`geocoder ${res.status}`);
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body) || body.length === 0) return null;
      const first = body[0] as Record<string, unknown>;
      const lat = num(first.lat);
      const lon = num(first.lon);
      if (lat === null || lon === null) return null;
      const label = typeof first.display_name === 'string' ? first.display_name : query;
      return { lat, lon, label };
    } finally {
      clearTimeout(timer);
    }
  }
}

function toGeo(row: {
  lat: number | null;
  lon: number | null;
  label: string | null;
}): EntityGeo | null {
  if (row.lat === null || row.lon === null) return null;
  return { lat: row.lat, lon: row.lon, label: row.label, source: 'geocoder' };
}
