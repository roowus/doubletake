import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { igAccounts, igPairingCodes, items } from '../src/db/schema.pg.js';

// Hosted Instagram pairing (ADR 0018 in hosted mode, ADR 0032): a user generates a code in
// settings, DMs it to the service account, and the sender's Instagram account is linked; later
// DMs ingest under that user's tenant. Self-hosted never sees any of it (the channel has no
// hooks attached, so `hostedDmGate` is not even entered). Needs the disposable Postgres at
// DATABASE_URL_TEST (see db-pg.test.ts).
const url = process.env.DATABASE_URL_TEST;
const run = randomBytes(4).toString('hex');

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

describe.skipIf(!url)('hosted instagram pairing (Postgres)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let repo: Repo;
  let graph: FakeGraph;
  let ig: InstagramChannel;
  let userA: string;
  let userB: string;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, {
      seal: (k: string) => `v1.sealed.${k}`,
      open: (e: string) => e.replace('v1.sealed.', ''),
    } as never);
    repo = new Repo(opened.db as never, null);
    // The test Postgres is shared across runs: clear pairing state keyed by the fixed sender ids.
    // `ig_prompts`/`ig_prompt_optouts` are persisted now (ADR 0032), so a leftover hourly prompt
    // window would suppress the "connect your account" DM these tests assert on.
    await opened.db.execute(`delete from ig_links where sender_id like 'SENDER%'`);
    await opened.db.execute(`delete from ig_pairing_codes`);
    await opened.db.execute(`delete from ig_prompts where sender_id like 'SENDER%'`);
    await opened.db.execute(`delete from ig_prompt_optouts where sender_id like 'SENDER%'`);
    await opened.db.execute(`delete from ig_events where id like 'm%'`);
    const a = await auth.registerEmail(`ig-pair-a-${run}@example.com`, 'longenough1');
    const b = await auth.registerEmail(`ig-pair-b-${run}@example.com`, 'longenough1');
    userA = a.id;
    userB = b.id;
    graph = new FakeGraph();
    ig = new InstagramChannel({
      cfg: {
        ig: {
          appId: 'app',
          appSecret: 'secret',
          verifyToken: 'verify',
          webhookPublicHost: null,
          mentionPolling: false,
          graphBase: 'https://graph.facebook.com/v21.0',
        },
      } as unknown as Config,
      repo,
      graph,
      box: { seal: (k: string) => k, open: (e: string) => e } as never,
      adapterFor: () => ({ adapter: { id: 'test-brain' }, model: null }),
      log,
    });
    // The service account token lives in ig_accounts; upsertIgAccount is SQLite-only, so seed
    // the row directly (the channel only reads it for the react/DM token).
    await opened.db.delete(igAccounts);
    await opened.db.insert(igAccounts).values({
      igUserId: 'IG1',
      username: 'dt_service',
      accessTokenEnc: 'tok',
      expiresAt: null,
      refreshedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    ig.attachHosted({
      resolveLink: (senderId) => auth.getIgLinkForSender(senderId),
      resolvePairing: (code, senderId, igUsername) =>
        auth.resolveIgPairing(code, senderId, igUsername),
    });
  });

  afterAll(async () => {
    await opened?.close();
  });

  it('pairs a sender via DM code, then ingests later DMs under the linked user', async () => {
    const { code } = await auth.createIgPairingCode(userA);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    // The pairing DM itself creates no item, but reacts and confirms.
    const paired = await ig.handleWebhook(dm(`m1-${run}`, 'SENDER1', code.toLowerCase()));
    expect(paired.handled.map((h) => h.kind)).toContain('dm_pairing');
    expect(paired.handled.every((h) => h.itemId === null)).toBe(true);
    expect(graph.reactions.some((r) => r.messageId === `m1-${run}`)).toBe(true);
    expect(graph.sent.some((s) => s.text.includes('Linked to your Doubletake account'))).toBe(true);
    const link = await auth.getIgLinkForSender('SENDER1');
    expect(link?.userId).toBe(userA);

    // A later DM share from the same sender creates an item owned by user A.
    const share = await ig.handleWebhook(
      dm(`m2-${run}`, 'SENDER1', `https://example.com/${run}/a-share`),
    );
    const handled = share.handled.find((h) => h.kind === 'dm_share');
    expect(handled?.itemId).toBeTruthy();
    const [row] = await opened.db
      .select({ userId: items.userId })
      .from(items)
      .where(eq(items.id, handled?.itemId as string));
    expect(row?.userId).toBe(userA);
  });

  it('rejects an expired code', async () => {
    await opened.db.insert(igPairingCodes).values({
      code: 'EXPIRED1',
      userId: userA,
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      expiresAt: new Date(Date.now() - 1800_000).toISOString(),
    });
    expect(await auth.resolveIgPairing('EXPIRED1', 'SENDER-X', null)).toBeNull();
    expect(await auth.getIgLinkForSender('SENDER-X')).toBeNull();
  });

  it('a code is single-use: a second sender presenting it is not linked', async () => {
    const { code } = await auth.createIgPairingCode(userB);
    const first = await ig.handleWebhook(dm(`m3-${run}`, 'SENDER2', code));
    expect(first.handled.map((h) => h.kind)).toContain('dm_pairing');
    expect((await auth.getIgLinkForSender('SENDER2'))?.userId).toBe(userB);
    // Different sender, same (now consumed) code: no link, and the usual "connect" prompt.
    const before = graph.sent.length;
    const second = await ig.handleWebhook(dm(`m4-${run}`, 'SENDER3', code));
    expect(second.handled.map((h) => h.kind)).not.toContain('dm_pairing');
    expect(await auth.getIgLinkForSender('SENDER3')).toBeNull();
    expect(graph.sent.slice(before).some((s) => s.text.includes('DM me the code'))).toBe(true);
  });

  it('attributes DMs from two senders to their two users', async () => {
    const shareA = await ig.handleWebhook(
      dm(`m5-${run}`, 'SENDER1', `https://example.com/${run}/second-a`),
    );
    const shareB = await ig.handleWebhook(
      dm(`m6-${run}`, 'SENDER2', `https://example.com/${run}/second-b`),
    );
    const [rowA] = await opened.db
      .select({ userId: items.userId })
      .from(items)
      .where(eq(items.id, shareA.handled.find((h) => h.kind === 'dm_share')?.itemId as string));
    const [rowB] = await opened.db
      .select({ userId: items.userId })
      .from(items)
      .where(eq(items.id, shareB.handled.find((h) => h.kind === 'dm_share')?.itemId as string));
    expect(rowA?.userId).toBe(userA);
    expect(rowB?.userId).toBe(userB);
  });

  it('an unknown sender with no code creates nothing and is prompted once per hour', async () => {
    const before = graph.sent.length;
    const res = await ig.handleWebhook(dm(`m7-${run}`, 'SENDER9', 'hello there'));
    expect(res.handled).toHaveLength(0);
    expect(res.ignored).toBe(1);
    expect(graph.sent.length).toBe(before + 1);
    expect(graph.sent.at(-1)?.text).toContain('DM me the code');
    // Rate limit: a second DM from the same sender within the hour sends no new prompt.
    const res2 = await ig.handleWebhook(dm(`m8-${run}`, 'SENDER9', 'hello again'));
    expect(res2.ignored).toBe(1);
    expect(graph.sent.length).toBe(before + 1);
    const orphaned = await opened.db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.channel, 'ig_dm'));
    // Only linked senders' items exist; the unknown sender produced none.
    expect(orphaned.every((r) => r.id !== `m7-${run}`)).toBe(true);
  });

  it('unlinking stops further DMs from that sender', async () => {
    const link = await auth.getIgLinkForSender('SENDER1');
    expect(link).toBeTruthy();
    expect(await auth.revokeIgLink(userA, link?.id as string)).toBe(true);
    // Not the owner's link: scoped revoke refuses.
    expect(await auth.revokeIgLink(userB, link?.id as string)).toBe(false);
    const before = graph.sent.length;
    const res = await ig.handleWebhook(
      dm(`m9-${run}`, 'SENDER1', `https://example.com/${run}/after-unlink`),
    );
    expect(res.handled).toHaveLength(0);
    expect(res.ignored).toBe(1);
    expect(graph.sent.length).toBe(before + 1);
    const rows = await opened.db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.sourceUrl, `https://example.com/${run}/after-unlink`));
    expect(rows).toHaveLength(0);
  });
});
