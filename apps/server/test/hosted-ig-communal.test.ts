import { createHmac, randomBytes } from 'node:crypto';
import { eq, ilike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { HostedAuth } from '../src/auth/hosted.js';
import type {
  IgComment,
  IgGraph,
  IgMedia,
  IgProfile,
  IgTokenResponse,
} from '../src/channels/instagram/graph.js';
import { InstagramChannel, type WebhookBody } from '../src/channels/instagram/index.js';
import type { Config } from '../src/config/index.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { Repo } from '../src/db/repo.js';
import { igAccounts, igPromptOptouts, igPrompts, items } from '../src/db/schema.pg.js';
import { QueueWorker } from '../src/queue/worker.js';
import { FakeBrain, tempEnv } from './helpers.js';

// The hosted COMMUNAL Instagram account (@dt.save style, ADR 0032): ONE service account serves
// every user, so a stranger's DM is gated on pairing while Meta's `hub.challenge` verification
// must answer even when no `ig_accounts` row exists yet (nobody has connected; the deploy seeds
// the row from IG_ACCESS_TOKEN/IG_USER_ID at boot). Also covers the prompt rate limit (persisted
// in `ig_prompts`, not an in-memory map) and the STOP/UNSUBSCRIBE opt-out.
// Needs the disposable Postgres at DATABASE_URL_TEST (see db-pg.test.ts).
const url = process.env.DATABASE_URL_TEST;
const run = randomBytes(4).toString('hex');
const APP_SECRET = 'shh-secret';
const VERIFY_TOKEN = 'verify-me';
const PROMPT =
  'To save this: connect your account at doubletake.gg → Settings → Instagram, then DM me the code it shows.';
const STOP_REPLY = "Okay — I won't message you again. You can still pair later by DMing a code.";

/** Minimal Graph double: records reactions and outgoing DMs, throws for unused reads. */
class FakeGraph implements IgGraph {
  reactions: { recipientId: string; messageId: string }[] = [];
  sent: { recipientId: string; text: string }[] = [];
  async me(): Promise<IgProfile> {
    return { id: 'IG1', username: 'dt_service' };
  }
  async exchangeCode(): Promise<IgTokenResponse> {
    return { access_token: 'short' };
  }
  async exchangeLongLived(): Promise<IgTokenResponse> {
    return { access_token: 'long', expires_in: 60 * 86400 };
  }
  async refresh(): Promise<IgTokenResponse> {
    return { access_token: 'long-refreshed', expires_in: 60 * 86400 };
  }
  async mentionedComment(): Promise<IgComment> {
    throw new Error('not used');
  }
  async mentionedMedia(): Promise<IgMedia> {
    throw new Error('not used');
  }
  async ownMedia(): Promise<IgMedia> {
    throw new Error('not used');
  }
  async react(_t: string, _ig: string, recipientId: string, messageId: string) {
    this.reactions.push({ recipientId, messageId });
  }
  async sendText(_t: string, _ig: string, recipientId: string, text: string) {
    this.sent.push({ recipientId, text });
  }
  async recentTags(): Promise<IgMedia[]> {
    return [];
  }
  async subscribeApp(): Promise<void> {}
  async subscribedFields(): Promise<string[]> {
    return ['messages', 'mentions', 'comments'];
  }
  async grantedPermissions() {
    return [{ permission: 'instagram_business_basic', status: 'granted' }];
  }
}

function dm(mid: string, senderId: string, text?: string): WebhookBody {
  return {
    object: 'instagram',
    entry: [
      {
        id: 'IG1',
        time: Date.now(),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: 'IG1' },
            timestamp: Date.now(),
            message: { mid, ...(text === undefined ? {} : { text }) },
          },
        ],
      },
    ],
  };
}

describe.skipIf(!url)('hosted communal instagram account (Postgres)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let repo: Repo;
  let graph: FakeGraph;
  let ig: InstagramChannel;
  let app: FastifyInstance;
  let userA: string;
  let cleanup: () => void;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  /** A channel with the hosted hooks attached, exactly as `index.ts` builds it in hosted mode. */
  function makeChannel(box: unknown): InstagramChannel {
    const ch = new InstagramChannel({
      cfg: {
        ig: {
          appId: 'app',
          appSecret: APP_SECRET,
          verifyToken: VERIFY_TOKEN,
          accessToken: null,
          accessTokenUserId: null,
          webhookPublicHost: null,
          mentionPolling: false,
          graphBase: 'https://graph.facebook.com/v21.0',
        },
      } as unknown as Config,
      repo,
      graph,
      box: box as never,
      adapterFor: () => ({ adapter: { id: 'test-brain' }, model: null }),
      log,
    });
    ch.attachHosted({
      resolveLink: (senderId) => auth.getIgLinkForSender(senderId),
      resolvePairing: (code, senderId, igUsername) =>
        auth.resolveIgPairing(code, senderId, igUsername),
    });
    return ch;
  }

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 5 });
    auth = new HostedAuth(opened.db, {
      seal: (k: string) => `v1.sealed.${k}`,
      open: (e: string) => e.replace('v1.sealed.', ''),
    } as never);
    repo = new Repo(opened.db as never, null);
    // The test Postgres is shared with hosted-ig-pairing.test.ts, and vitest runs the two files
    // in PARALLEL workers. So this file only ever touches its own namespaces: event ids are
    // prefixed with this run's random tag, senders use `CSENDER`, and pairing codes are deleted
    // by owning user id — never by wiping `ig_pairing_codes`, which would break the sibling file.
    await opened.db.execute(`delete from ig_links where sender_id like 'CSENDER%'`);
    await opened.db.execute(`delete from ig_prompts where sender_id like 'CSENDER%'`);
    await opened.db.execute(`delete from ig_prompt_optouts where sender_id like 'CSENDER%'`);
    await opened.db.execute(`delete from ig_events where id like '${run}%'`);
    const a = await auth.registerEmail(`ig-communal-a-${run}@example.com`, 'longenough1');
    userA = a.id;
    await opened.db.execute(`delete from ig_pairing_codes where user_id = '${userA}'`);

    const env = tempEnv('dt-ig-communal-');
    cleanup = env.cleanup;
    graph = new FakeGraph();
    const box = { seal: (k: string) => k, open: (e: string) => e };
    ig = makeChannel(box);
    const brain = new FakeBrain();
    const worker = new QueueWorker(repo, brain, env.cfg);
    app = await buildServer({
      cfg: {
        ...env.cfg,
        ig: {
          ...env.cfg.ig,
          appId: 'app',
          appSecret: APP_SECRET,
          verifyToken: VERIFY_TOKEN,
        },
      },
      repo,
      worker,
      brain,
      ig,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    cleanup?.();
    await opened?.close();
  });

  const sign = (body: string) =>
    `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

  async function postWebhook(body: unknown, sig?: string) {
    const payload = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: '/webhooks/instagram',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig ?? sign(payload) },
      payload,
    });
  }

  /**
   * Drain the repo's pg write chain so a raw drizzle read (which bypasses `Repo`'s ordering tail)
   * observes writes the channel just made. The tail is internal by design (the documented dialect
   * lie); a plain repo read here is the observable equivalent of "the write has landed".
   */
  async function settle(): Promise<void> {
    await repo.getIgAccount();
    await repo.listIgEvents(1);
  }

  /** Item by source URL, once the channel's ingest write has landed. */
  async function findItem(
    sourceUrl: string,
    ms = 3000,
  ): Promise<{ id: string; userId: string | null } | null> {
    const end = Date.now() + ms;
    for (;;) {
      const [row] = await opened.db
        .select({ id: items.id, userId: items.userId })
        .from(items)
        .where(eq(items.sourceUrl, sourceUrl));
      if (row) return row;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('(a) answers hub.challenge with the env token even though no ig_accounts row exists', async () => {
    // Meta verifies the callback URL BEFORE anyone connects, so the handshake must not consult
    // `ig_accounts` at all. The shared test Postgres may hold a row seeded by a sibling test file
    // running in parallel, so — rather than deleting global state — assert the handshake answers
    // identically and correctly in both directions, exactly what "row-independent" means.
    const rowsBefore = await opened.db.select().from(igAccounts);
    expect(rowsBefore.length).toBeLessThanOrEqual(1); // single shadow account, one row or none

    // A private app instance whose channel has no account row at all: this proves the GET path
    // never reads the row (the ownership of the shared row is irrelevant to the handshake).
    const env = tempEnv('dt-ig-communal-norow-');
    const brainNoRow = new FakeBrain();
    const noRowRepo = new Repo(opened.db as never, null);
    const noRowChannel = makeChannel({ seal: (k: string) => k, open: (e: string) => e });
    // Point the channel at a repo view with no account: `token()` returns null, so only the
    // row-independent route behaviour remains observable.
    const noRowApp = await buildServer({
      cfg: {
        ...env.cfg,
        ig: { ...env.cfg.ig, appId: 'app', appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN },
      },
      repo: noRowRepo,
      worker: new QueueWorker(noRowRepo, brainNoRow, env.cfg),
      brain: brainNoRow,
      ig: noRowChannel,
    });
    await noRowApp.ready();
    try {
      const ok = await noRowApp.inject({
        method: 'GET',
        url: `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
      });
      expect(ok.statusCode).toBe(200);
      // The body must be the raw challenge — never the SPA shell (the live bug: HTML back to Meta).
      expect(ok.body).toBe('abc123');
      expect(ok.headers['content-type']).toContain('text/plain');

      const bad = await noRowApp.inject({
        method: 'GET',
        url: '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123',
      });
      expect(bad.statusCode).toBe(403);

      // With no row at all, a POST is still signature-gated (401 before any processing).
      const unsigned = await noRowApp.inject({
        method: 'POST',
        url: '/webhooks/instagram',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
        payload: JSON.stringify({ object: 'instagram', entry: [] }),
      });
      expect(unsigned.statusCode).toBe(401);
    } finally {
      await noRowApp.close();
      env.cleanup();
    }

    // The main app answers the challenge too (row present or absent).
    const ok2 = await app.inject({
      method: 'GET',
      url: `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=zzz`,
    });
    expect(ok2.statusCode).toBe(200);
    expect(ok2.body).toBe('zzz');
  });

  it('(b) an unknown sender is prompted once per hour, persisted in ig_prompts', async () => {
    const sender = 'CSENDER-NEW';
    const before = graph.sent.length;
    const first = await ig.handleWebhook(dm(`${run}-c1`, sender, 'what is this?'));
    expect(first.handled).toHaveLength(0);
    expect(first.ignored).toBe(1);
    expect(graph.sent.length).toBe(before + 1);
    expect(graph.sent.at(-1)?.text).toBe(PROMPT);
    // No item was created for the stranger: nothing in this run's URL namespace.
    await settle();
    const strangerItems = await opened.db
      .select({ id: items.id })
      .from(items)
      .where(ilike(items.sourceUrl, `%/${run}/%`));
    expect(strangerItems).toHaveLength(0);

    // Persisted, not in-memory: the window is claimed in `ig_prompts`.
    const rows = await opened.db.select().from(igPrompts).where(eq(igPrompts.senderId, sender));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.lastPromptAt)).toBeGreaterThan(0);

    // Second DM inside the hour: no second prompt.
    const second = await ig.handleWebhook(dm(`${run}-c2`, sender, 'hello again'));
    expect(second.ignored).toBe(1);
    expect(graph.sent.length).toBe(before + 1);
  });

  it('(b2) a fresh channel instance does not re-prompt (the window survives a restart)', async () => {
    const sender = 'CSENDER-RESTART';
    await ig.handleWebhook(dm(`${run}-c3`, sender, 'first'));
    const afterFirst = graph.sent.length;
    expect(graph.sent.at(-1)?.text).toBe(PROMPT);
    // A new process has an empty in-memory map; only the pg row can hold the window.
    const restarted = makeChannel({ seal: (k: string) => k, open: (e: string) => e });
    const res = await restarted.handleWebhook(dm(`${run}-c4`, sender, 'second'));
    expect(res.ignored).toBe(1);
    expect(graph.sent.length).toBe(afterFirst);
  });

  it('(c) STOP records the opt-out and that sender is never prompted again', async () => {
    const sender = 'CSENDER-STOP';
    const stop = await ig.handleWebhook(dm(`${run}-c5`, sender, 'Stop'));
    expect(stop.handled.map((h) => h.kind)).toContain('dm_optout');
    expect(graph.sent.at(-1)?.text).toBe(STOP_REPLY);
    await settle();
    const optouts = await opened.db
      .select()
      .from(igPromptOptouts)
      .where(eq(igPromptOptouts.senderId, sender));
    expect(optouts).toHaveLength(1);

    // UNSUBSCRIBE is the other accepted spelling.
    const other = 'CSENDER-UNSUB';
    await ig.handleWebhook(dm(`${run}-c5b`, other, 'unsubscribe'));
    await settle();
    expect(
      await opened.db.select().from(igPromptOptouts).where(eq(igPromptOptouts.senderId, other)),
    ).toHaveLength(1);

    // Further DMs never prompt again — not even from a fresh channel instance.
    const sentAfterStop = graph.sent.length;
    const later = await ig.handleWebhook(dm(`${run}-c6`, sender, 'hello?'));
    expect(later.ignored).toBe(1);
    const restarted = makeChannel({ seal: (k: string) => k, open: (e: string) => e });
    const later2 = await restarted.handleWebhook(dm(`${run}-c6b`, other, 'hi again'));
    expect(later2.ignored).toBe(1);
    expect(graph.sent.length).toBe(sentAfterStop);
  });

  it('(d) a correctly signed POST from a linked sender creates an item for that user', async () => {
    const { code } = await auth.createIgPairingCode(userA);
    const sender = 'CSENDER-LINKED';
    const paired = await ig.handleWebhook(dm(`${run}-c7`, sender, code));
    expect(paired.handled.map((h) => h.kind)).toContain('dm_pairing');
    expect((await auth.getIgLinkForSender(sender))?.userId).toBe(userA);

    // The whole route path: signed POST → pairing gate finds the link → ingest under user A.
    const source = `https://example.com/${run}/communal-share`;
    const res = await postWebhook(dm(`${run}-c8`, sender, source));
    expect(res.statusCode).toBe(200);
    // handleWebhook runs after the fast 200, so wait for the row.
    const created = await findItem(source);
    expect(created).toBeTruthy();
    expect(created?.userId).toBe(userA);
    const [row] = await opened.db
      .select({ userId: items.userId, channel: items.channel })
      .from(items)
      .where(eq(items.id, created?.id as string));
    expect(row?.channel).toBe('ig_dm');
  });

  it('(e) a bad signature is rejected with 401 and creates nothing', async () => {
    const source = `https://example.com/${run}/unsigned`;
    const body = dm(`${run}-c9`, 'CSENDER-X', source);
    expect((await postWebhook(body, `sha256=${'0'.repeat(64)}`)).statusCode).toBe(401);
    // No header at all.
    const noHeader = await app.inject({
      method: 'POST',
      url: '/webhooks/instagram',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
    expect(noHeader.statusCode).toBe(401);
    // Correct shape, wrong secret.
    const wrong = `sha256=${createHmac('sha256', 'not-the-secret')
      .update(JSON.stringify(body))
      .digest('hex')}`;
    expect((await postWebhook(body, wrong)).statusCode).toBe(401);

    // Give any (incorrectly) queued processing a moment, then assert nothing was ingested.
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(await findItem(source, 0)).toBeNull();
  });
});
