# 0022 — Map view: locating place entities

- Status: accepted (extends 0014)
- Date: 2026-09-04

## Context
ADR 0014 extracts typed entities from every research run, and `place` is the kind people save
most from travel and food reels: a bar in Lisbon, a hut on a ski route, a bakery whose name you
would otherwise forget. The places view lists them with a Google Maps *search* link built from
the name and city, which is a guess the user has to verify by hand. A map of everything saved,
with each pin leading back to its chat, needs coordinates, and the brain rarely knows them
precisely.

## Decision
Coordinates come from two sources, cheapest first, and are cached per place so each is looked
up once:

1. **Brain-supplied** `lat`/`lon` (also `latitude`/`longitude`, `lng`, a nested
   `coordinates`/`coords`/`location` object or a `"lat, lon"` string) in the entity attributes.
   The research prompt asks for `city`/`region`/`country` when known and for coordinates only
   when the model is sure of them. Out-of-range values are ignored.
2. **Geocoder**: a Nominatim-compatible `/search?q=&format=jsonv2&limit=1` endpoint
   (`apps/server/src/geo/index.ts`). Default is the public `https://nominatim.openstreetmap.org`
   with its usage policy honoured: requests are serialised with a 1.1 s pause, carry a
   `User-Agent` naming the project, and an optional contact e-mail (`GEOCODER_EMAIL`).
   `GEOCODER_URL` points it at a self-hosted Nominatim or Photon-compatible instance (no pause);
   `GEOCODER=off` disables lookups without disabling the map (cached and brain coordinates still
   render).

The query is the place name plus whichever of `address`, `city`, `town`, `region`, `state`,
`country` the entity carries, deduplicated and capped at 200 characters. Nominatim misses long
comma lists whose middle parts it does not know as address components ("Cerro Castor
(Ushuaia), Tierra del Fuego, Argentina" misses while "Cerro Castor (Ushuaia), Argentina" hits),
so the lookup tries the full query, then name + country, then the bare name, and stops at the
first hit (`geocodeCandidates`). Hits **and misses** are stored in `place_geo` keyed by the
**full** query (`lat`/`lon` null for a miss) so a place the geocoder does not know is asked at
most three times, once; a re-run with better attributes changes the query and therefore retries.

Geocoding is off the run's critical path: `finish()` stores the answer, sends the push and
writes the export as before, then `Worker.locatePlaces(itemId)` runs and emits `chat_updated`
when done, so the map fills in a few seconds later. `POST /api/entities/geocode` backfills every
place saved before this ADR (409 when the provider is `off`). `GET /api/entities?kind=place`
attaches `geo: { lat, lon, label, source: 'brain' | 'geocoder' }` to located entities and omits
it otherwise.

The web app gets `/map` (`apps/web/src/pages/MapView.tsx`) built on Leaflet 1.9 with
OpenStreetMap raster tiles requested by the **browser** directly, never proxied by the server.
Each located place is a circle marker whose popup links to its chat through the in-app router;
unlocated places are listed below with the existing Maps search link, and a **Locate N more**
button triggers the backfill.

## Alternatives considered
- **Brain-only coordinates**: free, but models hallucinate digits; kept as the first source,
  not the only one.
- **Google Maps Geocoding / Places API**: accurate but needs a billing account and a key for a
  self-hosted, single-owner tool; the Maps *search* link stays as the no-key fallback.
- **Geocode inside the run** before storing the answer: adds seconds (and a network dependency)
  to every run for a feature that is not the answer.
- **Server-proxied tiles**: hides the user's IP from the tile server but turns the laptop into a
  tile relay and breaks OSM's tile policy; the browser fetching tiles is the norm for Leaflet.
- **MapLibre GL / vector tiles**: better looking, but needs a style host or key; Leaflet with
  raster tiles works offline-installed and with zero configuration.

## Consequences
One outbound request per distinct place to the configured geocoder (place name and locality
strings only; never the note, answer or URL) and tile requests from the browser to
`tile.openstreetmap.org` while the map is open ([THREAT-MODEL](../THREAT-MODEL.md) T12). New
table `place_geo` (migration 0006), config `GEOCODER`, `GEOCODER_URL`, `GEOCODER_EMAIL`, a
Leaflet dependency in `apps/web`. Places saved before this ADR need one **Locate** click.
Coordinates from the geocoder are only as good as the entity's locality attributes; a bare name
like "The Corner Café" may land in the wrong city, which the popup label makes visible.
