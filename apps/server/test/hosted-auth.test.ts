import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { HostedAuth, HostedAuthError, hashToken } from '../src/auth/hosted.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { QueueWorker } from '../src/queue/worker.js';
import { SecretBox } from '../src/secrets/box.js';
import { FakeBrain, tempEnv } from './helpers.js';

// Hosted-mode auth (ADR 0032). Pure-logic tests always run; DB-backed and route tests need a
// disposable Postgres at DATABASE_URL_TEST (see db-pg.test.ts).
const url = process.env.DATABASE_URL_TEST;
const box = SecretBox.fromKey(randomBytes(32));
// Per-run email suffix: the test database persists between runs.
const run = randomBytes(4).toString('hex');

describe('HostedAuth pure logic', () => {
  it('hashes tokens deterministically with sha256 and never stores the raw token', () => {
    const token = `dth_${randomBytes(32).toString('base64url')}`;
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it('seal/open round-trips credential key material', () => {
    const key = 'sk-or-v1-abcdef0123456789';
    const sealed = box.seal(key);
    expect(sealed).not.toContain(key);
    expect(sealed).toMatch(/^v1\./);
    expect(box.open(sealed)).toBe(key);
  });
});

describe.skipIf(!url)('HostedAuth (Postgres)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, box);
  });

  afterAll(async () => {
    opened?.close();
  });

  it('registers a user: argon2id hash stored, email lowercased, password never stored', async () => {
    const user = await auth.registerEmail(`Mixed-${run}@example.com`, 'correct horse battery');
    expect(user.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
    expect(user.email).toBe(`mixed-${run}@example.com`);
    const row = await opened.db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, user.id),
    });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain('correct horse battery');
  });

  it('rejects bad email, short password, and duplicate registration', async () => {
    await expect(auth.registerEmail('not-an-email', 'longenough1')).rejects.toThrow(
      HostedAuthError,
    );
    await expect(auth.registerEmail('x@y.com', 'short')).rejects.toThrow(HostedAuthError);
    await expect(auth.registerEmail(`Mixed-${run}@example.com`, 'another pass 1')).rejects.toThrow(
      'email already registered',
    );
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    expect(await auth.loginEmail(`mixed-${run}@example.com`, 'wrong wrong wrong')).toBeNull();
    const user = await auth.loginEmail(`MIXED-${run}@example.com`, 'correct horse battery');
    expect(user?.email).toBe(`mixed-${run}@example.com`);
  });

  it('mints dth_ sessions, authenticates by hashed lookup, and revokes', async () => {
    const user = await auth.loginEmail(`mixed-${run}@example.com`, 'correct horse battery');
    if (!user) throw new Error('login failed');
    const { token, sessionId } = await auth.createSession(user.id, 'device', 'phone');
    expect(token).toMatch(/^dth_[A-Za-z0-9_-]{43}$/);
    const stored = await opened.db.query.sessions.findFirst({
      where: (t, { eq }) => eq(t.id, sessionId),
    });
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(stored?.tokenHash).not.toBe(token);

    const ctx = await auth.authenticate(token);
    expect(ctx).toMatchObject({ userId: user.id, sessionId, kind: 'device' });
    // last_used_at is touched on authenticate
    const touched = await opened.db.query.sessions.findFirst({
      where: (t, { eq }) => eq(t.id, sessionId),
    });
    expect(touched?.lastUsedAt).not.toBeNull();

    await auth.revokeSession(sessionId);
    expect(await auth.authenticate(token)).toBeNull();
    expect(await auth.authenticate('dth_nope')).toBeNull();
    expect(await auth.authenticate(undefined)).toBeNull();
  });

  it('lists sessions and only the owner sees theirs', async () => {
    const a = await auth.registerEmail(`sessions-a-${run}@example.com`, 'longenough1');
    const b = await auth.registerEmail(`sessions-b-${run}@example.com`, 'longenough1');
    await auth.createSession(a.id, 'browser');
    await auth.createSession(a.id, 'mcp');
    await auth.createSession(b.id, 'browser');
    expect((await auth.listSessions(a.id)).length).toBe(2);
    expect((await auth.listSessions(b.id)).length).toBe(1);
  });

  it('seals credentials, never returns key material, and revocation wipes sealed_key', async () => {
    const user = await auth.registerEmail(`vault-${run}@example.com`, 'longenough1');
    const id = await auth.insertCredential({
      userId: user.id,
      kind: 'openrouter',
      label: 'main',
      key: 'sk-or-v1-secret-value',
      monthlyCapUsd: 20,
    });
    const rows = await auth.listCredentials(user.id);
    const row = rows.find((c) => c.id === id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ kind: 'openrouter', label: 'main', monthlyCapUsd: 20 });
    expect(JSON.stringify(rows)).not.toContain('sk-or-v1-secret-value');
    expect(JSON.stringify(rows)).not.toContain('sealed');

    const raw = await auth.getCredential(id, user.id);
    expect(await auth.openCredential(raw?.sealedKey ?? '')).toBe('sk-or-v1-secret-value');

    // Another user can neither list nor revoke it.
    const other = await auth.registerEmail(`vault-other-${run}@example.com`, 'longenough1');
    expect((await auth.listCredentials(other.id)).find((c) => c.id === id)).toBeUndefined();
    expect(await auth.revokeCredential(other.id, id)).toBe(false);
    expect((await auth.getCredential(id, user.id))?.sealedKey).not.toBe('');

    expect(await auth.revokeCredential(user.id, id)).toBe(true);
    expect((await auth.getCredential(id, user.id))?.sealedKey).toBe('');
    expect((await auth.getCredential(id, user.id))?.revokedAt).not.toBeNull();
  });

  it('oauth states are single-use and expire after the TTL', async () => {
    const state = await auth.createOauthState('google_login');
    expect(await auth.consumeOauthState(state)).not.toBeNull();
    expect(await auth.consumeOauthState(state)).toBeNull(); // single use
    // Backdate a row past the TTL and confirm it is rejected.
    const stale = await auth.createOauthState('google_login');
    await opened.db.execute(
      `UPDATE oauth_states SET created_at = '${new Date(Date.now() - 11 * 60_000).toISOString()}' WHERE state = '${stale}'`,
    );
    expect(await auth.consumeOauthState(stale)).toBeNull();
  });
});

describe.skipIf(!url)('hosted API routes (ADR 0032)', () => {
  let app: FastifyInstance;
  let cleanup: () => void;
  let token = '';
  const key = 'sk-or-v1-route-test-secret';

  beforeAll(async () => {
    process.env.DOUBLETAKE_HOSTED = '1';
    const env = tempEnv('dt-hosted-');
    cleanup = env.cleanup;
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    // createHostedAuthFromEnv reads DOUBLETAKE_DATABASE_URL; point it at the test database and
    // hand it a keyfile so SecretBox.fromKey has 32 bytes.
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const keyFile = join(mkdtempSync(join(tmpdir(), 'dt-key-')), 'keyfile');
    writeFileSync(keyFile, randomBytes(32));
    process.env.DOUBLETAKE_DATABASE_URL = url as string;
    process.env.DOUBLETAKE_MASTER_KEY_FILE = keyFile;
    app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    delete process.env.DOUBLETAKE_DATABASE_URL;
    delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
    await app?.close();
    cleanup?.();
  });

  const authed = () => ({ authorization: `Bearer ${token}` });

  it('all hosted routes are dead when DOUBLETAKE_HOSTED is off (shared gate 401s unknown /api paths)', async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    const off = await buildHostedOffApp();
    for (const [method, path] of [
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/logout'],
      ['GET', '/api/account'],
      ['POST', '/api/account/credentials'],
    ] as const) {
      const res = await off.inject({ method, url: path, payload: {} });
      // The routes are never registered; the shared token gate answers before Fastify's 404.
      expect([401, 404]).toContain(res.statusCode);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
    await off.close();
    process.env.DOUBLETAKE_HOSTED = '1';
  });
  it('register -> login -> account -> credential lifecycle; keys never echoed', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `Route-${run}@test.example`, password: 'longenough1' },
    });
    expect(reg.statusCode).toBe(200);
    token = reg.json().token;
    expect(token).toMatch(/^dth_/);
    expect(reg.body).not.toContain('longenough1');

    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `route-${run}@test.example`, password: 'longenough1' },
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toBe('email already registered');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `route-${run}@test.example`, password: 'longenough1' },
    });
    expect(login.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `route-${run}@test.example`, password: 'wrong wrong wrong' },
    });
    expect(bad.statusCode).toBe(401);

    const add = await app.inject({
      method: 'POST',
      url: '/api/account/credentials',
      headers: authed(),
      payload: { kind: 'openrouter', label: 'route', key, monthly_cap_usd: 10 },
    });
    expect(add.statusCode).toBe(201);
    const credId = add.json().id as string;

    const account = await app.inject({ method: 'GET', url: '/api/account', headers: authed() });
    expect(account.statusCode).toBe(200);
    const body = account.body;
    expect(JSON.parse(body).spend).toEqual({ month_usd: 0 });
    expect(body).not.toContain(key);
    expect(body).not.toContain('sealed_key');
    expect(body).not.toContain('v1.');

    // wrong user cannot revoke someone else's credential: register a second user and try.
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `route2-${run}@test.example`, password: 'longenough1' },
    });
    const secondRes = await app.inject({
      method: 'DELETE',
      url: `/api/account/credentials/${credId}`,
      headers: { authorization: `Bearer ${second.json().token}` },
    });
    expect(secondRes.json().ok).toBe(false);
    const stillThere = await app.inject({ method: 'GET', url: '/api/account', headers: authed() });
    const mine = (
      JSON.parse(stillThere.body).credentials as Array<{ id: string; revokedAt: string | null }>
    ).find((c) => c.id === credId);
    expect(mine).toBeDefined();
    expect(mine?.revokedAt).toBeNull();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/account/credentials/${credId}`,
      headers: authed(),
    });
    expect(del.json().ok).toBe(true);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: authed() });
    expect(logout.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/account', headers: authed() })).statusCode,
    ).toBe(401);
  });
});

async function buildHostedOffApp(): Promise<FastifyInstance> {
  const env = tempEnv('dt-hosted-off-');
  const brain = new FakeBrain();
  const worker = new QueueWorker(env.repo, brain, env.cfg);
  const off = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
  await off.ready();
  off.addHook('onClose', async () => env.cleanup());
  return off;
}
