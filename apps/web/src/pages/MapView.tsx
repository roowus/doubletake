import type { EntityHit } from '@doubletake/shared';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { useLive } from '../live';
import { Link, navigate } from '../router';
import { mapsUrl } from './Library';

/**
 * Map view over place entities (ADR 0022). Pins come from `GET /api/entities?kind=place`; a place
 * appears once the brain supplied lat/lon or the server's geocoder resolved it. Tiles are fetched
 * by the browser straight from OpenStreetMap; the server never proxies them.
 */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function popupHtml(h: EntityHit): string {
  const attrs = ['type', 'city', 'region', 'country']
    .map((k) => h.attributes[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const link = h.url
    ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener noreferrer">link ↗</a>`
    : '';
  return `<b>${escapeHtml(h.name)}</b>${attrs.length ? `<br><span class="muted">${escapeHtml(attrs.join(' · '))}</span>` : ''}
<br><a href="/chat/${escapeHtml(h.chatId)}" data-chat="${escapeHtml(h.chatId)}">from: ${escapeHtml(h.itemTitle)}</a> ${link}`;
}

export function MapView() {
  const [hits, setHits] = useState<EntityHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  const load = () =>
    api
      .entities('place', 1000)
      .then((h) => {
        setHits(h);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => void load(), []);
  useLive((e) => {
    if (e.kind === 'chat_updated') void load();
  });

  // Create the map once; React never re-renders inside the Leaflet container.
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    // Popup links are plain anchors; route /chat/<id> through the in-app router.
    m.on('popupopen', (ev) => {
      const el = ev.popup.getElement();
      el?.querySelectorAll<HTMLAnchorElement>('a[data-chat]').forEach((a) => {
        a.onclick = (click) => {
          click.preventDefault();
          navigate(`/chat/${a.dataset.chat}`);
        };
      });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Re-pin whenever the data changes.
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g || !hits) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const h of hits) {
      if (!h.geo) continue;
      const p: L.LatLngExpression = [h.geo.lat, h.geo.lon];
      pts.push(p);
      L.circleMarker(p, {
        radius: 8,
        color: '#7c9cff',
        fillColor: '#7c9cff',
        fillOpacity: 0.85,
        weight: 2,
      })
        .bindTooltip(h.name)
        .bindPopup(popupHtml(h))
        .addTo(g);
    }
    if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 12 });
  }, [hits]);

  const located = (hits ?? []).filter((h) => h.geo);
  const unlocated = (hits ?? []).filter((h) => !h.geo);
  const backfill = () => {
    setBusy(true);
    api
      .geocodePlaces()
      .then((r) => {
        setErr(r.unknown ? `${r.located} located, ${r.unknown} still unknown` : null);
        return load();
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="page stack">
      <div className="row">
        <h3 style={{ margin: 0, flex: 1 }}>Map</h3>
        <Link to="/entities/place" className="small">
          list view
        </Link>
        {unlocated.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={backfill}
            title="Ask the geocoder about places without coordinates"
          >
            {busy ? 'Locating…' : `Locate ${unlocated.length} more`}
          </button>
        )}
      </div>
      {err && <div className="msg error">{err}</div>}
      <div ref={box} className="map" />
      {hits && hits.length === 0 && <div className="card muted">No places yet.</div>}
      {hits && hits.length > 0 && located.length === 0 && (
        <div className="card muted">
          {hits.length} places saved but none located yet. Enable the geocoder (GEOCODER in .env) or
          use “Locate”.
        </div>
      )}
      {unlocated.length > 0 && (
        <details className="card small">
          <summary>{unlocated.length} without coordinates</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {unlocated.map((h) => {
              const g = mapsUrl(h);
              return (
                <li key={`${h.chatId}:${h.name}`}>
                  <Link to={`/chat/${h.chatId}`}>{h.name}</Link>
                  {g && (
                    <>
                      {' '}
                      <a href={g} target="_blank" rel="noopener noreferrer">
                        search ↗
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
