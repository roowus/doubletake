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

    const status = (
      await app.inject({ method: 'GET', url: '/api/status', headers: auth() })
    ).json();
    expect(status.spentTodayUsd).toBeCloseTo(0.06);
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

  it('ftsQuery quotes terms and strips operators', () => {
    expect(ftsQuery('sour"dough  OR x')).toBe('"sourdough"* "OR"* "x"*');
  });
});
