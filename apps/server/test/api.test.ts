import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, ftsQuery } from '../src/api/server.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

const env = tempEnv('dt-api-');
const brain = new FakeBrain();
const worker = new QueueWorker(env.repo, brain, env.cfg);
let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await app.ready();
  worker.start();
});
afterAll(async () => {
  await worker.stop();
  await app.close();
  env.cleanup();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('API', () => {
  it('health is public, everything else needs a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({
      ok: true,
      hasOwner: false,
    });
    expect((await app.inject({ method: 'GET', url: '/api/chats' })).statusCode).toBe(401);
  });

  it('first-run setup sets the owner password and returns a device token; login works after', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'correct horse battery', deviceName: 'test' },
    });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    expect(token).toMatch(/^dt_/);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/setup',
          payload: { password: 'again again' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/login',
          payload: { password: 'wrong wrong' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/login',
          payload: { password: 'correct horse battery' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('pairing: start (auth) → redeem (public) → new token works; revoke kills it', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/pair/start', headers: auth() });
    expect(start.statusCode).toBe(200);
    const { code } = start.json();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/pair/redeem',
      payload: { code: 'NOPE00', deviceName: 'phone' },
    });
    expect(bad.statusCode).toBe(400);
    const redeem = await app.inject({
      method: 'POST',
      url: '/api/pair/redeem',
      payload: { code, deviceName: 'phone', platform: 'android' },
    });
    expect(redeem.statusCode).toBe(200);
    const phoneToken = redeem.json().token as string;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/chats',
          headers: { authorization: `Bearer ${phoneToken}` },
        })
      ).statusCode,
    ).toBe(200);
    // single use
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/pair/redeem',
          payload: { code, deviceName: 'again' },
        })
      ).statusCode,
    ).toBe(400);
    const devices = (
      await app.inject({ method: 'GET', url: '/api/devices', headers: auth() })
    ).json() as { id: string; name: string }[];
    const phone = devices.find((d) => d.name === 'phone');
    await app.inject({ method: 'DELETE', url: `/api/devices/${phone?.id}`, headers: auth() });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/chats',
          headers: { authorization: `Bearer ${phoneToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('ingest → chat list with unread badge → detail → read → follow-up → research', async () => {
    const ing = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: auth(),
      payload: { text: 'What is a Widget?', channel: 'compose', modeHint: 'quick' },
    });
    expect(ing.statusCode).toBe(202);
    const { chatId, runId } = ing.json();
    await waitFor(() => env.repo.getRun(runId)?.status === 'done');

    const list = (await app.inject({ method: 'GET', url: '/api/chats', headers: auth() })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: chatId,
      unreadCount: 1,
      status: 'answered',
      category: 'tech',
      platform: 'text',
    });
    expect(list[0].tags.sort()).toEqual(['tools', 'widgets']);

    const detail = (
      await app.inject({ method: 'GET', url: `/api/chats/${chatId}`, headers: auth() })
    ).json();
    expect(detail.messages.at(-1)).toMatchObject({ kind: 'answer', content: 'Researched answer.' });
    expect(detail.messages.at(-1).structured.summary).toBe('A summary.');
    expect(detail.entities).toEqual([
      { kind: 'tool', name: 'Widget', attributes: { price: '$9' }, confidence: 0.9 },
    ]);
    expect(detail.runs[0]).toMatchObject({ status: 'done', mode: 'quick', costUsd: 0.02 });

    const evs = (
      await app.inject({
        method: 'GET',
        url: `/api/chats/${chatId}/runs/${runId}/events`,
        headers: auth(),
      })
    ).json();
    expect(evs.events.map((e: { type: string }) => e.type)).toContain('done');

    await app.inject({ method: 'POST', url: `/api/chats/${chatId}/read`, headers: auth() });
    expect(env.repo.getChat(chatId)?.unreadCount).toBe(0);

    const fu = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: auth(),
      payload: { content: 'cheaper?' },
    });
    expect(fu.statusCode).toBe(202);
    await waitFor(() => env.repo.getRun(fu.json().runId)?.status === 'done');
    expect(env.repo.listMessages(chatId).at(-1)?.content).toContain('cheaper?');

    const re = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/research`,
      headers: auth(),
      payload: { mode: 'deep' },
    });
    expect(re.statusCode).toBe(202);
    await waitFor(() => env.repo.getRun(re.json().runId)?.status === 'done');
    expect(env.repo.getRun(re.json().runId)?.mode).toBe('deep');
    expect(env.repo.getItem(detail.chat.itemId)?.modeEffective).toBe('deep');

    // search
    const hit = (
      await app.inject({ method: 'GET', url: '/api/chats?q=widget', headers: auth() })
    ).json();
    expect(hit).toHaveLength(1);
    const miss = (
      await app.inject({ method: 'GET', url: '/api/chats?q=zebra', headers: auth() })
    ).json();
    expect(miss).toHaveLength(0);

    // manual tags: add, list, filter, reindex + re-export, remove
    const added = await app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/tags`,
      headers: auth(),
      payload: { name: '  Ski Tips ' },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().tags.sort()).toEqual(['ski tips', 'tools', 'widgets']);
    const allTags = (await app.inject({ method: 'GET', url: '/api/tags', headers: auth() })).json();
    expect(allTags).toContainEqual({ name: 'ski tips', kind: 'manual', count: 1 });
    expect(allTags).toContainEqual({ name: 'tools', kind: 'auto', count: 1 });
    const byTag = (
      await app.inject({ method: 'GET', url: '/api/chats?tag=ski%20tips', headers: auth() })
    ).json();
    expect(byTag).toHaveLength(1);
    const byOther = (
      await app.inject({ method: 'GET', url: '/api/chats?tag=nope', headers: auth() })
    ).json();
    expect(byOther).toHaveLength(0);
    const viaFts = (
      await app.inject({ method: 'GET', url: '/api/chats?q=ski', headers: auth() })
    ).json();
    expect(viaFts).toHaveLength(1);
    const noteDir = path.join(env.cfg.notesDir, String(new Date().getFullYear()));
    const note = fs.readFileSync(path.join(noteDir, fs.readdirSync(noteDir)[0] ?? ''), 'utf8');
    expect(note).toContain('tags: [ski-tips, tools, widgets]');
    expect(note).toContain('tools: ["Widget"]');
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/chats/${chatId}/tags/ski%20tips`,
      headers: auth(),
    });
    expect(removed.json().tags.sort()).toEqual(['tools', 'widgets']);
    expect(
      (await app.inject({ method: 'GET', url: '/api/tags', headers: auth() })).json(),
    ).not.toContainEqual(expect.objectContaining({ name: 'ski tips' }));

    // extractions are flattened for the Sources tab
    const det2 = (
      await app.inject({ method: 'GET', url: `/api/chats/${chatId}`, headers: auth() })
    ).json();
    expect(Array.isArray(det2.extractions)).toBe(true);

    // collections: auto ones are seeded and count matching items; manual ones hold picked chats
    const cols = (
      await app.inject({ method: 'GET', url: '/api/collections', headers: auth() })
    ).json();
    expect(cols).toContainEqual(
      expect.objectContaining({ query: 'category:tech', auto: true, count: 1 }),
    );
    expect(cols).toContainEqual(
      expect.objectContaining({ query: 'entity:tool', name: 'Tools', count: 1 }),
    );
    expect(cols.find((c: { query: string }) => c.query === 'category:travel')).toBeUndefined();
    const allCols = (
      await app.inject({ method: 'GET', url: '/api/collections?all=true', headers: auth() })
    ).json();
    expect(allCols.find((c: { query: string }) => c.query === 'category:travel')).toMatchObject({
      count: 0,
    });
    const techId = cols.find((c: { query: string }) => c.query === 'category:tech').id;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/chats?collection=${techId}`,
          headers: auth(),
        })
      ).json(),
    ).toHaveLength(1);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/collections/${techId}`, headers: auth() }))
        .statusCode,
    ).toBe(400);
    const hide = await app.inject({
      method: 'POST',
      url: `/api/collections/${techId}`,
      headers: auth(),
      payload: { hidden: true },
    });
    expect(hide.json()).toMatchObject({ hidden: true });
    expect(
      (await app.inject({ method: 'GET', url: '/api/collections', headers: auth() }))
        .json()
        .find((c: { id: string }) => c.id === techId),
    ).toBeUndefined();

    const made = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: auth(),
      payload: { name: 'Read later' },
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ manual: true, auto: false, count: 0 });
    const manualId = made.json().id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/collections/${manualId}/items`,
          headers: auth(),
          payload: { chatId },
        })
      ).json(),
    ).toEqual({ count: 1 });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/chats/${chatId}/collections`,
          headers: auth(),
        })
      ).json(),
    ).toEqual({ collectionIds: [manualId] });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/chats?collection=${manualId}`,
          headers: auth(),
        })
      ).json(),
    ).toHaveLength(1);
    await app.inject({
      method: 'DELETE',
      url: `/api/collections/${manualId}/items/${chatId}`,
      headers: auth(),
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/chats?collection=${manualId}`,
          headers: auth(),
        })
      ).json(),
    ).toHaveLength(0);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: auth(),
      payload: { name: 'Widgets', query: 'widget' },
    });
    expect(saved.json()).toMatchObject({ manual: false, count: 1 });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/collections/preview?query=tag:tools',
          headers: auth(),
        })
      ).json(),
    ).toEqual({ count: 1 });

    // entity views
    const tools = (
      await app.inject({ method: 'GET', url: '/api/entities?kind=tool', headers: auth() })
    ).json();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'Widget', chatId, platform: 'text' });
    expect(typeof tools[0].itemTitle).toBe('string');

    const status = (
      await app.inject({ method: 'GET', url: '/api/status', headers: auth() })
    ).json();
    expect(status.spentTodayUsd).toBeCloseTo(0.06);
    expect(status.brain).toBe('fake');
    expect(status.brains).toHaveLength(1);
    expect(status.brains[0]).toMatchObject({ id: 'fake', ok: true, default: true, modes: [] });
    expect(typeof status.brains[0].checkedAt).toBe('string');
    const skipped = (
      await app.inject({ method: 'GET', url: '/api/status?health=skip', headers: auth() })
    ).json();
    expect(skipped.brains).toEqual([]);
  });

  it('validation errors are 400 with issues', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: auth(),
      payload: { channel: 'compose' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid request');
  });

  it('serves the PWA with an SPA fallback, but unknown /assets/ paths 404', async () => {
    const dist = fs.mkdtempSync(path.join(env.root, 'web-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>dt</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'export const x = 1;');
    const w = new QueueWorker(env.repo, brain, env.cfg);
    const web = await buildServer({
      cfg: { ...env.cfg, webDist: dist },
      repo: env.repo,
      worker: w,
      brain,
    });
    try {
      const js = await web.inject({ method: 'GET', url: '/assets/index-abc123.js' });
      expect(js.statusCode).toBe(200);
      expect(js.headers['content-type']).toMatch(/javascript/);
      const spa = await web.inject({ method: 'GET', url: '/chat/01ABC' });
      expect(spa.statusCode).toBe(200);
      expect(spa.headers['content-type']).toMatch(/text\/html/);
      // A bundle built after boot is not a route yet: it must not come back as index.html.
      const stale = await web.inject({ method: 'GET', url: '/assets/index-zzz999.js' });
      expect(stale.statusCode).toBe(404);
      expect(stale.headers['content-type']).not.toMatch(/text\/html/);
      const api = await web.inject({ method: 'GET', url: '/api/nope', headers: auth() });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toEqual({ error: 'not found' });
    } finally {
      await web.close();
    }
  });

  it('ftsQuery quotes terms and strips operators', () => {
    expect(ftsQuery('sour"dough  OR x')).toBe('"sourdough"* "OR"* "x"*');
  });
});
