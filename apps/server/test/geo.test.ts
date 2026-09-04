import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { brainCoords, Geocoder, geocodeCandidates, geocodeQuery } from '../src/geo/index.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const nominatimHit = (lat: string, lon: string, display_name: string) =>
  new Response(JSON.stringify([{ lat, lon, display_name }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('brainCoords / geocodeQuery', () => {
  it('reads lat/lon in the shapes brains actually emit and rejects out-of-range values', () => {
    expect(brainCoords({ lat: 46.5, lon: 7.9 })).toEqual({ lat: 46.5, lon: 7.9 });
    expect(brainCoords({ latitude: '46.5', longitude: '7.9' })).toEqual({ lat: 46.5, lon: 7.9 });
    expect(brainCoords({ coordinates: { lat: 1, lng: 2 } })).toEqual({ lat: 1, lon: 2 });
    expect(brainCoords({ coordinates: '10.5, -20.25' })).toEqual({ lat: 10.5, lon: -20.25 });
    expect(brainCoords({ lat: 95, lon: 0 })).toBeNull();
    expect(brainCoords({ country: 'Argentina' })).toBeNull();
  });
  it('builds the query from the name plus locality attributes, deduplicated', () => {
    expect(
      geocodeQuery({
        name: 'Las Leñas',
        attributes: { type: 'ski resort', region: 'Mendoza', country: 'Argentina' },
      }),
    ).toBe('Las Leñas, Mendoza, Argentina');
    expect(geocodeQuery({ name: 'Paris', attributes: { city: 'Paris' } })).toBe('Paris');
  });
});

describe('Geocoder', () => {
  const env = tempEnv('dt-geo-');
  afterAll(() => env.cleanup());
  const cfg = { provider: 'nominatim' as const, url: 'https://geo.example', email: null };

  it('prefers brain coordinates, caches hits and misses, and never re-queries a cached place', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const u = new URL(String(input));
      calls.push(u.searchParams.get('q') ?? '');
      expect(u.pathname).toBe('/search');
      expect(u.searchParams.get('format')).toBe('jsonv2');
      if (u.searchParams.get('q')?.startsWith('Nowhere'))
        return new Response('[]', { status: 200 });
      return nominatimHit('-35.15', '-70.08', 'Las Leñas, Mendoza, Argentina');
    };
    const geo = new Geocoder(cfg, env.repo, { fetchImpl, pauseMs: 0, log: { warn: () => {} } });

    expect(await geo.locate({ name: 'X', attributes: { lat: 1, lon: 2 } })).toEqual({
      lat: 1,
      lon: 2,
      label: null,
      source: 'brain',
    });
    expect(calls).toEqual([]);

    const first = await geo.locate({ name: 'Las Leñas', attributes: { country: 'Argentina' } });
    expect(first).toMatchObject({ lat: -35.15, lon: -70.08, source: 'geocoder' });
    const again = await geo.locate({ name: 'Las Leñas', attributes: { country: 'Argentina' } });
    expect(again).toEqual(first);
    expect(calls).toEqual(['Las Leñas, Argentina']);

    expect(await geo.locate({ name: 'Nowhere', attributes: {} })).toBeNull();
    expect(await geo.locate({ name: 'Nowhere', attributes: {} })).toBeNull();
    expect(calls).toEqual(['Las Leñas, Argentina', 'Nowhere']);
    expect(env.repo.getPlaceGeo('Nowhere')).toMatchObject({ lat: null, lon: null });
  });

  it('falls back to name + country, then bare name, caching under the full query', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const q =
        new URL(input instanceof Request ? input.url : String(input)).searchParams.get('q') ?? '';
      calls.push(q);
      return q === 'Cerro Castor (Ushuaia), Argentina'
        ? nominatimHit('-54.72', '-68.03', 'Cerro Castor, Departamento Ushuaia, Argentina')
        : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const geo = new Geocoder(cfg, env.repo, { fetchImpl, pauseMs: 0, log: { warn: () => {} } });
    const place = {
      name: 'Cerro Castor (Ushuaia)',
      attributes: { region: 'Tierra del Fuego', country: 'Argentina' },
    };
    expect(geocodeCandidates(place)).toEqual([
      'Cerro Castor (Ushuaia), Tierra del Fuego, Argentina',
      'Cerro Castor (Ushuaia), Argentina',
      'Cerro Castor (Ushuaia)',
    ]);
    expect(await geo.locate(place)).toMatchObject({ lat: -54.72, lon: -68.03, source: 'geocoder' });
    expect(calls).toEqual([
      'Cerro Castor (Ushuaia), Tierra del Fuego, Argentina',
      'Cerro Castor (Ushuaia), Argentina',
    ]);
    expect(
      env.repo.getPlaceGeo('Cerro Castor (Ushuaia), Tierra del Fuego, Argentina'),
    ).toMatchObject({
      lat: -54.72,
    });
  });

  it('is inert when switched off: cache still answers, network never touched', async () => {
    let touched = false;
    const fetchImpl: typeof fetch = async () => {
      touched = true;
      return new Response('[]');
    };
    const geo = new Geocoder({ ...cfg, provider: 'off' }, env.repo, { fetchImpl, pauseMs: 0 });
    expect(geo.enabled).toBe(false);
    expect(
      await geo.locate({ name: 'Las Leñas', attributes: { country: 'Argentina' } }),
    ).toMatchObject({
      lat: -35.15,
    });
    expect(await geo.locate({ name: 'Fresh place', attributes: {} })).toBeNull();
    expect(touched).toBe(false);
  });

  it('surfaces http errors to the caller and does not cache them', async () => {
    const fetchImpl: typeof fetch = async () => new Response('busy', { status: 429 });
    const geo = new Geocoder(cfg, env.repo, { fetchImpl, pauseMs: 0 });
    await expect(geo.locate({ name: 'Ratelimited', attributes: {} })).rejects.toThrow('429');
    expect(env.repo.getPlaceGeo('Ratelimited')).toBeUndefined();
  });
});

describe('map view API', () => {
  const env = tempEnv('dt-geo-api-');
  afterAll(() => env.cleanup());

  it('locates places after a research run and exposes geo on GET /api/entities?kind=place', async () => {
    const brain = new FakeBrain();
    brain.nextResult = {
      structured: {
        summary: 's',
        category: 'travel',
        entities: [
          {
            kind: 'place',
            name: 'Las Leñas',
            attributes: { country: 'Argentina' },
            confidence: 0.9,
          },
          { kind: 'place', name: 'Home', attributes: { lat: 47.1, lon: 8.2 }, confidence: 0.9 },
          { kind: 'place', name: 'Nowhere', attributes: {}, confidence: 0.5 },
          { kind: 'product', name: 'Wax', attributes: {}, confidence: 0.9 },
        ],
        claims: [],
        recommendations: [],
        tags: ['ski'],
      },
    };
    const fetchImpl: typeof fetch = async (input) => {
      const q = new URL(String(input)).searchParams.get('q') ?? '';
      return q.startsWith('Nowhere')
        ? new Response('[]')
        : nominatimHit('-35.15', '-70.08', 'Las Leñas, Mendoza, Argentina');
    };
    const geocoder = new Geocoder(
      { provider: 'nominatim', url: 'https://geo.example', email: null },
      env.repo,
      { fetchImpl, pauseMs: 0, log: { warn: () => {} } },
    );
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    worker.locatePlaces = (id) => geocoder.locateItem(id);
    const app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain, geocoder });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'pw-123456', deviceName: 'test' },
    });
    const token = (setup.json() as { token: string }).token;
    const h = { authorization: `Bearer ${token}` };

    worker.start();
    const ing = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: h,
      payload: { text: 'ski trip ideas', channel: 'compose' },
    });
    expect(ing.statusCode).toBe(202);
    await waitFor(() => env.repo.getPlaceGeo('Las Leñas, Argentina') !== undefined, 5000);
    await waitFor(() => env.repo.getPlaceGeo('Nowhere') !== undefined, 5000);

    const res = await app.inject({ method: 'GET', url: '/api/entities?kind=place', headers: h });
    expect(res.statusCode).toBe(200);
    const hits = res.json() as { name: string; geo?: { lat: number; source: string } }[];
    const byName = Object.fromEntries(hits.map((x) => [x.name, x]));
    expect(byName['Las Leñas']?.geo).toMatchObject({
      lat: -35.15,
      lon: -70.08,
      source: 'geocoder',
    });
    expect(byName.Home?.geo).toMatchObject({ lat: 47.1, lon: 8.2, source: 'brain' });
    expect(byName.Nowhere?.geo).toBeUndefined();

    const products = await app.inject({
      method: 'GET',
      url: '/api/entities?kind=product',
      headers: h,
    });
    expect((products.json() as { geo?: unknown }[])[0]?.geo).toBeUndefined();

    const back = await app.inject({ method: 'POST', url: '/api/entities/geocode', headers: h });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toEqual({ places: 3, located: 2, unknown: 1, retried: 0 });
    // ?retry=misses forgets the cached miss and asks again; still unknown, cached again.
    const retry = await app.inject({
      method: 'POST',
      url: '/api/entities/geocode?retry=misses',
      headers: h,
    });
    expect(retry.json()).toEqual({ places: 3, located: 2, unknown: 1, retried: 1 });
    expect(env.repo.getPlaceGeo('Nowhere')).toMatchObject({ lat: null });

    await worker.stop();
    await app.close();
  });

  it('answers 409 from the backfill route when no geocoder is configured', async () => {
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    const app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    const { token } = new Auth(env.repo).createDevice('test2', 'web');
    const res = await app.inject({
      method: 'POST',
      url: '/api/entities/geocode',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
