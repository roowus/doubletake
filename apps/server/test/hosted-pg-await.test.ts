import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toChatDetail, toChatSummary } from '../src/api/dto.js';
import type {
  IgComment,
  IgGraph,
  IgMedia,
  IgProfile,
  IgTokenResponse,
} from '../src/channels/instagram/graph.js';
import { InstagramChannel } from '../src/channels/instagram/index.js';
import type { Config } from '../src/config/index.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { Repo, type TenantCtx } from '../src/db/repo.js';
import { igAccounts, items, pendingNotifications } from '../src/db/schema.pg.js';
import { ingest, ingestAsync } from '../src/ingest/index.js';
import { libraryContext } from '../src/library/ask.js';
import { listCollections, resolveQuery, seedAutoCollections } from '../src/library/collections.js';
import { buildLibraryGraph } from '../src/library/graph.js';
import { exportMemos } from '../src/library/interchange.js';
import { DigestGate, loadQuietHours, type Sink } from '../src/notify/quiet.js';
import { SecretBox } from '../src/secrets/box.js';

// REGRESSION (ADR 0032): the hosted runtime used to read pg-lazy Repo values synchronously, so
// every value was a Promise and consuming it threw or read `undefined`. The live symptoms were
// `pending.slice is not a function` (quiet-hours digest), `repo.listIgEvents(...).map is not a
// function` (IG status) and `Cannot read properties of undefined (reading 'split')` (the IG token
// refresh reading `.accessTokenEnc` off the account Promise). This file pins the three of those
// plus the wider sweep, all against REAL Postgres: each assertion is the one that used to throw.
//
// Needs the disposable Postgres at DATABASE_URL_TEST (see db-pg.test.ts). Vitest runs these files
// in parallel against ONE shared database, so this file only ever touches rows under its own
// `run` namespace and never wipes a table globally.
const url = process.env.DATABASE_URL_TEST;
const run = randomBytes(4).toString('hex');

/** Minimal Graph double; `refresh` counts calls so the token refresh is observable. */
class FakeGraph implements IgGraph {
  refreshes = 0;
  async me(): Promise<IgProfile> {
    return { id: `IG-${run}`, username: 'dt_service' };
  }
  async exchangeCode(): Promise<IgTokenResponse> {
    return { access_token: 'short' };
  }
  async exchangeLongLived(): Promise<IgTokenResponse> {
    return { access_token: 'long', expires_in: 60 * 86400 };
  }
  async refresh(): Promise<IgTokenResponse> {
    this.refreshes++;
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
  async react(): Promise<void> {}
  async sendText(): Promise<void> {}
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

/** A sink that records digests, so the gate's send is observable without a push stack. */
class RecordingSink implements Sink {
  sent: { title: string; body: string; chatId: string }[] = [];
  async notify(n: { title: string; body: string; chatId: string }): Promise<unknown> {
    this.sent.push(n);
    return { ok: true };
  }
}

describe.skipIf(!url)('hosted pg-lazy repo reads are awaited at every consumer (Postgres)', () => {
  let opened: OpenedPgDb;
  let repo: Repo;
  let ig: InstagramChannel;
  let graph: FakeGraph;
  let box: SecretBox;
  let ctx: TenantCtx;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  /**
   * Drain the repo's pg write chain so a raw drizzle read (which bypasses `Repo`'s ordering tail)
   * observes writes just made. Same pattern as hosted-ig-communal.test.ts.
   */
  async function settle(): Promise<void> {
    await repo.listPendingNotifications();
    await repo.listIgEvents(1);
  }

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 5 });
    repo = new Repo(opened.db as never, null);
    // Namespace everything under this run's own user id: the shared Postgres is used by sibling
    // hosted test files in parallel, so nothing is ever wiped globally.
    ctx = { userId: `user-${run}` };
    box = SecretBox.fromKey(randomBytes(32));
    graph = new FakeGraph();
    ig = new InstagramChannel({
      cfg: {
        ig: {
          appId: 'app',
          appSecret: 'shh',
          verifyToken: 'verify',
          accessToken: null,
          accessTokenUserId: null,
          webhookPublicHost: null,
          mentionPolling: false,
          graphBase: 'https://graph.example.test',
        },
      } as unknown as Config,
      repo,
      graph,
      box,
      adapterFor: () => ({ adapter: { id: 'test-brain' }, model: null }),
      log,
    });
  });

  afterAll(async () => {
    // Only this run's rows; the table is shared with sibling hosted test files.
    await opened.db.execute(`delete from ig_events where id like '${run}%'`);
    await opened.db.execute(`delete from pending_notifications where id like '${run}%'`);
    await opened.db.execute(`delete from items where user_id = '${ctx.userId}'`);
    await opened.db.execute(`delete from collections where user_id = '${ctx.userId}'`);
    await opened.db.execute(`delete from runs where user_id = '${ctx.userId}'`);
    await opened.db.execute(`delete from chats where user_id = '${ctx.userId}'`);
    await opened.db.execute(`delete from settings where key like 'pgawait-${run}%'`);
    await opened.close();
  });

  it('(1) the quiet-hours digest gate consumes listPendingNotifications without throwing', async () => {
    // The exact live failure: `pending.slice is not a function` inside buildDigest.
    for (let i = 0; i < 3; i++) {
      repo.enqueueNotification({
        chatId: `${run}-chat-${i}`,
        title: `Answer ${i} ready for ${run}`,
        body: 'body',
        url: '/',
        tag: 'digest',
      });
    }
    // Drain the repo's pg write chain so the read below observes the parked rows. Raw drizzle
    // reads bypass Repo's ordering tail (the documented dialect lie), so `settle()` first.
    await settle();

    const sink = new RecordingSink();
    // `force` skips quiet hours, which is what the timer/route does outside the window. The gate
    // is repo-global by design, so a parallel sibling test's rows may be digested alongside ours:
    // this asserts only that OUR three rows are gone and that a digest went out.
    const gate = new DigestGate(repo, sink, 'https://dt.example', () => new Date());
    const flushed = await gate.flush(true);
    // `clearPendingNotifications` issues per-id deletes that land on the pg orderng tail, so
    // drain it before reading the table back raw.
    await settle();

    // Only this run's rows are asserted on: `pending_notifications` is shared with the sibling
    // digest.test.ts running in parallel, so never assert on the table as a whole.
    const parked = await opened.db
      .select({ chatId: pendingNotifications.chatId })
      .from(pendingNotifications);
    const mine = parked.filter((p) => p.chatId.startsWith(`${run}-chat-`));
    expect(mine).toHaveLength(0); // cleared after the digest went out
    expect(flushed.sent).toBeGreaterThanOrEqual(3);
    // The digest body is built with `.slice`/`.map` over the awaited rows — the old crash site.
    // It lists the first three parked titles in insertion order, so our own first row is there.
    const digest = sink.sent.at(-1);
    expect(digest?.title).toContain('answers ready');
    expect(digest?.body).toContain(`Answer 0 ready`);
  });

  it('(1b) getSetting-backed reads resolve to real values, not Promises', async () => {
    // `settings` is keyed globally and sibling hosted test files run in parallel, so this only
    // asserts on its OWN key: the bug was `getSetting` handing back a Promise, which made
    // `Boolean(promise)`/`JSON.parse(promise)` the wrong answer regardless of the value stored.
    const key = `pgawait-${run}-quiet`;
    repo.setSetting(key, JSON.stringify({ enabled: true, start: '22:00', end: '07:30' }));
    await settle(); // the write is pg-lazy; the read below must observe it
    expect(await repo.getSetting(key)).toBe(
      JSON.stringify({ enabled: true, start: '22:00', end: '07:30' }),
    );
    expect(await repo.getSetting(`pgawait-${run}-absent`)).toBeUndefined();

    // loadQuietHours runs the same awaited getSetting through the real public helper: whatever
    // the shared row holds, it must come back as a fully-formed QuietHours object, never a
    // Promise (the old bug made `.enabled`/`.timeZone` undefined).
    const q = await loadQuietHours(repo);
    expect(typeof q.enabled).toBe('boolean');
    expect(typeof q.start).toBe('string');
    expect(typeof q.end).toBe('string');
    expect(typeof q.timeZone).toBe('string');

    const sink = new RecordingSink();
    const gate = new DigestGate(repo, sink, null, () => new Date('2026-01-01T12:00:00Z'));
    expect(typeof (await gate.pendingCount())).toBe('number');
    expect(typeof (await gate.quietHours()).timeZone).toBe('string');
  });

  it('(2) the IG status path consumes listIgEvents without throwing', async () => {
    // The exact live failure: `repo.listIgEvents(...).map is not a function`.
    const known = await repo.recordIgEvent({
      id: `${run}-event-a`,
      kind: 'dm_share',
      raw: { mid: `${run}-event-a` },
    });
    expect(known).toBe(true);
    const duplicate = await repo.recordIgEvent({
      id: `${run}-event-a`,
      kind: 'dm_share',
      raw: { mid: `${run}-event-a` },
    });
    expect(duplicate).toBe(false); // pg returns the boolean lazily; awaiting it is the contract

    const status = await ig.status();
    expect(Array.isArray(status.recentEvents)).toBe(true);
    expect(status.recentEvents.every((e) => typeof e.id === 'string')).toBe(true);
    // Not `undefined` fields off a Promise: the mapped event carries real column values.
    expect(status.recentEvents.length).toBeGreaterThan(0);
  });

  it('(3) the IG token-refresh path decrypts the stored token (the .split crash)', async () => {
    // Seed a real account row sealed with a real box, exactly as `seedAccountFromEnv` does.
    await repo.upsertIgAccount({
      igUserId: `IG-${run}`,
      username: 'dt_service',
      accessTokenEnc: box.seal('plain-token-material'),
      expiresAt: null,
      // Older than REFRESH_AFTER_MS (30 days) so refreshIfDue actually proceeds.
      refreshedAt: new Date(Date.now() - 40 * 24 * 3600_000).toISOString(),
    });
    const before = graph.refreshes;
    const refreshed = await ig.refreshIfDue();
    // Before the sweep this threw `Cannot read properties of undefined (reading 'split')` from
    // SecretBox.open(undefined) and `refreshIfDue` swallowed it as a logged failure -> false.
    expect(refreshed).toBe(true);
    expect(graph.refreshes).toBe(before + 1);

    // The refreshed value round-trips through the box (a real decrypt, not a Promise).
    await settle();
    const [row] = await opened.db
      .select()
      .from(igAccounts)
      .where(eq(igAccounts.igUserId, `IG-${run}`));
    expect(box.open(row?.accessTokenEnc as string)).toBe('long-refreshed');
  });

  it('(4) library reads, collections and the graph consume awaited repo values', async () => {
    const item = await repo.createItemWithChat(
      {
        url: `https://example.com/${run}/pg-await`,
        channel: 'compose',
        focus: 'whole',
        modeHint: 'standard',
      },
      'web',
      `https://example.com/${run}/pg-await`,
      `PG await fixture ${run}`,
      undefined,
      ctx,
    );
    await repo.addManualTag(item.item.id, `pgtag${run}`, ctx);
    await repo.addExtraction({
      itemId: item.item.id,
      kind: 'page_text',
      content: 'the awaited text body',
      tool: 'x',
    });
    await repo.updateItem(item.item.id, { note: `note ${run}` }, ctx);
    await repo.addMessage(
      { chatId: item.chat.id, role: 'user', kind: 'question', content: `question ${run}` },
      ctx,
    );

    // `libraryContext` maps/filters/slices over several awaited reads in a loop.
    const lib = await libraryContext(repo, `note ${run}`, {}, ctx);
    expect(Array.isArray(lib.hits)).toBe(true);
    expect(lib.hits.map((h) => h.chatId)).toContain(item.chat.id);

    // `toChatSummary` awaits listTags; `toChatDetail` awaits messages/runs/entities/extractions.
    const summary = await toChatSummary(repo, item.chat, item.item, ctx);
    expect(summary.tags).toContain(`pgtag${run}`);
    const detail = await toChatDetail(repo, item.chat, item.item, ctx);
    expect(detail.messages.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.runs)).toBe(true);
    expect(Array.isArray(detail.extractions)).toBe(true);

    // Collections: seed + resolve + list, all built on awaited item-id lists.
    await seedAutoCollections(repo, ctx);
    const cols = await listCollections(repo, true, true, (t) => `/s/${t}`, ctx);
    expect(Array.isArray(cols)).toBe(true);
    expect(await resolveQuery(repo, `tag:pgtag${run}`, ctx)).toContain(item.item.id);

    // The library graph maps over awaited chats and one batched graphData read.
    const g = await buildLibraryGraph(repo, { chats: 50, entities: 50 }, ctx);
    expect(g.nodes.some((n) => n.id === `chat:${item.chat.id}`)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);

    // Export path reads chats/messages/tags/collections for every item.
    const memos = await exportMemos(repo);
    expect(Array.isArray(memos.memos)).toBe(true);
  });

  it('(4b) the sync SQLite-only ingest() entry point refuses to run on the pg dialect', async () => {
    // The one sync contract that intentionally remains (self-hosted callers and tests) must not
    // silently mangle a Promise into an outcome: it throws instead.
    expect(() =>
      ingest(
        {
          url: `https://example.com/${run}/sync-guard`,
          channel: 'compose',
          focus: 'whole',
          modeHint: 'standard',
        },
        { repo, ctx, adapterFor: () => ({ adapter: { id: 'test-brain' }, model: null }) },
      ),
    ).toThrow(/ingest\(\) is the synchronous \(SQLite\) entry point/);

    // The async twin is the supported hosted path and really creates the rows.
    const out = await ingestAsync(
      {
        url: `https://example.com/${run}/sync-guard`,
        channel: 'compose',
        focus: 'whole',
        modeHint: 'standard',
      },
      { repo, ctx, adapterFor: () => ({ adapter: { id: 'test-brain' }, model: null }) },
    );
    expect(out.item.id).toBeTruthy();
    expect(out.chat.id).toBeTruthy();
    expect(out.run.id).toBeTruthy();
  });

  it('(5) values are real, not Promises: the same reads satisfy sync-shaped assertions', async () => {
    // A representative sample across the swept surface: each of these used to be a Promise, so
    // `.length`/`.find`/property access would have thrown or silently produced `undefined`.
    const [chat] = await opened.db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.userId, ctx.userId));
    expect(chat).toBeDefined();

    const pending = await repo.listPendingNotifications();
    expect(Array.isArray(pending)).toBe(true);
    expect(typeof (await repo.countPendingNotifications())).toBe('number');
    expect((await repo.listIgEvents(5)).every((e) => typeof e.kind === 'string')).toBe(true);
    const account = await repo.getIgAccount();
    expect(typeof account?.accessTokenEnc).toBe('string');

    // The IG status endpoint shape the PWA reads.
    const status = await ig.status();
    expect(status.connected).toBe(true);
    expect(status.igUserId).toBe(`IG-${run}`);
    expect(status.username).toBe('dt_service');
  });
});
