/**
 * Hosted-mode account + BYOK routes (ADR 0032). Registered only when hosted mode is on
 * (`DOUBLETAKE_HOSTED=1`) and a `HostedAuth` was built — otherwise this is a no-op and the
 * paths answer 404, so the self-hosted surface is unchanged byte-for-byte. Authentication is
 * shared with the server-wide gate in server.ts (`dth_` bearer tokens); these routes never log
 * or echo key material, and credential listings never include `sealed_key`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type HostedAuth, HostedAuthError } from '../auth/hosted.js';

/** Hosted-only paths the server-wide token gate lets through unauthenticated. */
export const HOSTED_PUBLIC_PATHS = new Set(['/api/auth/register', '/api/auth/login']);

export function isHostedMode(): boolean {
  return process.env.DOUBLETAKE_HOSTED === '1';
}

const RegisterBody = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().max(100).optional(),
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
    const user = await hosted.registerEmail(body.email, body.password);
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
}

export { SessionKind };
