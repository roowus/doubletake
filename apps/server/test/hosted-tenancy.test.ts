import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostedAuth, type RunCredential } from '../src/auth/hosted.js';
import { type OpenedPgDb, openPgDb } from '../src/db/pg.js';
import { Repo, type TenantCtx } from '../src/db/repo.js';
import { clampBudget, hostedRunGate, QueueWorker, RunCapAbort } from '../src/queue/worker.js';
import { FakeBrain, tempEnv } from './helpers.js';

// Hosted tenancy + spend caps (ADR 0032). Pure-logic tests always run; the Postgres suites need
// DATABASE_URL_TEST (see db-pg.test.ts). Every PG Repo call is awaited — on the pg dialect the
// repo's sync signatures actually return promises (documented in repo.ts), and awaiting is what
// keeps the ordering tail honest.
const url = process.env.DATABASE_URL_TEST;
const run = randomBytes(4).toString('hex');

describe('tenant context is inert on SQLite (self-hosted unchanged)', () => {
  it('a present ctx neither filters nor stamps anything', () => {
    const env = tempEnv();
    try {
      const ctx: TenantCtx = { userId: 'user-1' };
      const { item, chat } = env.repo.createItemWithChat(
        {
          url: 'https://example.com/a',
          channel: 'web_share_target',
          focus: 'whole',
          modeHint: 'auto',
        },
        'web',
        'https://example.com/a',
        'Example',
        undefined,
        ctx,
      );
      expect((item as { userId?: string }).userId).toBeUndefined();
      expect(env.repo.getItem(item.id, ctx)?.id).toBe(item.id);
      expect(env.repo.getChat(chat.id, ctx)?.id).toBe(chat.id);
      expect(env.repo.listChats(50, ctx)).toHaveLength(1);
      env.repo.upsertFts(item.id, {
        title: 'Example',
        note: '',
        transcript: '',
        ocr: '',
        answer: '',
        tags: '',
        entities: '',
      });
      expect(env.repo.searchFts('example', 10, ctx)).toContain(item.id);
    } finally {
      env.cleanup();
    }
  });
});

describe.skipIf(!url)('hosted tenancy (Postgres)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let repo: Repo;
  let userA: string;
  let userB: string;
  const ctxA = () => ({ userId: userA });
  const ctxB = () => ({ userId: userB });
  let itemA: string;
  let chatA: string;
  let itemB: string;
  let chatB: string;

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, {
      seal: (k: string) => `v1.sealed.${k}`,
      open: (e: string) => e.replace('v1.sealed.', ''),
    } as never);
    repo = new Repo(opened.db as never, null);
    const a = await auth.registerEmail(`tenancy-a-${run}@example.com`, 'longenough1');
    const b = await auth.registerEmail(`tenancy-b-${run}@example.com`, 'longenough1');
    userA = a.id;
    userB = b.id;
    const urlA = `https://example.test/${run}/shared-page`;
    const na = repo.createItemWithChat(
      { url: urlA, channel: 'web_share_target', focus: 'whole', modeHint: 'auto' },
      'web',
      urlA,
      'Alpha page',
      undefined,
      ctxA(),
    );
    const nb = repo.createItemWithChat(
      { url: urlA, channel: 'web_share_target', focus: 'whole', modeHint: 'auto' },
      'web',
      urlA,
      'Alpha page',
      undefined,
      ctxB(),
    );
    itemA = na.item.id;
    chatA = na.chat.id;
    itemB = nb.item.id;
    chatB = nb.chat.id;
    // pg writes are fired in order behind the repo's tail; an awaited read flushes them.
    repo.createRun(
      { itemId: itemA, chatId: chatA, kind: 'research', mode: 'quick', adapter: 'fake' },
      ctxA(),
    );
    repo.createRun(
      { itemId: itemB, chatId: chatB, kind: 'research', mode: 'quick', adapter: 'fake' },
      ctxB(),
    );
    repo.addMessage(
      { chatId: chatA, role: 'assistant', kind: 'answer', content: 'answer for alpha' },
      ctxA(),
    );
    await repo.getChat(chatA);
  });

  afterAll(async () => {
    opened?.close();
  });

  it('same canonical URL, two users: rows are separate and stamped with their owner', async () => {
    expect(itemA).not.toBe(itemB);
    expect((await repo.getItem(itemA)) as { userId?: string }).toHaveProperty('userId', userA);
    expect((await repo.getItem(itemB)) as { userId?: string }).toHaveProperty('userId', userB);
    expect((await repo.getChat(chatA)) as { userId?: string }).toHaveProperty('userId', userA);
  });

  it('no cross-visibility on list/read paths', async () => {
    const chatsA = await repo.listChats(200, ctxA());
    expect(chatsA.map((r) => r.chat.id)).toContain(chatA);
    expect(chatsA.map((r) => r.chat.id)).not.toContain(chatB);

    // Chat detail by id: B cannot read A's chat (routes answer 404 when undefined).
    expect(await repo.getChat(chatA, ctxB())).toBeUndefined();
    expect(await repo.getItem(itemA, ctxB())).toBeUndefined();
    expect(await repo.getChatByItem(itemA, ctxB())).toBeUndefined();
    expect(await repo.listMessages(chatA, ctxB())).toEqual([]);
    expect(await repo.listRuns(chatA, ctxB())).toEqual([]);

    // Search, tags, entities, todos, collections: all scoped the same way.
    expect(await repo.searchFts('alpha', 50, ctxB())).not.toContain(itemA);
    expect(await repo.searchFts('alpha', 50, ctxA())).toContain(itemA);
    repo.setAutoTags(itemA, ['zebra-tag'], ctxA());
    await repo.getItem(itemA, ctxA());
    expect(await repo.itemIdsByTag('zebra-tag', ctxB())).toEqual([]);
    expect(await repo.itemIdsByTag('zebra-tag', ctxA())).toEqual([itemA]);
    const tagsA = await repo.listAllTags(ctxB());
    expect(tagsA.map((t) => t.name)).not.toContain('zebra-tag');
    expect(await repo.listTodos('open', ctxB())).toEqual([]);
    expect(await repo.listCollections(false, ctxB())).toEqual([]);
    const dupB = await repo.findRecentDuplicate(
      `https://example.test/${run}/shared-page`,
      'whole',
      24,
      ctxB(),
    );
    expect(dupB?.id).toBe(itemB);
    const dupA = await repo.findRecentDuplicate(
      `https://example.test/${run}/shared-page`,
      'whole',
      24,
      ctxA(),
    );
    expect(dupA?.id).toBe(itemA);
  });

  it('client-id idempotency is per tenant', async () => {
    const prior = await repo.findByClientId(`cid-${run}`, ctxA());
    expect(prior).toBeUndefined();
    repo.updateItem(itemA, { clientId: `cid-${run}` }, ctxA());
    await repo.getItem(itemA, ctxA());
    expect((await repo.findByClientId(`cid-${run}`, ctxA()))?.id).toBe(itemA);
    expect(await repo.findByClientId(`cid-${run}`, ctxB())).toBeUndefined();
  });

  it('hosted rows returned from create carry no cross-user data and runs are stamped', async () => {
    const r = repo.createRun(
      { itemId: itemA, chatId: chatA, kind: 'followup', mode: 'quick', adapter: 'fake' },
      ctxA(),
    );
    const row = (await repo.getRun(r.id, ctxA())) as { userId?: string } | undefined;
    expect(row?.userId).toBe(userA);
    expect(await repo.getRun(r.id, ctxB())).toBeUndefined();
  });
});

describe.skipIf(!url)('hosted spend caps (Postgres, no model call)', () => {
  let opened: OpenedPgDb;
  let auth: HostedAuth;
  let repo: Repo;

  beforeAll(async () => {
    opened = await openPgDb(url as string, { max: 1 });
    auth = new HostedAuth(opened.db, {
      seal: (k: string) => `v1.sealed.${k}`,
      open: (e: string) => e.replace('v1.sealed.', ''),
    } as never);
    repo = new Repo(opened.db as never, null);
  });

  afterAll(async () => {
    opened?.close();
  });

  it('no credential resolves to no_credential', async () => {
    const u = await auth.registerEmail(`caps-none-${run}@example.com`, 'longenough1');
    const gate = await hostedRunGate(auth, { userId: u.id });
    expect(gate).toEqual({ ok: false, reason: 'no_credential' });
  });

  it('month-to-date spend below the monthly cap passes and at/above fails with cap_reached', async () => {
    const u = await auth.registerEmail(`caps-month-${run}@example.com`, 'longenough1');
    // The test database persists between runs; set the cap relative to whatever is on the books.
    const base = await auth.monthSpend(u.id);
    const credId = await auth.insertCredential({
      userId: u.id,
      kind: 'openrouter',
      key: `sk-or-test-${run}`,
      monthlyCapUsd: base + 1,
      perRunCapUsd: 1,
    });
    const cred = await auth.resolveRunCredential(u.id);
    expect(cred?.monthlyCapUsd).toBe(base + 1);
    expect(cred?.perRunCapUsd).toBe(1);
    // Spend 0.5 this month, attributed to the user + credential.
    await repo.addCost('fake', null, 0.5, `run-${run}-m`, { userId: u.id }, credId);
    await repo.spentToday({ userId: u.id }); // flush the pg write ordering tail
    expect(await auth.monthSpend(u.id)).toBeCloseTo(base + 0.5);
    await expect(hostedRunGate(auth, { userId: u.id })).resolves.toEqual({
      ok: true,
      credential: expect.objectContaining({ id: credId }),
    });
    // Crossing the cap fails the run before any brain work.
    await repo.addCost('fake', null, 0.6, `run-${run}-m2`, { userId: u.id }, credId);
    await repo.spentToday({ userId: u.id }); // flush
    await expect(hostedRunGate(auth, { userId: u.id })).resolves.toEqual({
      ok: false,
      reason: 'cap_reached',
    });
    // Another user's spend never counts.
    const u2 = await auth.registerEmail(`caps-other-${run}@example.com`, 'longenough1');
    await auth.insertCredential({ userId: u2.id, kind: 'openrouter', key: `sk-or-test2-${run}` });
    await expect(hostedRunGate(auth, { userId: u2.id })).resolves.toEqual({
      ok: true,
      credential: expect.objectContaining({ id: expect.any(String) }),
    });
  });

  it('openKey only ever hands key material to the adapter env mapping', async () => {
    const u = await auth.registerEmail(`caps-env-${run}@example.com`, 'longenough1');
    await auth.insertCredential({
      userId: u.id,
      kind: 'harness',
      key: `plain-${run}`,
      baseUrl: 'https://llm.example.test/v1',
    });
    const cred = (await auth.resolveRunCredential(u.id)) as RunCredential;
    const env = cred.envFor(auth.openKey(cred.sealedKey));
    expect(env.ANTHROPIC_API_KEY).toBe(`plain-${run}`);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://llm.example.test/v1');
    // The vault listing (what the API returns) never exposes key material.
    const listed = await auth.listCredentials(u.id);
    expect(JSON.stringify(listed)).not.toContain(`plain-${run}`);
  });
});

describe('per-run cap helpers (pure)', () => {
  it('clamps the mode budget to the per-run cap and leaves uncapped runs alone', () => {
    expect(clampBudget(2, 0.4)).toBe(0.4);
    expect(clampBudget(0.2, 0.4)).toBe(0.2);
    expect(clampBudget(2, null)).toBe(2);
  });

  it('aborts a run once the ledger for that run reaches the per-run cap', () => {
    const env = tempEnv();
    try {
      const worker = new QueueWorker(env.repo, new FakeBrain(), env.cfg);
      const sl = worker as unknown as {
        runCredential: RunCredential | null;
        runCtx: { userId: string } | undefined;
        checkPerRunCap(runId: string): void;
      };
      sl.runCredential = {
        id: 'c1',
        monthlyCapUsd: null,
        perRunCapUsd: 0.5,
        sealedKey: 'v1.x',
        envFor: () => ({}),
      };
      sl.runCtx = { userId: 'u1' };
      env.repo.addCost('fake', null, 0.5, 'run-1', { userId: 'u1' }, 'c1');
      expect(env.repo.spentOnRun('run-1')).toBe(0.5);
      expect(() => sl.checkPerRunCap('run-1')).toThrow(RunCapAbort);
      try {
        sl.checkPerRunCap('run-1');
      } catch (e) {
        expect((e as RunCapAbort).reason).toBe('per_run_cap');
      }
      expect(() => sl.checkPerRunCap('run-empty')).not.toThrow();
    } finally {
      env.cleanup();
    }
  });
});
