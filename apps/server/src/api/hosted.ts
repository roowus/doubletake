/**
 * Hosted-mode account + BYOK routes (ADR 0032). Registered only when hosted mode is on
 * (`DOUBLETAKE_HOSTED=1`) and a `HostedAuth` was built — otherwise this is a no-op and the
 * paths answer 404, so the self-hosted surface is unchanged byte-for-byte. Authentication is
 * shared with the server-wide gate in server.ts (`dth_` bearer tokens); these routes never log
 * or echo key material, and credential listings never include `sealed_key`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type HostedAuth, HostedAuthError } from '../auth/hosted.js';
import {
  createPkcePair,
  type FetchLike,
  GOOGLE_AUTH_URL,
  GOOGLE_ISSUER,
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
  OauthFlowError,
  OPENROUTER_AUTH_URL,
  OPENROUTER_KEYS_URL,
  safeReturnTo,
  verifyRs256Jwt,
} from '../auth/oauth.js';

/** Hosted-only paths the server-wide token gate lets through unauthenticated. */
export const HOSTED_PUBLIC_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
  // OAuth start + callbacks (ADR 0032): the state parameter is the proof, not a bearer token.
  '/api/auth/google',
  '/api/auth/callback/google',
  '/api/auth/callback/openrouter',
]);

/** Name of the hosted browser-session cookie (same `dth_` token, cookie transport). */
export const HOSTED_SESSION_COOKIE = 'dt_session';

function hostedFetch(): FetchLike {
  return fetch as unknown as FetchLike;
}

/** Redirect to a validated relative target with a user-safe `#error=` fragment. */
function oauthFailure(reply: FastifyReply, returnTo: string, message: string) {
  return reply.code(302).redirect(`${returnTo}#error=${encodeURIComponent(message)}`);
}

function isLocalHost(host: string | undefined): boolean {
  return host !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** `dt_session` cookie for a freshly minted hosted session; Secure off for localhost dev. */
function sessionCookie(token: string, req: FastifyRequest): string {
  const secure = !isLocalHost(req.headers.host);
  return `${HOSTED_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
}

/** Hand-rolled single-cookie lookup (no parser dependency): `name=value` among `; `-pairs. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

export function isHostedMode(): boolean {
  return process.env.DOUBLETAKE_HOSTED === '1';
}

const RegisterBody = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().max(100).optional(),
  /** Required when the server sets DOUBLETAKE_INVITE_CODE (first user bootstraps without one). */
  invite_code: z.string().max(200).optional(),
});

const LoginBody = z.object({ email: z.string().min(3).max(254), password: z.string() });

const CredentialBody = z.object({
  kind: z.enum(['openrouter', 'api_key', 'harness']),
  provider: z.string().max(60).optional(),
  label: z.string().max(120).optional(),
  key: z.string().min(1).max(8000),
  base_url: z.string().url().max(500).optional(),
  monthly_cap_usd: z.number().nonnegative().optional(),
  per_run_cap_usd: z.number().nonnegative().optional(),
});

const SessionKind = z.enum(['browser', 'device', 'mcp']);

export function registerHostedRoutes(app: FastifyInstance, hosted: HostedAuth | undefined): void {
  if (!isHostedMode() || !hosted) return;
  // The server-wide gate stores the hosted auth context on `req.hosted` for `dth_` tokens.
  const requireUser = (req: FastifyRequest): string => {
    const userId = (req as FastifyRequest & { hosted?: { userId: string } }).hosted?.userId;
    if (!userId) throw new HostedAuthError('not authenticated');
    return userId;
  };

  app.post('/api/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const user = await hosted.registerEmail(body.email, body.password, body.invite_code);
    const { token } = await hosted.createSession(user.id, 'browser', body.displayName);
    return reply
      .code(200)
      .send({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await hosted.loginEmail(body.email, body.password);
    if (!user) return reply.code(401).send({ error: 'invalid email or password' });
    const { token } = await hosted.createSession(user.id, 'browser');
    return reply
      .code(200)
      .send({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  });

  app.post('/api/auth/logout', async (req) => {
    const ctx = (req as FastifyRequest & { hosted?: { sessionId: string } }).hosted;
    if (ctx?.sessionId) await hosted.revokeSession(ctx.sessionId);
    return { ok: true };
  });

  app.get('/api/account', async (req) => {
    const userId = requireUser(req);
    const [creds, sessions] = await Promise.all([
      hosted.listCredentials(userId),
      hosted.listSessions(userId),
    ]);
    return {
      credentials: creds,
      sessions: sessions.map((s) => ({
        id: s.id,
        kind: s.kind,
        label: s.label,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        revokedAt: s.revokedAt,
      })),
      // Spend accounting joins cost_ledger per user; placeholder until the hosted run loop lands.
      spend: { month_usd: 0 },
    };
  });

  app.post('/api/account/credentials', async (req, reply) => {
    const userId = requireUser(req);
    const body = CredentialBody.parse(req.body);
    const id = await hosted.insertCredential({
      userId,
      kind: body.kind,
      key: body.key,
      provider: body.provider ?? null,
      label: body.label ?? null,
      baseUrl: body.base_url ?? null,
      monthlyCapUsd: body.monthly_cap_usd ?? null,
      perRunCapUsd: body.per_run_cap_usd ?? null,
    });
    return reply.code(201).send({ id });
  });

  app.delete('/api/account/credentials/:id', async (req) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const ok = await hosted.revokeCredential(userId, id);
    return { ok };
  });

  app.post('/api/account/sessions/:id/revoke', async (req) => {
    const userId = requireUser(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const owned = await hosted.listSessions(userId);
    if (!owned.some((s) => s.id === id)) return { ok: false };
    await hosted.revokeSession(id);
    return { ok: true };
  });

  // ---- OAuth flows (ADR 0032) ----
  // `return_to` is always validated to a relative path; failures redirect with `#error=` in
  // user-safe wording. OAuth state rows carry identity (Google) or the PKCE verifier
  // (OpenRouter), so callback query parameters are never trusted for either.

  const publicUrl = () => process.env.DOUBLETAKE_PUBLIC_URL ?? '';
  const googleRedirectUri = () =>
    process.env.GOOGLE_REDIRECT_URI ?? `${publicUrl()}/api/auth/callback/google`;
  const openrouterRedirectUri = () =>
    process.env.OPENROUTER_REDIRECT_URI ?? `${publicUrl()}/api/auth/callback/openrouter`;

  app.get('/api/auth/google', async (req, reply) => {
    const returnTo = safeReturnTo((req.query as { return_to?: string }).return_to);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET)
      return oauthFailure(reply, returnTo, 'google sign-in is not configured');
    const state = await hosted.createOauthState('google_login', { returnTo });
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', googleRedirectUri());
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    return reply.code(302).redirect(url.toString());
  });

  app.get('/api/auth/callback/google', async (req, reply) => {
    const q = req.query as { state?: string; code?: string; error?: string };
    const row = q.state ? await hosted.consumeOauthState(q.state) : null;
    const returnTo = safeReturnTo(row?.returnTo ?? undefined);
    try {
      if (q.error) return oauthFailure(reply, returnTo, 'google sign-in was cancelled');
      if (row?.purpose !== 'google_login' || !q.code)
        return oauthFailure(reply, returnTo, 'invalid or expired sign-in state');
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret)
        return oauthFailure(reply, returnTo, 'google sign-in is not configured');
      const tokenRes = await hostedFetch()(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          redirect_uri: googleRedirectUri(),
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });
      if (!tokenRes.ok) return oauthFailure(reply, returnTo, 'could not complete google sign-in');
      const tokens = (await tokenRes.json()) as { id_token?: string };
      if (typeof tokens.id_token !== 'string')
        return oauthFailure(reply, returnTo, 'could not complete google sign-in');
      // RS256 verified against Google's JWKS with aud/exp/iss checks (auth/oauth.ts).
      const claims = await verifyRs256Jwt(tokens.id_token, GOOGLE_JWKS_URL, {
        aud: clientId,
        iss: GOOGLE_ISSUER,
        fetchImpl: hostedFetch(),
      });
      const sub = claims.sub;
      const email = claims.email;
      if (typeof sub !== 'string' || typeof email !== 'string')
        return oauthFailure(reply, returnTo, 'google account has no usable email');
      const user = await hosted.resolveGoogleUser({
        sub,
        email,
        emailVerified: claims.email_verified === true,
      });
      const { token } = await hosted.createSession(user.id, 'browser', 'google');
      reply.header('set-cookie', sessionCookie(token, req));
      return reply.code(302).redirect(`${returnTo}#dth_token=${encodeURIComponent(token)}`);
    } catch (e) {
      // Never leak token-exchange or verification internals to the browser.
      if (e instanceof HostedAuthError) return oauthFailure(reply, returnTo, e.message);
      if (e instanceof OauthFlowError)
        return oauthFailure(reply, returnTo, 'google sign-in failed');
      return oauthFailure(reply, returnTo, 'google sign-in failed');
    }
  });

  app.get('/api/auth/openrouter', async (req, reply) => {
    const userId = requireUser(req);
    const returnTo = safeReturnTo(
      (req.query as { return_to?: string }).return_to,
      '/account?connected=openrouter',
    );
    const { verifier, challenge } = createPkcePair();
    const state = await hosted.createOauthState('openrouter_connect', {
      userId,
      returnTo,
      codeVerifier: verifier,
    });
    const url = new URL(OPENROUTER_AUTH_URL);
    url.searchParams.set('callback_url', openrouterRedirectUri());
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    return reply.code(302).redirect(url.toString());
  });

  app.get('/api/auth/callback/openrouter', async (req, reply) => {
    const q = req.query as { state?: string; code?: string; error?: string };
    const row = q.state ? await hosted.consumeOauthState(q.state) : null;
    const fallbackTo = '/account?connected=openrouter';
    try {
      if (q.error) return oauthFailure(reply, fallbackTo, 'openrouter connection was cancelled');
      // Identity comes from the state row (bound at /api/auth/openrouter), never from the query.
      if (row?.purpose !== 'openrouter_connect' || !row.userId || !q.code || !row.codeVerifier)
        return oauthFailure(reply, fallbackTo, 'invalid or expired connection state');
      const keyRes = await hostedFetch()(OPENROUTER_KEYS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: q.code,
          code_verifier: row.codeVerifier,
          code_challenge_method: 'S256',
        }),
      });
      if (!keyRes.ok) return oauthFailure(reply, fallbackTo, 'could not connect openrouter');
      const data = (await keyRes.json()) as { key?: string; data?: { name?: string } };
      if (typeof data.key !== 'string' || !data.key.startsWith('sk-or-'))
        return oauthFailure(reply, fallbackTo, 'openrouter did not return a key');
      // The key is sealed straight into the vault; it never appears in a log, error or URL.
      await hosted.insertCredential({
        userId: row.userId,
        kind: 'openrouter',
        key: data.key,
        label: typeof data.data?.name === 'string' ? data.data.name : null,
      });
      return reply.code(302).redirect(`${row.returnTo ?? fallbackTo}#connected=openrouter`);
    } catch {
      return oauthFailure(reply, fallbackTo, 'could not connect openrouter');
    }
  });
}

export { SessionKind };
