/**
 * Hosted OAuth flows (ADR 0032): Google sign-in and the OpenRouter PKCE connect. Pure-logic
 * tests always run; route tests need the disposable Postgres at DATABASE_URL_TEST and stub the
 * outbound HTTP (token endpoint, JWKS, OpenRouter key exchange) via `vi.stubGlobal('fetch', ...)`.
 */
import { createPrivateKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { HostedAuth } from '../src/auth/hosted.js';
import {
  createPkcePair,
  GOOGLE_JWKS_URL,
  pkceChallenge,
  safeReturnTo,
  verifyRs256Jwt,
} from '../src/auth/oauth.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { QueueWorker } from '../src/queue/worker.js';
import { SecretBox } from '../src/secrets/box.js';
import { FakeBrain, tempEnv } from './helpers.js';

const url = process.env.DATABASE_URL_TEST;
const box = SecretBox.fromKey(randomBytes(32));
const run = randomBytes(4).toString('hex');

describe('oauth helpers (pure logic)', () => {
  it('pkceChallenge matches the RFC 7636 appendix B vector (S256)', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('createPkcePair produces a >=43-char verifier whose S256 challenge verifies', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(pkceChallenge(verifier));
  });

  it('safeReturnTo only accepts relative paths', () => {
    expect(safeReturnTo('/account')).toBe('/account');
    expect(safeReturnTo('/chats/abc?x=1')).toBe('/chats/abc?x=1');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil')).toBe('/');
    expect(safeReturnTo(undefined, '/fallback')).toBe('/fallback');
  });

  it('verifyRs256Jwt checks signature, aud, exp and iss against a JWKS', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    const stubFetch = vi.fn(async (u: string) => {
      expect(u).toBe(GOOGLE_JWKS_URL);
      return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
    });
    const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sign = (header: unknown, claims: unknown) => {
      const data = `${b64u(header)}.${b64u(claims)}`;
      const sig = createSign('RSA-SHA256')
        .update(data)
        .sign(createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()));
      return `${data}.${Buffer.from(sig).toString('base64url')}`;
    };
    const good = sign(
      { alg: 'RS256', kid: 'test-key' },
      {
        aud: 'client-123',
        exp: Math.floor(Date.now() / 1000) + 300,
        iss: 'https://accounts.google.com',
        sub: 'sub-1',
        email: 'a@example.com',
      },
    );
    const claims = await verifyRs256Jwt(good, GOOGLE_JWKS_URL, {
      aud: 'client-123',
      iss: 'https://accounts.google.com',
      fetchImpl: stubFetch as never,
    });
    expect(claims.sub).toBe('sub-1');
    expect(stubFetch).toHaveBeenCalledTimes(1);

    await expect(
      verifyRs256Jwt(good, GOOGLE_JWKS_URL, { aud: 'other-client', fetchImpl: stubFetch as never }),
    ).rejects.toThrow('audience');
    await expect(
      verifyRs256Jwt(good, GOOGLE_JWKS_URL, {
        aud: 'client-123',
        iss: 'https://evil',
        fetchImpl: stubFetch as never,
      }),
    ).rejects.toThrow('issuer');
    const expired = sign(
      { alg: 'RS256', kid: 'test-key' },
      {
        aud: 'client-123',
        exp: Math.floor(Date.now() / 1000) - 10,
        iss: 'https://accounts.google.com',
      },
    );
    await expect(
      verifyRs256Jwt(expired, GOOGLE_JWKS_URL, {
        aud: 'client-123',
        fetchImpl: stubFetch as never,
      }),
    ).rejects.toThrow('expired');
    // Tampered payload must fail signature verification even with the right aud.
    const forged = `${b64u({ alg: 'RS256', kid: 'test-key' })}.${b64u({ aud: 'client-123', exp: Math.floor(Date.now() / 1000) + 300, sub: 'attacker' })}.${good.split('.')[2]}`;
    await expect(
      verifyRs256Jwt(forged, GOOGLE_JWKS_URL, { aud: 'client-123', fetchImpl: stubFetch as never }),
    ).rejects.toThrow('signature');
    // Known-good token but a JWKS with no matching kid: no matching signing key.
    await expect(
      verifyRs256Jwt(good, GOOGLE_JWKS_URL, {
        aud: 'client-123',
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          json: async () => ({ keys: [{ ...jwk, kid: 'other' }] }),
        })) as never,
      }),
    ).rejects.toThrow('matching signing key');
  });
});

describe.skipIf(!url)('Google sign-in flow (Postgres + stubbed fetch)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let app: FastifyInstance;
  let cleanup: () => void;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...(publicKey.export({ format: 'jwk' }) as Record<string, string>),
    kid: 'k1',
    alg: 'RS256',
  };

  const makeIdToken = (claims: Record<string, unknown>): string => {
    const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${b64u({ alg: 'RS256', kid: 'k1' })}.${b64u(claims)}`;
    const sig = createSign('RSA-SHA256')
      .update(data)
      .sign(createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()));
    return `${data}.${Buffer.from(sig).toString('base64url')}`;
  };

  /** Stub Google token + JWKS endpoints; captures the token-exchange request. */
  const stubGoogle = (idToken: string, opts?: { tokenOk?: boolean }) => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const f = vi.fn(async (u: string, init?: { body?: string }) => {
      calls.push({ url: u, body: init?.body });
      if (u === GOOGLE_JWKS_URL)
        return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
      if (opts?.tokenOk === false) return { ok: false, status: 400, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id_token: idToken }) };
    });
    vi.stubGlobal('fetch', f);
    return calls;
  };

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, box);
    process.env.DOUBLETAKE_HOSTED = '1';
    process.env.DOUBLETAKE_DATABASE_URL = url as string;
    process.env.DOUBLETAKE_PUBLIC_URL = 'https://app.test';
    process.env.GOOGLE_CLIENT_ID = 'client-123';
    process.env.GOOGLE_CLIENT_SECRET = 'secret-123';
    delete process.env.GOOGLE_REDIRECT_URI;
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const keyFile = join(mkdtempSync(join(tmpdir(), 'dt-key-')), 'keyfile');
    writeFileSync(keyFile, randomBytes(32));
    process.env.DOUBLETAKE_MASTER_KEY_FILE = keyFile;
    const env = tempEnv('dt-oauth-');
    cleanup = env.cleanup;
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    await app.ready();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    delete process.env.DOUBLETAKE_DATABASE_URL;
    delete process.env.DOUBLETAKE_PUBLIC_URL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
    await app?.close();
    opened?.close();
    cleanup?.();
  });

  const startGoogle = async (returnTo?: string) => {
    const q = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : '';
    const res = await app.inject({ method: 'GET', url: `/api/auth/google${q}` });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers.location as string);
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(target.searchParams.get('client_id')).toBe('client-123');
    expect(target.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/auth/callback/google',
    );
    expect(target.searchParams.get('scope')).toBe('openid email profile');
    expect(target.searchParams.get('access_type')).toBe('online');
    expect(target.searchParams.get('prompt')).toBe('select_account');
    return target.searchParams.get('state') as string;
  };

  const claimsFor = (sub: string, email: string, emailVerified = true) => ({
    aud: 'client-123',
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: 'https://accounts.google.com',
    sub,
    email,
    email_verified: emailVerified,
  });

  it('callback creates a new user, sets a lax HttpOnly cookie and redirects with the token', async () => {
    const state = await startGoogle('/library');
    stubGoogle(makeIdToken(claimsFor(`sub-${run}-1`, `Google-${run}@example.com`)));
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=authcode`,
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith('/library#dth_token=')).toBe(true);
    const token = loc.split('#dth_token=')[1] as string;
    expect(token).toMatch(/^dth_/);

    const setCookie = res.headers['set-cookie'] as unknown as string | string[];
    const cookie = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookie.length).toBe(1);
    expect(cookie[0]).toContain('dt_session=');
    expect(cookie[0]).toContain('HttpOnly');
    expect(cookie[0]).toContain('SameSite=Lax');
    expect(cookie[0]).toContain('Path=/');
    expect(cookie[0]).not.toContain('Secure'); // localhost/inject host

    const row = await opened.db.query.users.findFirst({
      where: (t, { eq }) => eq(t.googleSub, `sub-${run}-1`),
    });
    expect(row?.email).toBe(`google-${run}@example.com`);
    expect(row?.emailVerifiedAt).not.toBeNull();
    expect(row?.passwordHash).toBeNull();

    // The session works both as bearer and as the dt_session cookie (hosted gate).
    expect((await auth.authenticate(token))?.userId).toBe(row?.id);
    const viaCookie = await app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { cookie: `dt_session=${token}` },
    });
    expect(viaCookie.statusCode).toBe(200);
    const badCookie = await app.inject({
      method: 'GET',
      url: '/api/account',
      headers: { cookie: 'dt_session=dth_nope' },
    });
    expect(badCookie.statusCode).toBe(401);
  });

  it('links google_sub onto an existing email account and verifies the email', async () => {
    const pre = await auth.registerEmail(`Link-${run}@example.com`, 'longenough1');
    expect(pre.emailVerified).toBe(false);
    const state = await startGoogle();
    stubGoogle(makeIdToken(claimsFor(`sub-${run}-2`, `LINK-${run}@example.com`)));
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=c`,
    });
    expect(res.statusCode).toBe(302);
    const row = await opened.db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, pre.id) });
    expect(row?.googleSub).toBe(`sub-${run}-2`);
    expect(row?.emailVerifiedAt).not.toBeNull();
    // Exactly one user with that email: linked, not duplicated.
    const all = await opened.db.query.users.findMany({
      where: (t, { eq }) => eq(t.email, `link-${run}@example.com`),
    });
    expect(all.length).toBe(1);
  });

  it('logs in an existing google_sub without creating a second user', async () => {
    const state = await startGoogle();
    stubGoogle(makeIdToken(claimsFor(`sub-${run}-1`, `Google-${run}@example.com`)));
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=c`,
    });
    expect(res.statusCode).toBe(302);
    const all = await opened.db.query.users.findMany({
      where: (t, { eq }) => eq(t.googleSub, `sub-${run}-1`),
    });
    expect(all.length).toBe(1);
  });

  it('state is single-use: the second callback fails', async () => {
    const state = await startGoogle();
    stubGoogle(makeIdToken(claimsFor(`sub-${run}-1`, `Google-${run}@example.com`)));
    const first = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=c`,
    });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).not.toContain('error=');
    const second = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=c`,
    });
    expect(second.statusCode).toBe(302);
    expect(second.headers.location).toContain('error=');
    expect(second.headers['set-cookie']).toBeUndefined();
  });

  it('wrong state fails and TTL-expired state fails', async () => {
    const wrong = await app.inject({
      method: 'GET',
      url: '/api/auth/callback/google?state=does-not-exist&code=c',
    });
    expect(wrong.statusCode).toBe(302);
    expect(wrong.headers.location).toContain('error=');

    const stale = await auth.createOauthState('google_login', { returnTo: '/' });
    await opened.db.execute(
      `UPDATE oauth_states SET created_at = '${new Date(Date.now() - 11 * 60_000).toISOString()}' WHERE state = '${stale}'`,
    );
    stubGoogle(makeIdToken(claimsFor('sub-stale', 'stale@example.com')));
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${stale}&code=c`,
    });
    expect(res.headers.location).toContain('error=');
    expect(
      await opened.db.query.users.findFirst({ where: (t, { eq }) => eq(t.googleSub, 'sub-stale') }),
    ).toBeUndefined();
  });

  it('unverifiable id_token (bad signature / wrong aud) never signs anyone in', async () => {
    const state = await startGoogle();
    // Signed for a different audience than GOOGLE_CLIENT_ID.
    stubGoogle(makeIdToken({ ...claimsFor('sub-bad', 'bad@example.com'), aud: 'other-app' }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/google?state=${state}&code=c`,
    });
    expect(res.headers.location).toContain('error=');
    expect(res.body).not.toContain('JWKS');
    expect(
      await opened.db.query.users.findFirst({ where: (t, { eq }) => eq(t.googleSub, 'sub-bad') }),
    ).toBeUndefined();
  });

  it('malicious return_to is reduced to / before the redirect', async () => {
    const state = await startGoogle('https://evil.example');
    const row = await opened.db.query.oauthStates.findFirst({
      where: (t, { eq }) => eq(t.state, state),
    });
    expect(row?.returnTo).toBe('/');
  });
});

describe.skipIf(!url)('OpenRouter PKCE connect (Postgres + stubbed fetch)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let app: FastifyInstance;
  let cleanup: () => void;
  let token = '';
  let appBox: SecretBox;
  const runId = randomBytes(4).toString('hex');
  const orKey = 'sk-or-v1-oauth-test-key';

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, box);
    process.env.DOUBLETAKE_HOSTED = '1';
    process.env.DOUBLETAKE_DATABASE_URL = url as string;
    process.env.DOUBLETAKE_PUBLIC_URL = 'https://app.test';
    delete process.env.OPENROUTER_REDIRECT_URI;
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const keyFile = join(mkdtempSync(join(tmpdir(), 'dt-key-')), 'keyfile');
    writeFileSync(keyFile, randomBytes(32));
    process.env.DOUBLETAKE_MASTER_KEY_FILE = keyFile;
    // The app's hosted stack builds its own box from that keyfile; use the same one to open.
    appBox = SecretBox.fromKey(readFileSync(keyFile));
    const env = tempEnv('dt-or-');
    cleanup = env.cleanup;
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    app = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    await app.ready();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `or-${runId}@test.example`, password: 'longenough1' },
    });
    token = reg.json().token as string;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    delete process.env.DOUBLETAKE_DATABASE_URL;
    delete process.env.DOUBLETAKE_PUBLIC_URL;
    delete process.env.DOUBLETAKE_MASTER_KEY_FILE;
    await app?.close();
    opened?.close();
    cleanup?.();
  });

  it('anonymous requests are rejected by the gate before the route exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/openrouter' });
    expect(res.statusCode).toBe(401);
  });

  it('start creates a PKCE state row bound to the user and redirects with S256 params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/openrouter?return_to=%2Faccount',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers.location as string);
    expect(target.origin + target.pathname).toBe('https://openrouter.ai/auth');
    expect(target.searchParams.get('callback_url')).toBe(
      'https://app.test/api/auth/callback/openrouter',
    );
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = target.searchParams.get('code_challenge') as string;
    const state = target.searchParams.get('state') as string;
    const row = await opened.db.query.oauthStates.findFirst({
      where: (t, { eq }) => eq(t.state, state),
    });
    expect(row?.purpose).toBe('openrouter_connect');
    expect(row?.userId).not.toBeNull();
    expect(row?.returnTo).toBe('/account');
    expect(row?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(pkceChallenge(row?.codeVerifier as string)).toBe(challenge);
  });

  it('callback exchanges the code with the stored verifier and seals the key', async () => {
    // Start a flow to plant a state row.
    const start = await app.inject({
      method: 'GET',
      url: '/api/auth/openrouter',
      headers: { authorization: `Bearer ${token}` },
    });
    const target = new URL(start.headers.location as string);
    const state = target.searchParams.get('state') as string;
    const row = await opened.db.query.oauthStates.findFirst({
      where: (t, { eq }) => eq(t.state, state),
    });

    let sent: { url: string; body: string } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init?: { body?: string }) => {
        sent = { url: u, body: init?.body ?? '' };
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: orKey, data: { name: 'My Hosted Key' } }),
        };
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/openrouter?state=${state}&code=or-auth-code`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/account?connected=openrouter#connected=openrouter');

    // Exchange hit OpenRouter with the stored verifier, bound to the state row's user.
    expect(sent?.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    const body = JSON.parse(sent?.body ?? '{}') as {
      code: string;
      code_verifier: string;
      code_challenge_method: string;
    };
    expect(body.code).toBe('or-auth-code');
    expect(body.code_verifier).toBe(row?.codeVerifier);
    expect(body.code_challenge_method).toBe('S256');

    // Credential exists, sealed; key material never in the response, redirect or storage.
    const creds = await auth.listCredentials(row?.userId as string);
    const cred = creds.find((c) => c.kind === 'openrouter' && c.label === 'My Hosted Key');
    expect(cred).toBeDefined();
    const raw = await auth.getCredential(cred?.id as string, row?.userId as string);
    expect(raw?.sealedKey).not.toContain(orKey);
    expect(raw?.sealedKey).toMatch(/^v1\./);
    expect(await appBox.open(raw?.sealedKey as string)).toBe(orKey);
    expect(res.body).not.toContain(orKey);
    expect(res.headers.location).not.toContain('sk-or-');
  });

  it('callback rejects unknown state, foreign purpose, and never echoes the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ key: orKey }) })),
    );
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/auth/callback/openrouter?state=nope&code=c',
    });
    expect(unknown.statusCode).toBe(302);
    expect(unknown.headers.location).toContain('error=');
    expect(unknown.body).not.toContain(orKey);

    // A google_login state row must not be usable on the OpenRouter callback.
    const gstate = await auth.createOauthState('google_login');
    const mismatch = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/openrouter?state=${gstate}&code=c`,
    });
    expect(mismatch.headers.location).toContain('error=');
  });

  it('state is single-use on the OpenRouter callback too', async () => {
    const start = await app.inject({
      method: 'GET',
      url: '/api/auth/openrouter',
      headers: { authorization: `Bearer ${token}` },
    });
    const state = new URL(start.headers.location as string).searchParams.get('state') as string;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ key: 'sk-or-v1-second' }),
      })),
    );
    const first = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/openrouter?state=${state}&code=c`,
    });
    expect(first.headers.location).toContain('connected=openrouter');
    const second = await app.inject({
      method: 'GET',
      url: `/api/auth/callback/openrouter?state=${state}&code=c`,
    });
    expect(second.headers.location).toContain('error=');
  });
});

describe.skipIf(!url)('oauth routes are inert when DOUBLETAKE_HOSTED is off', () => {
  it('flag off: shared gate 401s the hosted-only oauth paths', async () => {
    delete process.env.DOUBLETAKE_HOSTED;
    const env = tempEnv('dt-oauth-off-');
    const brain = new FakeBrain();
    const worker = new QueueWorker(env.repo, brain, env.cfg);
    const off = await buildServer({ cfg: env.cfg, repo: env.repo, worker, brain });
    await off.ready();
    try {
      for (const path of [
        '/api/auth/google',
        '/api/auth/callback/google',
        '/api/auth/callback/openrouter',
      ]) {
        const res = await off.inject({ method: 'GET', url: path });
        expect([401, 404]).toContain(res.statusCode);
      }
      // Even with an anonymous-start route registered nowhere, /api/auth/openrouter stays gated.
      const res = await off.inject({ method: 'GET', url: '/api/auth/openrouter' });
      expect(res.statusCode).toBe(401);
    } finally {
      await off.close();
      env.cleanup();
    }
  });
});
