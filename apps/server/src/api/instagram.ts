/** Instagram webhook + `/api/ig/*` routes (docs/channels/instagram-setup.md, ADR 0018). */

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type InstagramChannel,
  verifySignature,
  type WebhookBody,
} from '../channels/instagram/index.js';
import type { Config } from '../config/index.js';

export const IG_PUBLIC_PATHS = ['/api/ig/callback'];
export const IG_WEBHOOK_PATH = '/webhooks/instagram';

/**
 * Only the webhook is meant to be reachable through the public tunnel hostname. When
 * `DOUBLETAKE_WEBHOOK_PUBLIC_HOST` is set, every other path on that host is a 404 so a leaked
 * hostname exposes nothing but a signature-checked endpoint.
 */
export function hostAllowed(cfg: Config, hostHeader: string | undefined, url: string): boolean {
  const pub = cfg.ig.webhookPublicHost;
  if (!pub) return true;
  const host = (hostHeader ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (host !== pub) return true;
  const path = url.split('?')[0] ?? url;
  return path === IG_WEBHOOK_PATH;
}

export interface IgRouteDeps {
  cfg: Config;
  ig: InstagramChannel;
}

export async function registerInstagramRoutes(app: FastifyInstance, deps: IgRouteDeps) {
  const { cfg, ig } = deps;
  // Raw body is needed for the HMAC; keep the parsed JSON too.
  const RAW = Symbol('rawBody');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    (req as unknown as Record<symbol, Buffer>)[RAW] = body;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (e) {
      const err = e as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ---- webhook (public, signature-checked) ----
  app.get(IG_WEBHOOK_PATH, async (req, reply) => {
    const q = z
      .object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      })
      .parse(req.query);
    const ok =
      q['hub.mode'] === 'subscribe' &&
      Boolean(cfg.ig.verifyToken) &&
      q['hub.verify_token'] === cfg.ig.verifyToken;
    if (!ok) return reply.code(403).send({ error: 'verification failed' });
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  app.post(IG_WEBHOOK_PATH, async (req, reply) => {
    const raw = (req as unknown as Record<symbol, Buffer | undefined>)[RAW] ?? Buffer.alloc(0);
    const sig = req.headers['x-hub-signature-256'];
    if (
      !cfg.ig.appSecret ||
      !verifySignature(cfg.ig.appSecret, raw, typeof sig === 'string' ? sig : undefined)
    ) {
      return reply.code(401).send({ error: 'bad signature' });
    }
    const body = (req.body ?? {}) as WebhookBody;
    // Meta wants a fast 200; processing (Graph lookups, ingest) continues after the reply.
    reply.code(200).send({ ok: true });
    ig.handleWebhook(body).then(
      (r) => {
        if (r.handled.length || r.duplicates)
          app.log.info(
            `instagram webhook: ${r.handled.length} handled, ${r.duplicates} duplicate, ${r.ignored} ignored`,
          );
        for (const h of r.handled)
          if (h.error) app.log.warn(`instagram ${h.kind} ${h.id}: ${h.error}`);
      },
      (e: Error) => app.log.error(`instagram webhook failed: ${e.message}`),
    );
    return reply;
  });

  // ---- owner-facing (device token) ----
  app.get('/api/ig/status', async () => ig.status());

  /** Returns the Meta authorize URL; the browser follows it and lands on /api/ig/callback. */
  const oauthStates = new Map<string, number>();
  app.post('/api/ig/connect', async (_req, reply) => {
    if (!ig.configured)
      return reply
        .code(409)
        .send({ error: 'IG_APP_ID / IG_APP_SECRET / IG_WEBHOOK_VERIFY_TOKEN not set' });
    if (!cfg.publicUrl)
      return reply
        .code(409)
        .send({ error: 'DOUBLETAKE_PUBLIC_URL must be set for the OAuth redirect' });
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60_000);
    return { url: ig.authorizeUrl(redirectUri(cfg), state) };
  });

  // Public: Meta redirects the owner's browser here with ?code=…&state=…
  app.get('/api/ig/callback', async (req, reply) => {
    const q = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .parse(req.query);
    const exp = q.state ? oauthStates.get(q.state) : undefined;
    oauthStates.delete(q.state ?? '');
    if (!exp || exp < Date.now())
      return reply.code(400).send({ error: 'invalid or expired state' });
    if (!q.code)
      return reply.code(400).send({ error: q.error_description ?? q.error ?? 'missing code' });
    try {
      await ig.connect(q.code.replace(/#_$/, ''), redirectUri(cfg));
    } catch (e) {
      app.log.error(`instagram connect failed: ${(e as Error).message}`);
      return reply.redirect(
        `/settings?ig=error&message=${encodeURIComponent((e as Error).message)}`,
      );
    }
    return reply.redirect('/settings?ig=connected');
  });

  app.delete('/api/ig/account', async (_req, reply) => {
    ig.disconnect();
    return reply.code(204).send();
  });

  app.post('/api/ig/refresh', async () => ({ refreshed: await ig.refreshIfDue() }));

  app.post('/api/ig/poll', async () => ({ ingested: await ig.pollMentions() }));

  const TestDm = z.object({
    recipientId: z.string().min(1),
    text: z.string().min(1).max(500).default('Doubletake test'),
  });
  app.post('/api/ig/test', async (req) => {
    const b = TestDm.parse(req.body ?? {});
    await ig.sendTestDm(b.recipientId, b.text);
    return { ok: true };
  });

  /** Dev aid: feed a mention/comment change without Meta (still goes through Graph lookups). */
  const Simulate = z.object({ media_id: z.string().optional(), comment_id: z.string().optional() });
  app.post('/api/ig/simulate-mention', async (req) => {
    const b = Simulate.parse(req.body ?? {});
    const value = {
      ...(b.media_id ? { media_id: b.media_id } : {}),
      ...(b.comment_id ? { comment_id: b.comment_id } : {}),
    };
    return ig.handleWebhook({
      object: 'instagram',
      entry: [{ changes: [{ field: 'mentions', value }] }],
    });
  });
}

function redirectUri(cfg: Config): string {
  return `${cfg.publicUrl?.replace(/\/$/, '')}/api/ig/callback`;
}
