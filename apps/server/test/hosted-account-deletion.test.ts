/**
 * Self-serve account deletion (DELETE /api/account) and the hosted public pages
 * (landing at / for anonymous visitors, /welcome, /privacy, /terms, /delete — ADR 0032).
 * Route tests need the disposable Postgres at DATABASE_URL_TEST (see db-pg.test.ts) and a
 * fake webDist so the PWA-vs-landing behaviour of `/` is observable in both flag states.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { HostedAuth } from '../src/auth/hosted.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { chats, items, todos } from '../src/db/schema.pg.js';
import { QueueWorker } from '../src/queue/worker.js';
import { SecretBox } from '../src/secrets/box.js';
import { FakeBrain, tempEnv } from './helpers.js';

const url = process.env.DATABASE_URL_TEST;
const box = SecretBox.fromKey(randomBytes(32));
const run = randomBytes(4).toString('hex');

const EMAIL = `deleteme-${run}@example.com`;

/** Fake PWA bundle: index.html with a marker the static pages never contain. */
function fakeWebDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dt-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>PWA-MARKER</title>');
  return dir;
}

/** Boot a server against the test Postgres with a given hosted flag and webDist. */
async function boot(opts: { hosted: boolean; webDist: string | null }) {
  process.env.DOUBLETAKE_DATABASE_URL = url as string;
  const keyFile = join(mkdtempSync(join(tmpdir(), 'dt-key-')), 'keyfile');
  writeFileSync(keyFile, randomBytes(32));
  process.env.DOUBLETAKE_MASTER_KEY_FILE = keyFile;
  if (opts.hosted) process.env.DOUBLETAKE_HOSTED = '1';
  else delete process.env.DOUBLETAKE_HOSTED;
  const env = tempEnv('dt-del-');
  const cfg = { ...env.cfg, webDist: opts.webDist };
  const brain = new FakeBrain();
  const worker = new QueueWorker(env.repo, brain, cfg);
  const app = await buildServer({ cfg, repo: env.repo, worker, brain });
  await app.ready();
  return { app, cleanup: env.cleanup, keyFile };
}

describe.skipIf(!url)('DELETE /api/account + hosted public pages (Postgres)', () => {
  let opened: OpenedPgDb;
  let app: FastifyInstance;
  let cleanup: (() => void) | undefined;

  let token = '';
  let uid = '';
  const webDist = fakeWebDist();

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    const booted = await boot({ hosted: true, webDist });
    app = booted.app;
    cleanup = booted.cleanup;

    // Register an account and build a little tenant: item, chat, to-do, credential, 2nd session.
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: EMAIL, password: 'correct horse battery' },
    });
    expect(reg.statusCode).toBe(200);
    token = reg.json<{ token: string }>().token;
    const user = await opened.db.query.users.findFirst({
      where: (t, { eq }) => eq(t.email, EMAIL),
    });
    if (!user) throw new Error('register failed');
    uid = user.id;
    await opened.db.insert(items).values({
      id: `it_del_${run}`,
      platform: 'reddit',
      channel: 'share',
      userId: uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await opened.db.insert(chats).values({
      id: `ch_del_${run}`,
      itemId: `it_del_${run}`,
      userId: uid,
      createdAt: new Date().toISOString(),
    });
    await opened.db.insert(todos).values({
      id: `td_del_${run}`,
      kind: 'task',
      title: 'after deletion this is gone',
      userId: uid,
      createdAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    delete process.env.DOUBLETAKE_DATABASE_URL;
    delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
    await app?.close();
    opened?.close();
    cleanup?.();
  });

  it('serves the static legal pages and the landing to anonymous visitors', async () => {
    const privacy = await app.inject({ method: 'GET', url: '/privacy' });
    expect(privacy.statusCode).toBe(200);
    expect(privacy.headers['content-type']).toContain('text/html');
    expect(privacy.body).toContain('encrypt');
    expect(privacy.body).toContain('deletion');
    expect(privacy.body).toContain('roowus.dev@gmail.com');
    expect(privacy.body).toContain('Google API Services User Data Policy');

    const terms = await app.inject({ method: 'GET', url: '/terms' });
    expect(terms.statusCode).toBe(200);
    expect(terms.body).toContain('as is');
    expect(terms.body).toContain('Governing law');

    const del = await app.inject({ method: 'GET', url: '/delete' });
    expect(del.statusCode).toBe(200);
    expect(del.body).toContain('Delete');
    expect(del.body).toContain('/api/account');

    for (const path of ['/', '/welcome']) {
      const landing = await app.inject({ method: 'GET', url: path });
      expect(landing.statusCode).toBe(200);
      expect(landing.body).toContain('Doubletake');
      expect(landing.body).toContain('/privacy');
    }
  });

  it('serves the PWA at / when a valid session cookie is present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: `dt_session=${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('PWA-MARKER');
  });

  it('deletes the account, cascades everything, and orphans the tokens (401)', async () => {
    // A second session and a sealed credential the cascade must also take.
    const auth = new HostedAuth(opened.db, box);
    const { token: other } = await auth.createSession(uid, 'mcp', 'doomed agent token');
    const credId = await auth.insertCredential({ userId: uid, kind: 'openrouter', key: 'sk-or-x' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });

    expect(
      await opened.db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, uid) }),
    ).toBeUndefined();
    expect(
      await opened.db.query.items.findFirst({ where: (t, { eq }) => eq(t.userId, uid) }),
    ).toBeUndefined();
    expect(
      await opened.db.query.chats.findFirst({ where: (t, { eq }) => eq(t.userId, uid) }),
    ).toBeUndefined();
    expect(
      await opened.db.query.sessions.findFirst({ where: (t, { eq }) => eq(t.userId, uid) }),
    ).toBeUndefined();
    expect(
      await opened.db.query.credentials.findFirst({ where: (t, { eq }) => eq(t.id, credId) }),
    ).toBeUndefined();
    expect(
      await opened.db.query.todos.findFirst({ where: (t, { eq }) => eq(t.userId, uid) }),
    ).toBeUndefined();
    // The token minted a moment before deletion is dead on arrival…
    const stale = await app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { authorization: `Bearer ${other}` },
    });
    expect(stale.statusCode).toBe(401);
    // …and so is the one used to delete.
    const again = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(again.statusCode).toBe(401);
  });
});

describe.skipIf(!url)('hosted pages are inert when DOUBLETAKE_HOSTED is off', () => {
  it('/ serves the PWA as before and /privacy falls back to it', async () => {
    const { app: off, cleanup: tidy } = await boot({ hosted: false, webDist: fakeWebDist() });
    try {
      const root = await off.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('PWA-MARKER');
      const privacy = await off.inject({ method: 'GET', url: '/privacy' });
      // No landing/legal routes registered: the SPA fallback answers, not static HTML.
      expect(privacy.body).toContain('PWA-MARKER');
      expect(privacy.body).not.toContain('roowus.dev@gmail.com');
    } finally {
      delete process.env.DOUBLETAKE_HOSTED;
      delete process.env.DOUBLETAKE_DATABASE_URL;
      delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
      await off.close();
      tidy();
    }
  });
});
