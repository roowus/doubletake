import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Auth } from '../src/auth/index.js';
import { FcmNotifier } from '../src/notify/fcm.js';
import { MAX_FAILED, NotificationHub } from '../src/notify/hub.js';
import { resolveVapid } from '../src/notify/index.js';
import type { Notification, Notifier, PushTarget, SendOutcome } from '../src/notify/types.js';
import { generateVapidKeys, WebPushNotifier } from '../src/notify/webpush.js';
import { buildNotification, QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv, waitFor } from './helpers.js';

class ScriptedNotifier implements Notifier {
  sent: { target: PushTarget; n: Notification }[] = [];
  script: SendOutcome[] = [];
  constructor(readonly kind: 'webpush' | 'fcm') {}
  async send(target: PushTarget, n: Notification): Promise<SendOutcome> {
    this.sent.push({ target, n });
    return this.script.shift() ?? { status: 'ok' };
  }
}

const note: Notification = {
  title: 'T',
  body: 'B',
  chatId: 'c1',
  url: '/chat/c1',
  tag: 'chat-c1',
};

describe('NotificationHub', () => {
  const env = tempEnv('dt-hub-');
  afterAll(() => env.cleanup());
  const auth = new Auth(env.repo);
  const quiet = { warn: () => {} };

  it('fans out per kind, prunes gone subscriptions, counts failures and drops after MAX_FAILED', async () => {
    const dev = auth.createDevice('phone', 'android');
    const web = new ScriptedNotifier('webpush');
    const fcm = new ScriptedNotifier('fcm');
    const hub = new NotificationHub(env.repo, [web, fcm], quiet);
    env.repo.upsertPushSubscription(dev.deviceId, 'fcm', 'tok-1', null);
    const w = env.repo.upsertPushSubscription(
      dev.deviceId,
      'webpush',
      'https://push.example/1',
      JSON.stringify({ p256dh: 'p', auth: 'a' }),
    );
    env.repo.upsertPushSubscription(dev.deviceId, 'ntfy', 'x', null); // no notifier → skipped

    let r = await hub.notify(note);
    expect(r).toEqual({ sent: 2, gone: 0, failed: 0, skipped: 1 });
    expect(web.sent[0]?.target.keys).toEqual({ p256dh: 'p', auth: 'a' });
    expect(fcm.sent[0]?.target.endpoint).toBe('tok-1');
    // Payload never carries answer text: exactly these fields.
    expect(Object.keys(web.sent[0]?.n ?? {}).sort()).toEqual([
      'body',
      'chatId',
      'tag',
      'title',
      'url',
    ]);

    fcm.script = [{ status: 'gone' }];
    r = await hub.notify(note);
    expect(r.gone).toBe(1);
    expect(
      env.repo
        .listPushSubscriptions()
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['ntfy', 'webpush']);

    web.script = Array.from({ length: MAX_FAILED }, () => ({
      status: 'failed' as const,
      error: 'x',
    }));
    for (let i = 0; i < MAX_FAILED - 1; i++) await hub.notify(note);
    expect(
      env.repo.listPushSubscriptionsForDevice(dev.deviceId).find((s) => s.id === w.id)?.failedCount,
    ).toBe(MAX_FAILED - 1);
    await hub.notify(note);
    expect(
      env.repo.listPushSubscriptionsForDevice(dev.deviceId).find((s) => s.id === w.id),
    ).toBeUndefined();
  });

  it('re-subscribing the same endpoint moves it to the new device and resets failures', () => {
    const a = auth.createDevice('a', 'web');
    const b = auth.createDevice('b', 'web');
    const first = env.repo.upsertPushSubscription(
      a.deviceId,
      'webpush',
      'https://push.example/same',
      '{}',
    );
    env.repo.bumpPushFailure(first.id);
    const second = env.repo.upsertPushSubscription(
      b.deviceId,
      'webpush',
      'https://push.example/same',
      '{}',
    );
    expect(second.id).toBe(first.id);
    expect(env.repo.listPushSubscriptionsForDevice(a.deviceId)).toHaveLength(0);
    expect(env.repo.listPushSubscriptionsForDevice(b.deviceId)[0]?.failedCount).toBe(0);
  });

  it('skips subscriptions of revoked devices', async () => {
    const dev = auth.createDevice('old', 'android');
    env.repo.upsertPushSubscription(dev.deviceId, 'fcm', 'tok-old', null);
    env.repo.revokeDevice(dev.deviceId);
    const fcm = new ScriptedNotifier('fcm');
    await new NotificationHub(env.repo, [fcm], quiet).notify(note);
    expect(fcm.sent.map((s) => s.target.endpoint)).not.toContain('tok-old');
  });

  it('generates VAPID keys once and persists them in settings; env wins when set', () => {
    const k1 = resolveVapid(env.cfg, env.repo);
    const k2 = resolveVapid(env.cfg, env.repo);
    expect(k1.publicKey).toBe(k2.publicKey);
    expect(k1.publicKey.length).toBeGreaterThan(40);
    const k3 = resolveVapid(
      { ...env.cfg, vapidPublicKey: 'PUB', vapidPrivateKey: 'PRIV' },
      env.repo,
    );
    expect(k3.publicKey).toBe('PUB');
  });

  it('WebPushNotifier treats an unreachable endpoint as a transient failure, missing keys as gone', async () => {
    const n = new WebPushNotifier(generateVapidKeys('mailto:t@example.com'));
    const base = { id: 'x', deviceId: 'd', kind: 'webpush' };
    expect(
      await n.send({ ...base, endpoint: 'https://127.0.0.1:1/push', keys: null }, note),
    ).toEqual({
      status: 'gone',
    });
    const out = await n.send(
      {
        ...base,
        endpoint: 'https://127.0.0.1:1/push',
        keys: { p256dh: 'BNo', auth: 'aaaaaaaaaaaaaaaaaaaaaa' },
      },
      note,
    );
    expect(out.status).toBe('failed');
  });
});

describe('FcmNotifier', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = {
    project_id: 'proj',
    client_email: 'svc@proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    token_uri: 'https://oauth2.example/token',
  };

  function fakeFetch(sendStatus: number, sendBody = '{}') {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url) === sa.token_uri)
        return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), {
          status: 200,
        });
      return new Response(sendBody, { status: sendStatus });
    }) as typeof fetch;
    return { f, calls };
  }

  it('exchanges a signed JWT for a token once, then sends a notification message with data.chatId', async () => {
    const { f, calls } = fakeFetch(200);
    const n = new FcmNotifier(sa, f);
    const target = { id: 's', deviceId: 'd', kind: 'fcm', endpoint: 'reg-token', keys: null };
    expect(await n.send(target, note)).toEqual({ status: 'ok' });
    expect(await n.send(target, note)).toEqual({ status: 'ok' });
    const tokenCalls = calls.filter((c) => c.url === sa.token_uri);
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(String(tokenCalls[0]?.init.body)).get('assertion') ?? '';
    const [h, c, sig] = assertion.split('.');
    expect(JSON.parse(Buffer.from(h ?? '', 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString());
    expect(claims.iss).toBe(sa.client_email);
    expect(
      crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${h}.${c}`),
        sa.private_key,
        Buffer.from(sig ?? '', 'base64url'),
      ),
    ).toBe(true);
    const send = calls.find((c) => c.url.includes('/messages:send'));
    expect(send?.url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send');
    const msg = JSON.parse(String(send?.init.body)).message;
    expect(msg.token).toBe('reg-token');
    expect(msg.notification).toEqual({ title: 'T', body: 'B' });
    expect(msg.data).toEqual({ chatId: 'c1', url: '/chat/c1' });
    expect((send?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer AT',
    );
  });

  it('maps UNREGISTERED to gone and other errors to failed', async () => {
    const target = { id: 's', deviceId: 'd', kind: 'fcm', endpoint: 'dead', keys: null };
    expect(
      await new FcmNotifier(sa, fakeFetch(404, '{"error":{"status":"NOT_FOUND"}}').f).send(
        target,
        note,
      ),
    ).toEqual({ status: 'gone' });
    expect(
      await new FcmNotifier(
        sa,
        fakeFetch(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}').f,
      ).send(target, note),
    ).toEqual({ status: 'gone' });
    const out = await new FcmNotifier(sa, fakeFetch(500, 'boom').f).send(target, note);
    expect(out.status).toBe('failed');
  });
});

describe('buildNotification', () => {
  it('uses title or note, deep-links to the chat, and never includes answer text', () => {
    const n = buildNotification(
      { title: 'Five skiing tips', note: null },
      'abc',
      'answered',
      'https://h.ts.net/',
    );
    expect(n).toEqual({
      title: 'Five skiing tips',
      body: 'Answer ready. Tap to open the chat.',
      chatId: 'abc',
      url: 'https://h.ts.net/chat/abc',
      tag: 'chat-abc',
    });
    const f = buildNotification({ title: null, note: 'is this true?' }, 'abc', 'failed', null);
    expect(f.title).toBe('is this true? — failed');
    expect(f.url).toBe('/chat/abc');
  });
});

describe('push API + worker integration', () => {
  const env = tempEnv('dt-push-api-');
  const brain = new FakeBrain();
  const worker = new QueueWorker(env.repo, brain, env.cfg);
  const web = new ScriptedNotifier('webpush');
  const hub = new NotificationHub(env.repo, [web], { warn: () => {} });
  worker.notifier = hub;
  let app: FastifyInstance;
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await buildServer({
      cfg: env.cfg,
      repo: env.repo,
      worker,
      brain,
      hub,
      vapidPublicKey: 'VAPIDPUB',
    });
    await app.ready();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'correct horse battery', deviceName: 'laptop' },
    });
    token = setup.json().token;
    worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await app.close();
    env.cleanup();
  });

  it('exposes the VAPID public key and configured kinds in status', async () => {
    const st = (await app.inject({ method: 'GET', url: '/api/status', headers: auth() })).json();
    expect(st.push).toEqual({ kinds: ['webpush'], vapidPublicKey: 'VAPIDPUB' });
  });

  it('subscribe validates, stores per device, rejects unconfigured kinds; unsubscribe removes', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: auth(),
      payload: { kind: 'webpush', endpoint: 'https://p/1' },
    });
    expect(bad.statusCode).toBe(400);
    const fcm = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: auth(),
      payload: { kind: 'fcm', endpoint: 'tok' },
    });
    expect(fcm.statusCode).toBe(409);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: auth(),
      payload: { kind: 'webpush', endpoint: 'https://p/1', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(ok.statusCode).toBe(200);
    const list = (
      await app.inject({ method: 'GET', url: '/api/push/subscriptions', headers: auth() })
    ).json();
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://p/1');

    const test = await app.inject({ method: 'POST', url: '/api/push/test', headers: auth() });
    expect(test.json()).toMatchObject({ sent: 1 });
    expect(web.sent.at(-1)?.n.tag).toBe('test');

    const un = await app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      headers: auth(),
      payload: { endpoint: 'https://p/1' },
    });
    expect(un.json()).toEqual({ removed: true });
    expect(
      await app
        .inject({ method: 'GET', url: '/api/push/subscriptions', headers: auth() })
        .then((r) => r.json()),
    ).toEqual([]);
  });

  it('a finished run pushes one notification per subscription with the chat deep link', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: auth(),
      payload: { kind: 'webpush', endpoint: 'https://p/2', keys: { p256dh: 'p', auth: 'a' } },
    });
    web.sent = [];
    const ing = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: auth(),
      payload: { text: 'Is cold plunging good for recovery?', channel: 'android_share' },
    });
    const { chatId } = ing.json();
    await waitFor(() => web.sent.length >= 1);
    const n = web.sent[0]?.n;
    expect(n?.chatId).toBe(chatId);
    expect(n?.url).toBe(`/chat/${chatId}`);
    expect(n?.body).toBe('Answer ready. Tap to open the chat.');
    expect(JSON.stringify(n)).not.toContain('Researched answer');
  });
});
