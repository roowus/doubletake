import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import {
  buildDigest,
  DigestGate,
  isQuiet,
  loadQuietHours,
  localMinutes,
  type QuietHours,
} from '../src/notify/quiet.js';
import type { Notification } from '../src/notify/types.js';
import { FakeBrain, tempEnv } from './helpers.js';

const n = (id: string, title = `Title ${id}`): Notification => ({
  title,
  body: 'Answer ready. Tap to open the chat.',
  chatId: id,
  url: `/chat/${id}`,
  tag: `chat-${id}`,
});

class Sink {
  sent: Notification[] = [];
  async notify(x: Notification) {
    this.sent.push(x);
    return { sent: 1 };
  }
}

describe('quiet hours math', () => {
  const q: QuietHours = { enabled: true, start: '22:00', end: '07:30', timeZone: 'UTC' };
  it('handles a window that wraps midnight', () => {
    expect(isQuiet(q, new Date('2026-09-04T23:15:00Z'))).toBe(true);
    expect(isQuiet(q, new Date('2026-09-04T03:00:00Z'))).toBe(true);
    expect(isQuiet(q, new Date('2026-09-04T07:29:00Z'))).toBe(true);
    expect(isQuiet(q, new Date('2026-09-04T07:30:00Z'))).toBe(false);
    expect(isQuiet(q, new Date('2026-09-04T12:00:00Z'))).toBe(false);
  });
  it('handles a same-day window and respects the time zone', () => {
    const day: QuietHours = { enabled: true, start: '13:00', end: '14:00', timeZone: 'UTC' };
    expect(isQuiet(day, new Date('2026-09-04T13:30:00Z'))).toBe(true);
    expect(isQuiet(day, new Date('2026-09-04T14:00:00Z'))).toBe(false);
    // 13:30 UTC is 15:30 in Berlin (CEST) -> outside a 13:00-14:00 Berlin window.
    expect(isQuiet({ ...day, timeZone: 'Europe/Berlin' }, new Date('2026-09-04T13:30:00Z'))).toBe(
      false,
    );
    expect(localMinutes(new Date('2026-09-04T00:05:00Z'), 'UTC')).toBe(5);
  });
  it('is never quiet when disabled, malformed or start === end', () => {
    expect(isQuiet({ ...q, enabled: false }, new Date('2026-09-04T23:15:00Z'))).toBe(false);
    expect(isQuiet({ ...q, start: '25:00' }, new Date('2026-09-04T23:15:00Z'))).toBe(false);
    expect(isQuiet({ ...q, end: '22:00' }, new Date('2026-09-04T23:15:00Z'))).toBe(false);
  });
});

describe('buildDigest', () => {
  it('one parked item opens that chat; several open the list and never carry answer text', () => {
    const one = buildDigest([{ chatId: 'c1', title: 'A reel' }], 'https://dt.example/');
    expect(one).toMatchObject({
      title: 'Answer ready',
      chatId: 'c1',
      url: 'https://dt.example/chat/c1',
      tag: 'digest',
    });
    const many = buildDigest(
      [
        { chatId: 'c1', title: 'One' },
        { chatId: 'c2', title: 'Two' },
        { chatId: 'c3', title: 'Three' },
        { chatId: 'c4', title: 'Four' },
        { chatId: 'c5', title: 'Five' },
      ],
      null,
    );
    expect(many.title).toBe('5 answers ready');
    expect(many.body).toBe('One · Two · Three · +2 more');
    expect(many.url).toBe('/');
    expect(many.chatId).toBe('');
  });
});

describe('DigestGate', () => {
  const env = tempEnv('dt-digest-');
  afterAll(() => env.cleanup());
  let clock = new Date('2026-09-04T12:00:00Z');
  const sink = new Sink();
  const gate = new DigestGate(env.repo, sink, 'https://dt.example', () => clock);

  it('defaults to disabled and passes notifications straight through', async () => {
    expect(gate.quietHours().enabled).toBe(false);
    await gate.notify(n('c0'));
    expect(sink.sent.map((x) => x.chatId)).toEqual(['c0']);
    expect(gate.pendingCount()).toBe(0);
  });

  it('parks inside the window, flushes one digest after it ends, and forgets the rows', async () => {
    gate.setQuietHours({ enabled: true, start: '22:00', end: '07:30', timeZone: 'UTC' });
    expect(loadQuietHours(env.repo).start).toBe('22:00');
    clock = new Date('2026-09-04T23:00:00Z');
    expect(await gate.notify(n('c1'))).toEqual({ parked: true });
    await gate.notify(n('c2'));
    expect(sink.sent).toHaveLength(1);
    expect(gate.pendingCount()).toBe(2);
    // Timer tick while still quiet: nothing goes out.
    expect(await gate.flush()).toEqual({ sent: 0 });
    clock = new Date('2026-09-05T07:31:00Z');
    expect(await gate.flush()).toEqual({ sent: 2 });
    expect(sink.sent).toHaveLength(2);
    expect(sink.sent[1]).toMatchObject({
      title: '2 answers ready',
      url: 'https://dt.example/',
      tag: 'digest',
    });
    expect(gate.pendingCount()).toBe(0);
    expect(await gate.flush()).toEqual({ sent: 0 });
  });

  it('force-flush sends inside the window; the timer flushes without being asked', async () => {
    clock = new Date('2026-09-05T23:00:00Z');
    await gate.notify(n('c3'));
    expect(gate.pendingCount()).toBe(1);
    expect(await gate.flush(true)).toEqual({ sent: 1 });
    expect(sink.sent.at(-1)).toMatchObject({
      title: 'Answer ready',
      chatId: 'c3',
      url: 'https://dt.example/chat/c3',
    });
    await gate.notify(n('c4'));
    clock = new Date('2026-09-06T08:00:00Z');
    gate.start(10);
    await new Promise((r) => setTimeout(r, 80));
    gate.stop();
    expect(gate.pendingCount()).toBe(0);
    expect(sink.sent.at(-1)?.chatId).toBe('c4');
  });

  it('ignores a corrupt setting', () => {
    env.repo.setSetting('quiet_hours', '{not json');
    expect(loadQuietHours(env.repo).enabled).toBe(false);
    env.repo.setSetting(
      'quiet_hours',
      JSON.stringify({ enabled: true, start: 'x', timeZone: 'Mars/Olympus' }),
    );
    const q = loadQuietHours(env.repo);
    expect(q).toMatchObject({ enabled: true, start: '22:00', end: '07:30' });
    expect(q.timeZone).not.toBe('Mars/Olympus');
  });
});

describe('quiet hours API', () => {
  const env = tempEnv('dt-digest-api-');
  const brain = new FakeBrain();
  const sink = new Sink();
  let clock = new Date('2026-09-04T23:00:00Z');
  const gate = new DigestGate(env.repo, sink, null, () => clock);
  let app: FastifyInstance;
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const { QueueWorker } = await import('../src/queue/worker.js');
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain, digest: gate });
    await app.ready();
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'correct horse battery', deviceName: 'laptop' },
    });
    token = setup.json().token;
  });
  afterAll(async () => {
    await app.close();
    env.cleanup();
  });

  it('reports, validates and saves quiet hours; disabling releases parked items', async () => {
    let st = (await app.inject({ method: 'GET', url: '/api/status', headers: auth() })).json();
    expect(st.push.quietHours.enabled).toBe(false);
    expect(st.push.pending).toBe(0);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/push/quiet-hours',
      headers: auth(),
      payload: { enabled: true, start: '22:00', end: '7:30', timeZone: 'UTC' },
    });
    expect(bad.statusCode).toBe(400);
    const badTz = await app.inject({
      method: 'PUT',
      url: '/api/push/quiet-hours',
      headers: auth(),
      payload: { enabled: true, start: '22:00', end: '07:30', timeZone: 'Nowhere/Land' },
    });
    expect(badTz.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/push/quiet-hours',
      headers: auth(),
      payload: { enabled: true, start: '22:00', end: '07:30', timeZone: 'UTC' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().quietHours).toEqual({
      enabled: true,
      start: '22:00',
      end: '07:30',
      timeZone: 'UTC',
    });

    await gate.notify(n('c1'));
    st = (await app.inject({ method: 'GET', url: '/api/status', headers: auth() })).json();
    expect(st.push.pending).toBe(1);

    const flushed = await app.inject({
      method: 'POST',
      url: '/api/push/digest/flush',
      headers: auth(),
    });
    expect(flushed.json()).toEqual({ sent: 1 });
    expect(sink.sent).toHaveLength(1);

    await gate.notify(n('c2'));
    clock = new Date('2026-09-04T23:30:00Z');
    const off = await app.inject({
      method: 'PUT',
      url: '/api/push/quiet-hours',
      headers: auth(),
      payload: { enabled: false, start: '22:00', end: '07:30', timeZone: 'UTC' },
    });
    expect(off.json().pending).toBe(0);
    expect(sink.sent).toHaveLength(2);
  });

  it('requires auth', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/push/digest/flush' });
    expect(r.statusCode).toBe(401);
  });
});
