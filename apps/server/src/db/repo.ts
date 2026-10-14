/**
 * Data access over either database dialect (ADR 0032).
 *
 * DIALECT CONTRACT — read before touching: every method keeps its historical synchronous
 * signature because all self-hosted callers and 238+ tests use it that way, and SQLite
 * (better-sqlite3) really is synchronous. Postgres (postgres-js) is inherently async, so when a
 * Repo is constructed over a PG database the SAME methods return Promise-valued results that the
 * declared types do not mention (`lazy()` below is that documented lie). PG-side callers MUST
 * `await` every Repo call; SQLite-side callers are unaffected (`await` on a plain value is a
 * no-op). A full hosted-PG runtime therefore requires an async sweep of all call sites —
 * tracked, out of scope for H1. Tenant scoping lives in exactly one place, `scope()`: it applies
 * `user_id` filters and stamps only on the PG dialect, so routes can pass a `TenantCtx`
 * unconditionally with zero self-hosted effect.
 */
import type { Answer, IngestRequest, Mode, Platform, RunKind } from '@doubletake/shared';
import { newId, nowIso } from '@doubletake/shared';
import { and, desc, eq, gte, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import type { PgDb } from './pg.js';
import * as s from './schema.js';
import * as pg from './schema.pg.js';

export type ItemRow = typeof s.items.$inferSelect;
export type ChatRow = typeof s.chats.$inferSelect;
export type RunRow = typeof s.runs.$inferSelect;
export type MessageRow = typeof s.messages.$inferSelect;

/**
 * Tenant identity (ADR 0032). The API layer builds it from `req.hosted` in hosted mode and
 * leaves it undefined in self-hosted mode. Every Repo method that touches a tenant table takes
 * an optional trailing `ctx`; when the underlying database is Postgres the filter (and the
 * `user_id` stamp on writes) is applied inside the Repo — in exactly one place, `scope()` —
 * never at call sites. On SQLite (no `user_id` column by design) a present ctx is ignored, so
 * self-hosted behaviour is unchanged byte-for-byte.
 */
export type TenantCtx = { userId: string };

/** Read the tenant context off a row that carries `user_id` (Postgres rows only; see `lazy`). */
export function ctxOf(row: object | null | undefined): TenantCtx | undefined {
  const userId = (row as { userId?: string | null } | null | undefined)?.userId;
  return userId ? { userId } : undefined;
}

/**
 * Postgres `user_id` columns per tenant table (ADR 0032). One map so scoping and stamping stay
 * in one place; SQLite never consults it.
 */
const PG_USER_ID = {
  items: pg.items.userId,
  chats: pg.chats.userId,
  messages: pg.messages.userId,
  runs: pg.runs.userId,
  run_events: pg.runEvents.userId,
  extractions: pg.extractions.userId,
  media_assets: pg.mediaAssets.userId,
  entities: pg.entities.userId,
  tags: pg.tags.userId,
  item_tags: pg.itemTags.userId,
  collections: pg.collections.userId,
  collection_items: pg.collectionItems.userId,
  todos: pg.todos.userId,
  devices: pg.devices.userId,
  push_subscriptions: pg.pushSubscriptions.userId,
  cost_ledger: pg.costLedger.userId,
  place_geo: pg.placeGeo.userId,
} as const;

type TenantTable = keyof typeof PG_USER_ID;

/**
 * The pg schema mirrored under the SQLite module's shape. On Postgres queries are built from
 * these tables (same names/columns); the cast keeps every method's types identical between
 * dialects — pg rows simply carry the extra runtime `userId` field.
 */
const PG_TABLES = {
  items: pg.items,
  extractions: pg.extractions,
  mediaAssets: pg.mediaAssets,
  chats: pg.chats,
  messages: pg.messages,
  runs: pg.runs,
  runEvents: pg.runEvents,
  artifacts: pg.artifacts,
  entities: pg.entities,
  tags: pg.tags,
  itemTags: pg.itemTags,
  collections: pg.collections,
  collectionItems: pg.collectionItems,
  devices: pg.devices,
  pushSubscriptions: pg.pushSubscriptions,
  pendingNotifications: pg.pendingNotifications,
  placeGeo: pg.placeGeo,
  costLedger: pg.costLedger,
  settings: pg.settings,
  igAccounts: pg.igAccounts,
  igEvents: pg.igEvents,
  todos: pg.todos,
} as unknown as typeof s;

/** Insert-value rows may carry the tenant stamp (Postgres only). */
type Insert<T> = T & { userId?: string };

/**
 * Query-execution seam. On SQLite everything above stays synchronous (better-sqlite3), and the
 * public method signatures are frozen because 238+ tests and every self-hosted caller use them
 * synchronously. Postgres (postgres-js) is inherently async, so on that dialect the same helpers
 * return lazily-awaited results: pg callers `await` (a no-op on the SQLite values). The sync/async
 * union is deliberately contained inside this class.
 */
class Exec {
  /** Ordering tail: on pg, every call is registered here so the next one waits its turn. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: unknown,
    readonly isPg: boolean,
  ) {}

  /** Typed handle on the underlying drizzle db/tx (declaration-lying, see file header). */
  get db2(): Db {
    return this.db as Db;
  }

  chain(p: PromiseLike<unknown>): void {
    this.tail = this.tail.then(
      () => p,
      () => p,
    );
  }

  /** Single row. On pg appends `LIMIT 1`; execution starts immediately, the value arrives on await. */
  one<T>(q: unknown): T | undefined {
    if (!this.isPg) return (q as { get(): T | undefined }).get();
    const p = (async () => {
      await this.tail;
      return (await (q as { limit(n: number): PromiseLike<T[]> }).limit(1))[0];
    })();
    this.chain(p);
    return lazy(p);
  }

  /** All rows; pg execution starts immediately. */
  many<T>(q: unknown): T[] {
    if (!this.isPg) return (q as { all(): T[] }).all();
    const p = (async () => {
      await this.tail;
      return await (q as PromiseLike<T[]>);
    })();
    this.chain(p);
    return lazy(p);
  }

  /** Write; returns a sqlite-shaped `{ changes }` on both dialects. Pg writes start immediately. */
  exec(q: unknown): { changes: number } {
    if (!this.isPg) return (q as { run(): { changes: number } }).run();
    const p = (async () => {
      await this.tail;
      const res = await (q as PromiseLike<unknown>);
      const r = res as { count?: number; rowCount?: number };
      if (r && typeof r.count === 'number') return { changes: r.count };
      if (r && typeof r.rowCount === 'number') return { changes: r.rowCount };
      return { changes: Array.isArray(res) ? res.length : 0 };
    })();
    this.chain(p);
    return lazy(p);
  }

  /**
   * Atomic multi-statement write. The callback is SYNCHRONOUS: on SQLite every Exec call runs
   * inline (better-sqlite3 requires a sync transaction function), and on pg the queries fire
   * eagerly and `tail` holds the commit until they have all run.
   */
  transaction(fn: (x: Exec) => void): void {
    if (!this.isPg) {
      (this.db as { transaction(cb: (tx: unknown) => unknown): unknown }).transaction((tx) => {
        fn(new Exec(tx, false));
      });
      return;
    }
    const outer = this.tail;
    this.chain(
      (async () => {
        await outer;
        let inner: Promise<unknown> = Promise.resolve();
        await (
          this.db as { transaction(cb: (tx: unknown) => Promise<void>): Promise<void> }
        ).transaction(async (tx) => {
          const x = new Exec(tx, true);
          fn(x);
          inner = x.tail;
          await inner;
        });
      })(),
    );
  }
}

/**
 * The deliberate, documented type lie (ADR 0032, see the file header): on the Postgres dialect a
 * method declared to return `T` actually returns `Promise<T>`, and every pg-side caller must
 * `await` it. On SQLite the same call returns plain `T` synchronously, which is why 238+
 * self-hosted tests and callers need no change. A full hosted-PG runtime requires an async sweep
 * of all call sites — tracked, out of scope for H1.
 */
function lazy<T>(p: PromiseLike<T>): T {
  return p as unknown as T;
}

export class Repo {
  /**
   * SQLite-typed by declaration so every untouched method keeps compiling unchanged. In hosted
   * mode this field actually holds the Postgres db (`this.pg`); only methods that are safe on
   * pg (those routed through `this.ex` below) may run on that dialect.
   */
  readonly db: Db;
  /** Present only on the SQLite (self-hosted) path; FTS5 lives here. */
  readonly sqlite: import('better-sqlite3').Database | null;
  /** Non-null in hosted mode: the Postgres database behind `this.db`. */
  readonly pg: PgDb | null;
  readonly isPg: boolean;
  /** Dialect-aware table set (`PG_TABLES` on pg). */
  readonly t: typeof s;
  private readonly ex: Exec;

  constructor(db: Db | PgDb, sqlite: import('better-sqlite3').Database | null) {
    this.db = db as Db;
    this.sqlite = sqlite;
    this.pg = sqlite === null ? (db as PgDb) : null;
    this.isPg = sqlite === null;
    this.t = this.isPg ? PG_TABLES : s;
    this.ex = new Exec(db, this.isPg);
  }

  /** Queue a fired pg write (raw pg inserts) so the next call observes it; no-op on SQLite. */
  private fire(p: PromiseLike<unknown>): void {
    if (!this.isPg) return;
    this.ex.chain(p);
  }

  private one<T>(q: unknown): T | undefined {
    return this.ex.one<T>(q);
  }

  private many<T>(q: unknown): T[] {
    return this.ex.many<T>(q);
  }

  private exec(q: unknown): { changes: number } {
    return this.ex.exec(q);
  }

  private transaction(fn: (x: Exec) => void): void {
    // Sync callback by design: SQLite commits inline; on pg Exec fires the statements eagerly
    // and chains them (and the commit) onto the shared ordering tail.
    this.ex.transaction(fn);
  }

  /**
   * Tenant filter — the single place query scoping is decided (ADR 0032). Applied only when the
   * database is Postgres and a context was supplied; spread into any `and(...)`.
   */
  private scope(table: TenantTable, ctx?: TenantCtx): SQL[] {
    if (!ctx || !this.isPg) return [];
    return [eq(PG_USER_ID[table], ctx.userId)];
  }

  /**
   * Coerce SQLite boolean-mode integer columns for Postgres (0/1). Needed because pg queries
   * are built from values typed against the SQLite schema (see the dialect contract above).
   * The list is exactly the columns declared `integer(..., { mode: 'boolean' })` in
   * `schema.ts`; the pg mirror declares them plain `integer`, so a JS `true` fails the insert
   * with `42804 column "x" is of type integer but expression is of type boolean`.
   */
  private pgVals<V>(v: V): V {
    if (!this.isPg) return v;
    const out = { ...(v as Record<string, unknown>) };
    for (const k of ['pinned', 'hidden', 'starred', 'manual', 'auto'])
      if (typeof out[k] === 'boolean') out[k] = out[k] ? 1 : 0;
    return out as V;
  }

  /**
   * Map over `many` rows, pg-safe (see dialect contract): a plain array on SQLite, a
   * lazily-awaited mapped array on Postgres.
   */
  private manyMap<X, R>(q: unknown, f: (row: X) => R): R[] {
    if (!this.isPg) return this.many<X>(q).map(f);
    return lazy(Promise.resolve((async () => (await this.many<X>(q)).map(f))()));
  }

  /** Tenant stamp for insert values (Postgres only; SQLite has no `user_id` column). */
  private stamp(ctx?: TenantCtx): { userId?: string } {
    return ctx && this.isPg ? { userId: ctx.userId } : {};
  }

  // ---- items / chats ----

  findRecentDuplicate(
    canonicalUrl: string,
    focus: string,
    hours = 24,
    ctx?: TenantCtx,
  ): ItemRow | undefined {
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    return this.one<ItemRow>(
      this.db
        .select()
        .from(this.t.items)
        .where(
          and(
            eq(this.t.items.canonicalUrl, canonicalUrl),
            eq(this.t.items.focus, focus),
            gte(this.t.items.createdAt, since),
            ...this.scope('items', ctx),
          ),
        )
        .orderBy(desc(this.t.items.createdAt)),
    );
  }

  /** The item a retrying client already created under this idempotency key, if any. */
  findByClientId(clientId: string, ctx?: TenantCtx): ItemRow | undefined {
    return this.one<ItemRow>(
      this.db
        .select()
        .from(this.t.items)
        .where(and(eq(this.t.items.clientId, clientId), ...this.scope('items', ctx))),
    );
  }

  createItemWithChat(
    req: IngestRequest,
    platform: Platform,
    canonicalUrl: string | null,
    title: string,
    /** Pre-minted id (an upload wrote `media/<id>/…` before the row existed). */
    id: string = newId(),
    ctx?: TenantCtx,
  ): { item: ItemRow; chat: ChatRow } {
    const now = nowIso();
    const item: Insert<typeof s.items.$inferInsert> = {
      id,
      sourceUrl: req.url ?? null,
      canonicalUrl,
      platform,
      channel: req.channel,
      note: req.note ?? null,
      text: req.text ?? null,
      focus: req.focus,
      modeRequested: req.modeHint,
      status: 'new',
      title,
      clientId: req.clientId ?? null,
      createdAt: now,
      updatedAt: now,
      ...this.stamp(ctx),
    };
    const chat: Insert<typeof s.chats.$inferInsert> = {
      id: newId(),
      itemId: item.id,
      unreadCount: 0,
      createdAt: now,
      ...this.stamp(ctx),
    };
    if (this.isPg) {
      // Lazy pg builders: fire both inserts in order; the constructed rows are complete, so no
      // re-read is needed. A later awaited read observes both (see `fire`).
      const pgDb = this.pg as unknown as {
        insert(t: unknown): { values(v: unknown): PromiseLike<unknown> };
      };
      this.fire(pgDb.insert(pg.items).values(item as never));
      this.fire(pgDb.insert(pg.chats).values(chat as never));
      return { item: item as ItemRow, chat: chat as ChatRow };
    }
    this.db.transaction((tx) => {
      tx.insert(s.items).values(item).run();
      tx.insert(s.chats).values(chat).run();
    });
    const created = this.getItem(item.id);
    const createdChat = this.getChat(chat.id);
    if (!created || !createdChat) throw new Error('insert did not persist item/chat');
    return { item: created, chat: createdChat };
  }

  getItem(id: string, ctx?: TenantCtx): ItemRow | undefined {
    return this.one<ItemRow>(
      this.db
        .select()
        .from(this.t.items)
        .where(and(eq(this.t.items.id, id), ...this.scope('items', ctx))),
    );
  }
  getChat(id: string, ctx?: TenantCtx): ChatRow | undefined {
    return this.one<ChatRow>(
      this.db
        .select()
        .from(this.t.chats)
        .where(and(eq(this.t.chats.id, id), ...this.scope('chats', ctx))),
    );
  }
  /** Any item ever saved for this permalink (import dedupe is all-time, unlike the 24 h share window). */
  findItemByCanonicalUrl(canonicalUrl: string, ctx?: TenantCtx): ItemRow | undefined {
    return this.one<ItemRow>(
      this.db
        .select()
        .from(this.t.items)
        .where(and(eq(this.t.items.canonicalUrl, canonicalUrl), ...this.scope('items', ctx)))
        .orderBy(desc(this.t.items.createdAt)),
    );
  }

  listItems(limit = 200, ctx?: TenantCtx): ItemRow[] {
    return this.many<ItemRow>(
      this.db
        .select()
        .from(this.t.items)
        .where(and(...this.scope('items', ctx)))
        .orderBy(desc(this.t.items.createdAt))
        .limit(limit),
    );
  }

  getChatByItem(itemId: string, ctx?: TenantCtx): ChatRow | undefined {
    return this.one<ChatRow>(
      this.db
        .select()
        .from(this.t.chats)
        .where(and(eq(this.t.chats.itemId, itemId), ...this.scope('chats', ctx))),
    );
  }

  updateItem(id: string, patch: Partial<typeof s.items.$inferInsert>, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.items)
        .set({ ...patch, updatedAt: nowIso() })
        .where(and(eq(this.t.items.id, id), ...this.scope('items', ctx))),
    );
  }

  updateChat(id: string, patch: Partial<typeof s.chats.$inferInsert>, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.chats)
        .set(patch)
        .where(and(eq(this.t.chats.id, id), ...this.scope('chats', ctx))),
    );
  }

  listChats(limit = 200, ctx?: TenantCtx): { chat: ChatRow; item: ItemRow }[] {
    return this.many<{ chat: ChatRow; item: ItemRow }>(
      this.db
        .select({ chat: this.t.chats, item: this.t.items })
        .from(this.t.chats)
        .innerJoin(this.t.items, eq(this.t.items.id, this.t.chats.itemId))
        .where(and(...this.scope('chats', ctx)))
        .orderBy(desc(sql`coalesce(${this.t.chats.lastMessageAt}, ${this.t.chats.createdAt})`))
        .limit(limit),
    );
  }

  markRead(chatId: string, ctx?: TenantCtx): void {
    const now = nowIso();
    this.transaction((tx) => {
      tx.exec(
        tx.db2
          .update(this.t.messages)
          .set({ readAt: now })
          .where(
            and(
              eq(this.t.messages.chatId, chatId),
              sql`${this.t.messages.readAt} IS NULL`,
              ...this.scope('messages', ctx),
            ),
          ),
      );
      tx.exec(
        tx.db2
          .update(this.t.chats)
          .set({ unreadCount: 0 })
          .where(and(eq(this.t.chats.id, chatId), ...this.scope('chats', ctx))),
      );
    });
  }

  // ---- messages ----

  addMessage(
    m: {
      chatId: string;
      role: 'user' | 'assistant' | 'system';
      kind: 'answer' | 'followup' | 'status' | 'error' | 'question';
      content: string;
      structured?: Answer | null;
      runId?: string | null;
      unread?: boolean;
    },
    ctx?: TenantCtx,
  ): typeof s.messages.$inferSelect {
    const now = nowIso();
    const row: Insert<typeof s.messages.$inferInsert> = {
      id: newId(),
      chatId: m.chatId,
      role: m.role,
      kind: m.kind,
      content: m.content,
      structured: m.structured ? JSON.stringify(m.structured) : null,
      runId: m.runId ?? null,
      createdAt: now,
      readAt: m.unread ? null : now,
      ...this.stamp(ctx),
    };
    this.transaction((tx) => {
      tx.exec(tx.db2.insert(this.t.messages).values(row));
      tx.exec(
        tx.db2
          .update(this.t.chats)
          .set({
            lastMessageAt: now,
            unreadCount: m.unread ? sql`${this.t.chats.unreadCount} + 1` : this.t.chats.unreadCount,
          })
          .where(and(eq(this.t.chats.id, m.chatId), ...this.scope('chats', ctx))),
      );
    });
    return row as typeof s.messages.$inferSelect;
  }

  listMessages(chatId: string, ctx?: TenantCtx): MessageRow[] {
    return this.many<MessageRow>(
      this.db
        .select()
        .from(this.t.messages)
        .where(and(eq(this.t.messages.chatId, chatId), ...this.scope('messages', ctx)))
        .orderBy(this.t.messages.createdAt),
    );
  }

  /** Rewrite one message's text (used to swap a placeholder question for the owner's words). */
  updateMessageContent(id: string, content: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.messages)
        .set({ content })
        .where(and(eq(this.t.messages.id, id), ...this.scope('messages', ctx))),
    );
  }

  // ---- runs ----

  createRun(
    r: {
      itemId: string;
      chatId: string;
      kind: RunKind;
      mode: Mode;
      adapter: string;
      model?: string | null;
      pinned?: boolean;
      userMessage?: string | null;
    },
    ctx?: TenantCtx,
  ): RunRow {
    const row: Insert<typeof s.runs.$inferInsert> = {
      id: newId(),
      itemId: r.itemId,
      chatId: r.chatId,
      kind: r.kind,
      mode: r.mode,
      adapter: r.adapter,
      model: r.model ?? null,
      pinned: r.pinned ?? false,
      status: 'queued',
      userMessage: r.userMessage ?? null,
      createdAt: nowIso(),
      ...this.stamp(ctx),
    };
    if (this.isPg) {
      const pgDb = this.pg as unknown as {
        insert(t: unknown): { values(v: unknown): PromiseLike<unknown> };
      };
      this.fire(pgDb.insert(pg.runs).values(this.pgVals(row) as never));
      return row as RunRow;
    }
    this.exec(this.db.insert(s.runs).values(row));
    const created = this.getRun(row.id);
    if (!created) throw new Error('insert did not persist run');
    return created;
  }

  getRun(id: string, ctx?: TenantCtx): RunRow | undefined {
    return this.one<RunRow>(
      this.db
        .select()
        .from(this.t.runs)
        .where(and(eq(this.t.runs.id, id), ...this.scope('runs', ctx))),
    );
  }

  updateRun(id: string, patch: Partial<typeof s.runs.$inferInsert>, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.runs)
        .set(patch)
        .where(and(eq(this.t.runs.id, id), ...this.scope('runs', ctx))),
    );
  }

  listRuns(chatId: string, ctx?: TenantCtx): RunRow[] {
    return this.many<RunRow>(
      this.db
        .select()
        .from(this.t.runs)
        .where(and(eq(this.t.runs.chatId, chatId), ...this.scope('runs', ctx)))
        .orderBy(this.t.runs.createdAt),
    );
  }

  /**
   * The queue is deliberately global: the hosted worker runs everyone's queued runs, so this
   * read is never tenant-scoped (the run's own user is resolved from the row for cap checks).
   */
  nextQueuedRun(): RunRow | undefined {
    return this.one<RunRow>(
      this.db
        .select()
        .from(this.t.runs)
        .where(eq(this.t.runs.status, 'queued'))
        .orderBy(this.t.runs.createdAt)
        .limit(1),
    );
  }

  /** Runs left mid-flight by a crash go back to the queue at boot. */
  requeueInterrupted(): void {
    this.exec(
      this.db
        .update(this.t.runs)
        .set({ status: 'queued', startedAt: null })
        .where(sql`${this.t.runs.status} IN ('extracting','researching')`),
    );
  }

  addRunEvent(runId: string, seq: number, type: string, payload: unknown, ctx?: TenantCtx): void {
    this.exec(
      this.db.insert(this.t.runEvents).values({
        runId,
        seq,
        type,
        payload: JSON.stringify(payload),
        at: nowIso(),
        ...this.stamp(ctx),
      }),
    );
  }

  listRunEvents(runId: string, ctx?: TenantCtx): (typeof s.runEvents.$inferSelect)[] {
    return this.many<typeof s.runEvents.$inferSelect>(
      this.db
        .select()
        .from(this.t.runEvents)
        .where(and(eq(this.t.runEvents.runId, runId), ...this.scope('run_events', ctx)))
        .orderBy(this.t.runEvents.seq),
    );
  }

  // ---- extractions / entities / tags ----

  addExtraction(
    e: {
      itemId: string;
      kind: string;
      content: unknown;
      tool?: string;
      model?: string;
      costUsd?: number;
      durationMs?: number;
    },
    ctx?: TenantCtx,
  ): void {
    this.exec(
      this.db.insert(this.t.extractions).values({
        id: newId(),
        itemId: e.itemId,
        kind: e.kind,
        content: JSON.stringify(e.content),
        tool: e.tool ?? null,
        model: e.model ?? null,
        costUsd: e.costUsd ?? null,
        durationMs: e.durationMs ?? null,
        createdAt: nowIso(),
        ...this.stamp(ctx),
      } as Insert<typeof s.extractions.$inferInsert>),
    );
  }

  addMediaAsset(
    a: {
      itemId: string;
      kind: string;
      path: string;
      sha256: string;
      bytes: number;
      durationS?: number | null;
      width?: number | null;
      height?: number | null;
      frameTsS?: number | null;
      source: string;
    },
    ctx?: TenantCtx,
  ): void {
    this.exec(
      this.db.insert(this.t.mediaAssets).values({
        id: newId(),
        itemId: a.itemId,
        kind: a.kind,
        path: a.path,
        sha256: a.sha256,
        bytes: a.bytes,
        durationS: a.durationS ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        frameTsS: a.frameTsS ?? null,
        source: a.source,
        createdAt: nowIso(),
        ...this.stamp(ctx),
      } as Insert<typeof s.mediaAssets.$inferInsert>),
    );
  }

  listMediaAssets(itemId: string, ctx?: TenantCtx): (typeof s.mediaAssets.$inferSelect)[] {
    return this.many<typeof s.mediaAssets.$inferSelect>(
      this.db
        .select()
        .from(this.t.mediaAssets)
        .where(and(eq(this.t.mediaAssets.itemId, itemId), ...this.scope('media_assets', ctx))),
    );
  }

  getMediaAsset(id: string, ctx?: TenantCtx): typeof s.mediaAssets.$inferSelect | undefined {
    return this.one<typeof s.mediaAssets.$inferSelect>(
      this.db
        .select()
        .from(this.t.mediaAssets)
        .where(and(eq(this.t.mediaAssets.id, id), ...this.scope('media_assets', ctx))),
    );
  }

  deleteMediaAssets(itemId: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .delete(this.t.mediaAssets)
        .where(and(eq(this.t.mediaAssets.itemId, itemId), ...this.scope('media_assets', ctx))),
    );
  }

  listExtractions(itemId: string, ctx?: TenantCtx): (typeof s.extractions.$inferSelect)[] {
    return this.many<typeof s.extractions.$inferSelect>(
      this.db
        .select()
        .from(this.t.extractions)
        .where(and(eq(this.t.extractions.itemId, itemId), ...this.scope('extractions', ctx))),
    );
  }

  replaceEntities(itemId: string, runId: string, ents: Answer['entities'], ctx?: TenantCtx): void {
    const now = nowIso();
    this.transaction((tx) => {
      tx.exec(
        tx.db2
          .delete(this.t.entities)
          .where(and(eq(this.t.entities.itemId, itemId), ...this.scope('entities', ctx))),
      );
      for (const e of ents) {
        tx.exec(
          tx.db2.insert(this.t.entities).values({
            id: newId(),
            itemId,
            runId,
            kind: e.kind,
            name: e.name,
            attributes: JSON.stringify(e.attributes ?? {}),
            url: e.url ?? null,
            confidence: e.confidence,
            createdAt: now,
            ...this.stamp(ctx),
          } as Insert<typeof s.entities.$inferInsert>),
        );
      }
    });
  }

  listEntities(itemId: string, ctx?: TenantCtx): (typeof s.entities.$inferSelect)[] {
    return this.many<typeof s.entities.$inferSelect>(
      this.db
        .select()
        .from(this.t.entities)
        .where(and(eq(this.t.entities.itemId, itemId), ...this.scope('entities', ctx))),
    );
  }

  getEntity(id: string, ctx?: TenantCtx): typeof s.entities.$inferSelect | undefined {
    return this.one<typeof s.entities.$inferSelect>(
      this.db
        .select()
        .from(this.t.entities)
        .where(and(eq(this.t.entities.id, id), ...this.scope('entities', ctx))),
    );
  }

  /** Star (or unstar) one thing; undefined when the entity row does not exist. */
  setEntityStarred(
    id: string,
    starred: boolean,
    ctx?: TenantCtx,
  ): typeof s.entities.$inferSelect | undefined {
    this.exec(
      this.db
        .update(this.t.entities)
        .set(this.pgVals({ starred }))
        .where(and(eq(this.t.entities.id, id), ...this.scope('entities', ctx))),
    );
    return this.getEntity(id, ctx);
  }

  setAutoTags(itemId: string, names: string[], ctx?: TenantCtx): void {
    const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      12,
    );
    if (this.isPg) {
      // The tag row must be read before linking; on pg that read is async, so the whole
      // ensure-then-link sequence is queued on the ordering tail (dialect contract above).
      const itemId_ = itemId;
      const ctx_ = ctx;
      this.ex.chain(
        (async () => {
          for (const name of clean) {
            let tag = await this.one<typeof s.tags.$inferSelect>(
              this.db.select().from(this.t.tags).where(eq(this.t.tags.name, name)),
            );
            if (!tag) {
              tag = {
                id: newId(),
                name,
                kind: 'auto',
                ...this.stamp(ctx_),
              } as typeof s.tags.$inferSelect;
              this.exec(this.db.insert(this.t.tags).values(tag));
            }
            this.exec(
              this.db
                .insert(this.t.itemTags)
                .values({
                  itemId: itemId_,
                  tagId: tag.id,
                  confidence: 0.8,
                  ...this.stamp(ctx_),
                } as Insert<typeof s.itemTags.$inferInsert>)
                .onConflictDoNothing(),
            );
          }
        })(),
      );
      return;
    }
    for (const name of clean) {
      // Ensure-then-link; the tags.name unique index arbitrates concurrent creators and a
      // duplicate link is absorbed by onConflictDoNothing.
      this.exec(
        this.db
          .insert(this.t.tags)
          .values({ id: newId(), name, kind: 'auto', ...this.stamp(ctx) } as Insert<
            typeof s.tags.$inferInsert
          >)
          .onConflictDoNothing(),
      );
      const tag = this.one<typeof s.tags.$inferSelect>(
        this.db.select().from(this.t.tags).where(eq(this.t.tags.name, name)),
      );
      if (!tag) continue;
      this.exec(
        this.db
          .insert(this.t.itemTags)
          .values({
            itemId,
            tagId: tag.id,
            confidence: 0.8,
            ...this.stamp(ctx),
          } as Insert<typeof s.itemTags.$inferInsert>)
          .onConflictDoNothing(),
      );
    }
  }

  listTags(itemId: string, ctx?: TenantCtx): string[] {
    return this.manyMap<{ name: string }, string>(
      this.db
        .select({ name: this.t.tags.name })
        .from(this.t.itemTags)
        .innerJoin(this.t.tags, eq(this.t.tags.id, this.t.itemTags.tagId))
        .where(and(eq(this.t.itemTags.itemId, itemId), ...this.scope('item_tags', ctx))),
      (r) => r.name,
    );
  }

  /** Owner-added tag. Reuses an existing tag row of any kind; the link has no confidence. */
  addManualTag(itemId: string, rawName: string, ctx?: TenantCtx): string | null {
    const name = normalizeTag(rawName);
    if (!name) return null;
    if (this.isPg) {
      this.ex.chain(
        (async () => {
          let tag = await this.one<typeof s.tags.$inferSelect>(
            this.db.select().from(this.t.tags).where(eq(this.t.tags.name, name)),
          );
          if (!tag) {
            tag = {
              id: newId(),
              name,
              kind: 'manual',
              ...this.stamp(ctx),
            } as typeof s.tags.$inferSelect;
            this.exec(this.db.insert(this.t.tags).values(tag));
          }
          this.exec(
            this.db
              .insert(this.t.itemTags)
              .values({ itemId, tagId: tag.id, ...this.stamp(ctx) } as Insert<
                typeof s.itemTags.$inferInsert
              >)
              .onConflictDoNothing(),
          );
        })(),
      );
      return name;
    }
    this.exec(
      this.db
        .insert(this.t.tags)
        .values({ id: newId(), name, kind: 'manual', ...this.stamp(ctx) } as Insert<
          typeof s.tags.$inferInsert
        >)
        .onConflictDoNothing(),
    );
    const tag = this.one<typeof s.tags.$inferSelect>(
      this.db.select().from(this.t.tags).where(eq(this.t.tags.name, name)),
    );
    if (!tag) return name;
    this.exec(
      this.db
        .insert(this.t.itemTags)
        .values({ itemId, tagId: tag.id, ...this.stamp(ctx) } as Insert<
          typeof s.itemTags.$inferInsert
        >)
        .onConflictDoNothing(),
    );
    return name;
  }

  /** Unlink a tag from an item; drops the tag row when nothing else uses it. */
  removeTag(itemId: string, rawName: string, ctx?: TenantCtx): boolean {
    const name = normalizeTag(rawName);
    const tag = this.one<typeof s.tags.$inferSelect>(
      this.db.select().from(this.t.tags).where(eq(this.t.tags.name, name)),
    );
    if (!tag) return false;
    const r = this.exec(
      this.db
        .delete(this.t.itemTags)
        .where(
          and(
            eq(this.t.itemTags.itemId, itemId),
            eq(this.t.itemTags.tagId, tag.id),
            ...this.scope('item_tags', ctx),
          ),
        ),
    );
    const left = this.one<{ n: number }>(
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(this.t.itemTags)
        .where(eq(this.t.itemTags.tagId, tag.id)),
    );
    if (!left || left.n === 0)
      this.exec(this.db.delete(this.t.tags).where(eq(this.t.tags.id, tag.id)));
    return r.changes > 0;
  }

  /** Every tag in use with how many items carry it, most used first. */
  listAllTags(ctx?: TenantCtx): { name: string; kind: 'auto' | 'manual'; count: number }[] {
    return this.manyMap<
      { name: string; kind: string; count: number },
      {
        name: string;
        kind: 'auto' | 'manual';
        count: number;
      }
    >(
      this.db
        .select({
          name: this.t.tags.name,
          kind: this.t.tags.kind,
          count: sql<number>`count(${this.t.itemTags.itemId})`,
        })
        .from(this.t.tags)
        .innerJoin(this.t.itemTags, eq(this.t.itemTags.tagId, this.t.tags.id))
        .where(and(...this.scope('item_tags', ctx)))
        .groupBy(this.t.tags.id)
        .orderBy(desc(sql`count(${this.t.itemTags.itemId})`), this.t.tags.name),
      (r) => ({
        name: r.name,
        kind: r.kind === 'manual' ? 'manual' : 'auto',
        count: r.count,
      }),
    );
  }

  /** Item ids carrying the tag. */
  itemIdsByTag(rawName: string, ctx?: TenantCtx): string[] {
    const name = normalizeTag(rawName);
    return this.manyMap<{ itemId: string }, string>(
      this.db
        .select({ itemId: this.t.itemTags.itemId })
        .from(this.t.itemTags)
        .innerJoin(this.t.tags, eq(this.t.tags.id, this.t.itemTags.tagId))
        .where(and(eq(this.t.tags.name, name), ...this.scope('item_tags', ctx))),
      (r) => r.itemId,
    );
  }

  // ---- collections ----

  listCollections(includeHidden = false, ctx?: TenantCtx): (typeof s.collections.$inferSelect)[] {
    if (!this.isPg) {
      const rows = this.many<typeof s.collections.$inferSelect>(
        this.db
          .select()
          .from(this.t.collections)
          .where(and(...this.scope('collections', ctx)))
          .orderBy(this.t.collections.name),
      );
      return includeHidden ? rows : rows.filter((c) => !c.hidden);
    }
    return lazy(
      Promise.resolve(
        this.many<typeof s.collections.$inferSelect>(
          this.db
            .select()
            .from(this.t.collections)
            .where(and(...this.scope('collections', ctx)))
            .orderBy(this.t.collections.name),
        ),
      ).then((rows) => (includeHidden ? rows : rows.filter((c) => !c.hidden))),
    );
  }

  getCollection(id: string, ctx?: TenantCtx): typeof s.collections.$inferSelect | undefined {
    return this.one<typeof s.collections.$inferSelect>(
      this.db
        .select()
        .from(this.t.collections)
        .where(and(eq(this.t.collections.id, id), ...this.scope('collections', ctx))),
    );
  }

  findCollectionByName(
    name: string,
    ctx?: TenantCtx,
  ): typeof s.collections.$inferSelect | undefined {
    return this.one<typeof s.collections.$inferSelect>(
      this.db
        .select()
        .from(this.t.collections)
        .where(and(eq(this.t.collections.name, name), ...this.scope('collections', ctx))),
    );
  }

  /**
   * Share pages are unscoped on purpose: the random token in the URL is the whole credential
   * (ADR 0025) and must resolve regardless of who created the collection.
   */
  findCollectionByShareToken(token: string): typeof s.collections.$inferSelect | undefined {
    return this.one<typeof s.collections.$inferSelect>(
      this.db.select().from(this.t.collections).where(eq(this.t.collections.shareToken, token)),
    );
  }

  findCollectionByQuery(
    query: string,
    ctx?: TenantCtx,
  ): typeof s.collections.$inferSelect | undefined {
    return this.one<typeof s.collections.$inferSelect>(
      this.db
        .select()
        .from(this.t.collections)
        .where(and(eq(this.t.collections.query, query), ...this.scope('collections', ctx))),
    );
  }

  createCollection(
    c: { name: string; query: string; manual: boolean; auto: boolean },
    ctx?: TenantCtx,
  ): string {
    const id = newId();
    this.exec(
      this.db
        .insert(this.t.collections)
        .values(
          this.pgVals({ id, ...c, hidden: false, ...this.stamp(ctx) }) as Insert<
            typeof s.collections.$inferInsert
          >,
        ),
    );
    return id;
  }

  updateCollection(
    id: string,
    patch: Partial<
      Pick<typeof s.collections.$inferInsert, 'name' | 'query' | 'hidden' | 'shareToken'>
    >,
    ctx?: TenantCtx,
  ): void {
    this.exec(
      this.db
        .update(this.t.collections)
        .set(this.pgVals(patch))
        .where(and(eq(this.t.collections.id, id), ...this.scope('collections', ctx))),
    );
  }

  deleteCollection(id: string, ctx?: TenantCtx): boolean {
    return (
      this.exec(
        this.db
          .delete(this.t.collections)
          .where(and(eq(this.t.collections.id, id), ...this.scope('collections', ctx))),
      ).changes > 0
    );
  }

  addCollectionItem(collectionId: string, itemId: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .insert(this.t.collectionItems)
        .values({
          collectionId,
          itemId,
          addedAt: nowIso(),
          ...this.stamp(ctx),
        } as Insert<typeof s.collectionItems.$inferInsert>)
        .onConflictDoNothing(),
    );
  }

  removeCollectionItem(collectionId: string, itemId: string, ctx?: TenantCtx): boolean {
    return (
      this.exec(
        this.db
          .delete(this.t.collectionItems)
          .where(
            and(
              eq(this.t.collectionItems.collectionId, collectionId),
              eq(this.t.collectionItems.itemId, itemId),
              ...this.scope('collection_items', ctx),
            ),
          ),
      ).changes > 0
    );
  }

  collectionItemIds(collectionId: string, ctx?: TenantCtx): string[] {
    return this.manyMap<{ itemId: string }, string>(
      this.db
        .select({ itemId: this.t.collectionItems.itemId })
        .from(this.t.collectionItems)
        .where(
          and(
            eq(this.t.collectionItems.collectionId, collectionId),
            ...this.scope('collection_items', ctx),
          ),
        )
        .orderBy(desc(this.t.collectionItems.addedAt)),
      (r) => r.itemId,
    );
  }

  collectionsForItem(itemId: string, ctx?: TenantCtx): string[] {
    return this.manyMap<{ collectionId: string }, string>(
      this.db
        .select({ collectionId: this.t.collectionItems.collectionId })
        .from(this.t.collectionItems)
        .where(
          and(eq(this.t.collectionItems.itemId, itemId), ...this.scope('collection_items', ctx)),
        ),
      (r) => r.collectionId,
    );
  }

  itemIdsByCategory(category: string, ctx?: TenantCtx): string[] {
    return this.manyMap<{ id: string }, string>(
      this.db
        .select({ id: this.t.items.id })
        .from(this.t.items)
        .where(and(eq(this.t.items.category, category), ...this.scope('items', ctx))),
      (r) => r.id,
    );
  }

  itemIdsByEntityKind(kind: string, ctx?: TenantCtx): string[] {
    return this.manyMap<{ itemId: string }, string>(
      this.db
        .selectDistinct({ itemId: this.t.entities.itemId })
        .from(this.t.entities)
        .where(and(eq(this.t.entities.kind, kind), ...this.scope('entities', ctx))),
      (r) => r.itemId,
    );
  }

  /**
   * Every entity of one kind across the library, newest item first. `starred` narrows the list:
   * true for starred only, false for unstarred only, undefined for everything.
   */
  listEntitiesByKind(
    kind: string,
    limit = 500,
    starred?: boolean,
    ctx?: TenantCtx,
  ): { entity: typeof s.entities.$inferSelect; item: ItemRow; chatId: string }[] {
    const filters = [eq(this.t.entities.kind, kind), ...this.scope('entities', ctx)];
    if (starred !== undefined) filters.push(eq(this.t.entities.starred, starred));
    return this.many<{
      entity: typeof s.entities.$inferSelect;
      item: ItemRow;
      chatId: string;
    }>(
      this.db
        .select({ entity: this.t.entities, item: this.t.items, chatId: this.t.chats.id })
        .from(this.t.entities)
        .innerJoin(this.t.items, eq(this.t.items.id, this.t.entities.itemId))
        .innerJoin(this.t.chats, eq(this.t.chats.itemId, this.t.items.id))
        .where(and(...filters))
        .orderBy(desc(this.t.items.createdAt))
        .limit(limit),
    );
  }

  /**
   * Bulk payload for the map-of-everything graph: entity rows and tag links for one set of
   * items (the chats inside the graph cap). Two indexed selects instead of a per-item walk.
   * Entities come newest first — ULID ids sort by creation time, so `id desc` is stable even
   * when rows share a `created_at`.
   */
  graphData(
    itemIds: string[],
    entityLimit: number,
    ctx?: TenantCtx,
  ): {
    entities: (typeof s.entities.$inferSelect)[];
    tagLinks: { itemId: string; name: string }[];
  } {
    if (itemIds.length === 0)
      return { entities: [], tagLinks: [] as { itemId: string; name: string }[] };
    const entities = this.many<typeof s.entities.$inferSelect>(
      this.db
        .select()
        .from(this.t.entities)
        .where(and(inArray(this.t.entities.itemId, itemIds), ...this.scope('entities', ctx)))
        .orderBy(desc(this.t.entities.id))
        .limit(entityLimit),
    );
    const tagLinks = this.many<{ itemId: string; name: string }>(
      this.db
        .select({ itemId: this.t.itemTags.itemId, name: this.t.tags.name })
        .from(this.t.itemTags)
        .innerJoin(this.t.tags, eq(this.t.tags.id, this.t.itemTags.tagId))
        .where(and(inArray(this.t.itemTags.itemId, itemIds), ...this.scope('item_tags', ctx))),
    );
    return { entities, tagLinks };
  }

  // ---- todos (ADR 0031) ----
  /**
   * `open` = on the list and not ticked; `done` = ticked (a ticked entry keeps `status='open'`);
   * `all` = both; `suggested` = brain proposals awaiting the owner's approve/dismiss, which never
   * appear under `open`/`done`/`all`.
   */
  listTodos(
    filter: 'open' | 'done' | 'all' | 'suggested' = 'open',
    ctx?: TenantCtx,
  ): { todo: typeof s.todos.$inferSelect; chatTitle: string | null }[] {
    const where =
      filter === 'open'
        ? and(
            eq(this.t.todos.status, 'open'),
            isNull(this.t.todos.doneAt),
            ...this.scope('todos', ctx),
          )
        : filter === 'done'
          ? and(sql`${this.t.todos.doneAt} is not null`, ...this.scope('todos', ctx))
          : filter === 'suggested'
            ? and(eq(this.t.todos.status, 'suggested'), ...this.scope('todos', ctx))
            : and(eq(this.t.todos.status, 'open'), ...this.scope('todos', ctx));
    return this.many<{ todo: typeof s.todos.$inferSelect; chatTitle: string | null }>(
      this.db
        .select({ todo: this.t.todos, chatTitle: this.t.items.title })
        .from(this.t.todos)
        .leftJoin(this.t.chats, eq(this.t.chats.id, this.t.todos.chatId))
        .leftJoin(this.t.items, eq(this.t.items.id, this.t.chats.itemId))
        .where(where)
        .orderBy(desc(this.t.todos.createdAt)),
    );
  }
  getTodo(id: string, ctx?: TenantCtx): typeof s.todos.$inferSelect | undefined {
    return this.one<typeof s.todos.$inferSelect>(
      this.db
        .select()
        .from(this.t.todos)
        .where(and(eq(this.t.todos.id, id), ...this.scope('todos', ctx))),
    );
  }
  countOpenTodos(ctx?: TenantCtx): number {
    return (
      this.one<{ n: number }>(
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(this.t.todos)
          .where(
            and(
              eq(this.t.todos.status, 'open'),
              isNull(this.t.todos.doneAt),
              ...this.scope('todos', ctx),
            ),
          ),
      )?.n ?? 0
    );
  }
  createTodo(
    input: {
      kind: string;
      title: string;
      url?: string | null | undefined;
      note?: string | null | undefined;
      attributes?: Record<string, unknown> | undefined;
      chatId?: string | null | undefined;
    },
    status: 'open' | 'suggested' = 'open',
    ctx?: TenantCtx,
  ): typeof s.todos.$inferSelect {
    const row = {
      id: newId(),
      kind: input.kind,
      title: input.title,
      url: input.url ?? null,
      note: input.note ?? null,
      attributes: JSON.stringify(input.attributes ?? {}),
      chatId: input.chatId ?? null,
      status,
      doneAt: null,
      createdAt: nowIso(),
      ...this.stamp(ctx),
    } as Insert<typeof s.todos.$inferInsert>;
    this.exec(this.db.insert(this.t.todos).values(row));
    return row as typeof s.todos.$inferSelect;
  }
  updateTodo(
    id: string,
    patch: {
      done?: boolean | undefined;
      title?: string | undefined;
      note?: string | null | undefined;
    },
    ctx?: TenantCtx,
  ): typeof s.todos.$inferSelect | undefined {
    const set: Partial<typeof s.todos.$inferInsert> = {};
    if (patch.done !== undefined) set.doneAt = patch.done ? nowIso() : null;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.note !== undefined) set.note = patch.note;
    if (Object.keys(set).length)
      this.exec(
        this.db
          .update(this.t.todos)
          .set(set)
          .where(and(eq(this.t.todos.id, id), ...this.scope('todos', ctx))),
      );
    return this.getTodo(id, ctx);
  }
  /** Move a brain suggestion onto the list; undefined when the row was not a suggestion. */
  approveTodo(id: string, ctx?: TenantCtx): typeof s.todos.$inferSelect | undefined {
    this.exec(
      this.db
        .update(this.t.todos)
        .set({ status: 'open' })
        .where(
          and(
            eq(this.t.todos.id, id),
            eq(this.t.todos.status, 'suggested'),
            ...this.scope('todos', ctx),
          ),
        ),
    );
    const row = this.getTodo(id, ctx);
    return row?.status === 'open' ? row : undefined;
  }
  deleteTodo(id: string, ctx?: TenantCtx): boolean {
    return (
      this.exec(
        this.db
          .delete(this.t.todos)
          .where(and(eq(this.t.todos.id, id), ...this.scope('todos', ctx))),
      ).changes > 0
    );
  }

  // ---- place geocache (ADR 0022) ----
  getPlaceGeo(query: string, ctx?: TenantCtx): typeof s.placeGeo.$inferSelect | undefined {
    return this.one<typeof s.placeGeo.$inferSelect>(
      this.db
        .select()
        .from(this.t.placeGeo)
        .where(and(eq(this.t.placeGeo.query, query), ...this.scope('place_geo', ctx))),
    );
  }
  putPlaceGeo(
    row: {
      query: string;
      lat: number | null;
      lon: number | null;
      label: string | null;
      provider: string;
    },
    ctx?: TenantCtx,
  ): void {
    this.exec(
      this.db
        .insert(this.t.placeGeo)
        .values({ ...row, resolvedAt: nowIso(), ...this.stamp(ctx) } as Insert<
          typeof s.placeGeo.$inferInsert
        >)
        .onConflictDoUpdate({
          target: this.t.placeGeo.query,
          set: {
            lat: row.lat,
            lon: row.lon,
            label: row.label,
            provider: row.provider,
            resolvedAt: nowIso(),
          },
        }),
    );
  }
  /** Forget cached misses so the next lookup asks the geocoder again; returns how many. */
  clearPlaceGeoMisses(): number {
    return this.exec(this.db.delete(this.t.placeGeo).where(isNull(this.t.placeGeo.lat))).changes;
  }
  /** Every cached geocode, for joining onto place entities in one pass. */
  listPlaceGeo(ctx?: TenantCtx): (typeof s.placeGeo.$inferSelect)[] {
    return this.many<typeof s.placeGeo.$inferSelect>(
      this.db
        .select()
        .from(this.t.placeGeo)
        .where(and(...this.scope('place_geo', ctx))),
    );
  }

  // ---- FTS ----

  upsertFts(
    itemId: string,
    doc: {
      title: string;
      note: string;
      transcript: string;
      ocr: string;
      answer: string;
      tags: string;
      entities: string;
    },
    _ctx?: TenantCtx,
  ): void {
    // Postgres full-text search is a later hosted-mode step (see schema.pg.ts TODO); the FTS5
    // table only exists on the SQLite path, so hosted mode indexes nothing here yet.
    if (this.isPg || !this.sqlite) return;
    this.sqlite.prepare('DELETE FROM items_fts WHERE item_id = ?').run(itemId);
    this.sqlite
      .prepare(
        'INSERT INTO items_fts (item_id, title, note, transcript, ocr, answer, tags, entities) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        itemId,
        doc.title,
        doc.note,
        doc.transcript,
        doc.ocr,
        doc.answer,
        doc.tags,
        doc.entities,
      );
  }

  /**
   * SQLite: FTS5 `MATCH`. Postgres (hosted): a case-insensitive `ILIKE` stopgap over the item's
   * own text until the tsvector port lands — both paths are tenant-scoped via `scope` when a
   * context is given, so results never cross users in hosted mode.
   */
  searchFts(query: string, limit = 50, ctx?: TenantCtx): string[] {
    if (this.isPg) {
      // Hosted FTS stopgap (ADR 0032 addendum): ILIKE over title/note/text. Input arrives either
      // raw ('alpha') or as ftsQuery output ('"ski wax"*'); the FTS syntax characters become
      // separators and the remaining terms are OR-ed per column, so a prefix query and a raw
      // term behave the same on both dialects.
      const terms = query
        .replace(/[*"()%_]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .slice(0, 8);
      if (terms.length === 0) return [];
      const matchers = terms.flatMap((term) => [
        ilike(this.t.items.title, `%${term}%`),
        ilike(this.t.items.note, `%${term}%`),
        ilike(this.t.items.text, `%${term}%`),
      ]);
      return this.manyMap<{ id: string }, string>(
        this.db
          .select({ id: this.t.items.id })
          .from(this.t.items)
          .where(and(or(...matchers), ...this.scope('items', ctx)))
          .limit(limit),
        (r) => r.id,
      );
    }
    if (!this.sqlite) return [];
    const rows = this.sqlite
      .prepare('SELECT item_id FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(query, limit) as { item_id: string }[];
    return rows.map((r) => r.item_id);
  }

  // ---- cost ----

  addCost(
    adapter: string,
    model: string | null,
    costUsd: number,
    runId: string,
    ctx?: TenantCtx,
    credentialId?: string | null,
  ): void {
    const now = nowIso();
    this.exec(
      this.db.insert(this.t.costLedger).values({
        day: now.slice(0, 10),
        adapter,
        model,
        costUsd,
        runId,
        createdAt: now,
        ...this.stamp(ctx),
        ...(this.isPg && credentialId ? { credentialId } : {}),
      } as Insert<typeof s.costLedger.$inferInsert>),
    );
  }

  /** Sum of ledger rows recorded against one run (hosted per-run cap enforcement, ADR 0032). */
  spentOnRun(runId: string, ctx?: TenantCtx): number {
    const r = this.one<{ total: number }>(
      this.db
        .select({ total: sql<number>`coalesce(sum(${this.t.costLedger.costUsd}), 0)` })
        .from(this.t.costLedger)
        .where(and(eq(this.t.costLedger.runId, runId), ...this.scope('cost_ledger', ctx))),
    );
    return r?.total ?? 0;
  }

  spentToday(ctx?: TenantCtx): number {
    const day = nowIso().slice(0, 10);
    const r = this.one<{ total: number }>(
      this.db
        .select({ total: sql<number>`coalesce(sum(${this.t.costLedger.costUsd}), 0)` })
        .from(this.t.costLedger)
        .where(and(eq(this.t.costLedger.day, day), ...this.scope('cost_ledger', ctx))),
    );
    return r?.total ?? 0;
  }

  // ---- instagram ----

  getIgAccount(): typeof s.igAccounts.$inferSelect | undefined {
    return this.one<typeof s.igAccounts.$inferSelect>(
      this.db.select().from(this.t.igAccounts).limit(1),
    );
  }
  upsertIgAccount(row: {
    igUserId: string;
    username: string | null;
    accessTokenEnc: string;
    expiresAt: string | null;
    refreshedAt: string | null;
  }) {
    const now = nowIso();
    // v1 holds exactly one shadow account; connecting another replaces it.
    this.exec(this.db.delete(this.t.igAccounts));
    this.exec(this.db.insert(this.t.igAccounts).values({ ...row, createdAt: now, updatedAt: now }));
  }
  updateIgAccount(
    igUserId: string,
    patch: Partial<
      Pick<
        typeof s.igAccounts.$inferInsert,
        'accessTokenEnc' | 'expiresAt' | 'refreshedAt' | 'username'
      >
    >,
  ) {
    this.exec(
      this.db
        .update(this.t.igAccounts)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(this.t.igAccounts.igUserId, igUserId)),
    );
  }
  deleteIgAccount() {
    this.exec(this.db.delete(this.t.igAccounts));
  }

  /**
   * Returns false when the event id was already recorded (webhook redelivery). On pg the
   * boolean arrives lazily (dialect contract): hosted callers `await`, SQLite callers keep the
   * plain synchronous value.
   */
  recordIgEvent(row: {
    id: string;
    kind: string;
    raw: unknown;
    senderId?: string | null;
  }): boolean {
    const q = this.db
      .insert(this.t.igEvents)
      .values({
        id: row.id,
        kind: row.kind,
        raw: JSON.stringify(row.raw),
        senderId: row.senderId ?? null,
        receivedAt: nowIso(),
      })
      .onConflictDoNothing();
    if (!this.isPg) return q.run().changes > 0;
    return lazy((async () => (await this.exec(q)).changes > 0)()) as unknown as boolean;
  }
  markIgEvent(id: string, patch: { itemId?: string | null; error?: string | null }) {
    this.exec(
      this.db
        .update(this.t.igEvents)
        .set({ ...patch, processedAt: nowIso() })
        .where(eq(this.t.igEvents.id, id)),
    );
  }
  /** DM-share events that produced this item (for the completion reaction). */
  igEventsForItem(itemId: string): (typeof s.igEvents.$inferSelect)[] {
    return this.many<typeof s.igEvents.$inferSelect>(
      this.db.select().from(this.t.igEvents).where(eq(this.t.igEvents.itemId, itemId)),
    );
  }
  listIgEvents(limit = 50): (typeof s.igEvents.$inferSelect)[] {
    return this.many<typeof s.igEvents.$inferSelect>(
      this.db.select().from(this.t.igEvents).orderBy(desc(this.t.igEvents.receivedAt)).limit(limit),
    );
  }

  /**
   * Postgres handle for the tables that exist ONLY in hosted mode (`igPrompts`, `igPromptOptouts`).
   * They are absent from the SQLite schema by design, so `this.t` cannot name them; `this.pgDb`
   * is the accurately-typed pg db (unlike `this.db`, whose type is the documented dialect lie).
   */
  private get pgOnly(): {
    igPrompts: typeof pg.igPrompts;
    igPromptOptouts: typeof pg.igPromptOptouts;
  } {
    return pg;
  }

  /** The pg db, typed honestly. Only valid when `isPg`; those call sites never run on SQLite. */
  private get pgDb(): PgDb {
    if (!this.pg) throw new Error('pg-only method called on a SQLite database');
    return this.pg;
  }

  /**
   * Hosted prompt gate (ADR 0032): prompt a stranger at most once per `windowMs`. Claims the
   * window atomically — the row is upserted only when it is missing or older than the window, so
   * two webhook deliveries racing the same sender cannot both send a prompt. Returns true when
   * the caller should send. Postgres-only; the self-hosted path never prompts. On pg the boolean
   * arrives lazily (dialect contract): hosted callers await it.
   */
  claimIgPrompt(senderId: string, windowMs: number, now = Date.now()): boolean {
    const { igPrompts } = this.pgOnly;
    const nowText = String(now);
    const q = this.pgDb
      .insert(igPrompts)
      .values({ senderId, lastPromptAt: nowText })
      .onConflictDoUpdate({
        target: igPrompts.senderId,
        set: { lastPromptAt: nowText },
        where: sql`cast(${igPrompts.lastPromptAt} as bigint) <= ${now - windowMs}`,
      });
    return lazy((async () => (await this.exec(q)).changes > 0)()) as unknown as boolean;
  }

  /**
   * Has this sender opted out of prompts (STOP/UNSUBSCRIBE)? Never prompts them again.
   * Postgres-only; on pg the boolean arrives lazily (dialect contract): hosted callers await it.
   */
  isIgPromptOptedOut(senderId: string): boolean {
    const { igPromptOptouts } = this.pgOnly;
    const rows = this.pgDb
      .select({ senderId: igPromptOptouts.senderId })
      .from(igPromptOptouts)
      .where(eq(igPromptOptouts.senderId, senderId));
    return lazy((async () => (await rows).length > 0)()) as unknown as boolean;
  }

  /**
   * Record a STOP/UNSUBSCRIBE reply. Idempotent: a repeat is a no-op, not an error. Postgres-only.
   * Returns the write's completion so the caller can `await` it before reading the opt-out back
   * (the other pg writers in this class share the same lazy-await contract).
   */
  recordIgPromptOptout(senderId: string, now = Date.now()): void {
    const { igPromptOptouts } = this.pgOnly;
    const p = this.pgDb
      .insert(igPromptOptouts)
      .values({ senderId, createdAt: new Date(now).toISOString() })
      .onConflictDoNothing();
    this.exec(p);
    // Chain the raw completion too: `exec` returns before its tail drains, and the webhook gate
    // reads the opt-out straight back on the next DM.
    this.ex.chain(p);
  }

  // ---- pending notifications (quiet hours, ADR 0020) ----

  enqueueNotification(n: {
    chatId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
  }) {
    const row: typeof s.pendingNotifications.$inferInsert = {
      id: newId(),
      ...n,
      createdAt: nowIso(),
    };
    this.exec(this.db.insert(s.pendingNotifications).values(row));
    return row;
  }
  listPendingNotifications() {
    return this.many<typeof s.pendingNotifications.$inferSelect>(
      this.db.select().from(s.pendingNotifications).orderBy(s.pendingNotifications.createdAt),
    );
  }
  countPendingNotifications(): number {
    const row = this.one<{ n: number }>(
      this.db.select({ n: sql<number>`count(*)` }).from(s.pendingNotifications),
    );
    return Number(row?.n ?? 0);
  }
  clearPendingNotifications(ids: string[]) {
    for (const id of ids)
      this.exec(this.db.delete(s.pendingNotifications).where(eq(s.pendingNotifications.id, id)));
  }

  // ---- settings / devices ----

  getSetting(key: string): string | undefined {
    return this.one<{ value: string }>(
      this.db.select().from(s.settings).where(eq(s.settings.key, key)),
    )?.value;
  }
  setSetting(key: string, value: string) {
    this.exec(
      this.db
        .insert(s.settings)
        .values({ key, value, updatedAt: nowIso() })
        .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: nowIso() } }),
    );
  }

  createDevice(name: string, platform: string, tokenHash: string, ctx?: TenantCtx) {
    const row: Insert<typeof s.devices.$inferInsert> = {
      id: newId(),
      name,
      platform,
      tokenHash,
      createdAt: nowIso(),
      ...this.stamp(ctx),
    };
    this.exec(this.db.insert(this.t.devices).values(row));
    return row as typeof s.devices.$inferInsert;
  }
  findDeviceByTokenHash(hash: string, ctx?: TenantCtx): typeof s.devices.$inferSelect | undefined {
    return this.one<typeof s.devices.$inferSelect>(
      this.db
        .select()
        .from(this.t.devices)
        .where(
          and(
            eq(this.t.devices.tokenHash, hash),
            sql`${this.t.devices.revokedAt} IS NULL`,
            ...this.scope('devices', ctx),
          ),
        ),
    );
  }
  touchDevice(id: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.devices)
        .set({ lastSeenAt: nowIso() })
        .where(and(eq(this.t.devices.id, id), ...this.scope('devices', ctx))),
    );
  }
  listDevices(ctx?: TenantCtx): (typeof s.devices.$inferSelect)[] {
    return this.many<typeof s.devices.$inferSelect>(
      this.db
        .select()
        .from(this.t.devices)
        .where(and(...this.scope('devices', ctx)))
        .orderBy(desc(this.t.devices.createdAt)),
    );
  }
  revokeDevice(id: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.devices)
        .set({ revokedAt: nowIso() })
        .where(and(eq(this.t.devices.id, id), ...this.scope('devices', ctx))),
    );
  }

  // ---- push subscriptions ----

  upsertPushSubscription(
    deviceId: string,
    kind: string,
    endpoint: string,
    keys: string | null,
    ctx?: TenantCtx,
  ) {
    const existing = this.one<typeof s.pushSubscriptions.$inferSelect>(
      this.db
        .select()
        .from(this.t.pushSubscriptions)
        .where(eq(this.t.pushSubscriptions.endpoint, endpoint)),
    );
    if (existing) {
      this.exec(
        this.db
          .update(this.t.pushSubscriptions)
          .set({ deviceId, kind, keys, failedCount: 0 })
          .where(eq(this.t.pushSubscriptions.id, existing.id)),
      );
      return { ...existing, deviceId, kind, keys, failedCount: 0 };
    }
    const row: Insert<typeof s.pushSubscriptions.$inferInsert> = {
      id: newId(),
      deviceId,
      kind,
      endpoint,
      keys,
      failedCount: 0,
      createdAt: nowIso(),
      ...this.stamp(ctx),
    };
    this.exec(this.db.insert(this.t.pushSubscriptions).values(row));
    return row as typeof s.pushSubscriptions.$inferInsert;
  }
  listPushSubscriptions(ctx?: TenantCtx) {
    // Revoked devices keep their rows (cascade only on delete) but must not be notified.
    return this.many<{
      id: string;
      deviceId: string;
      kind: string;
      endpoint: string;
      keys: string | null;
      failedCount: number;
    }>(
      this.db
        .select({
          id: this.t.pushSubscriptions.id,
          deviceId: this.t.pushSubscriptions.deviceId,
          kind: this.t.pushSubscriptions.kind,
          endpoint: this.t.pushSubscriptions.endpoint,
          keys: this.t.pushSubscriptions.keys,
          failedCount: this.t.pushSubscriptions.failedCount,
        })
        .from(this.t.pushSubscriptions)
        .innerJoin(this.t.devices, eq(this.t.devices.id, this.t.pushSubscriptions.deviceId))
        .where(
          and(sql`${this.t.devices.revokedAt} IS NULL`, ...this.scope('push_subscriptions', ctx)),
        ),
    );
  }
  listPushSubscriptionsForDevice(deviceId: string, ctx?: TenantCtx) {
    return this.many<typeof s.pushSubscriptions.$inferSelect>(
      this.db
        .select()
        .from(this.t.pushSubscriptions)
        .where(
          and(
            eq(this.t.pushSubscriptions.deviceId, deviceId),
            ...this.scope('push_subscriptions', ctx),
          ),
        ),
    );
  }
  deletePushSubscription(id: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .delete(this.t.pushSubscriptions)
        .where(and(eq(this.t.pushSubscriptions.id, id), ...this.scope('push_subscriptions', ctx))),
    );
  }
  deletePushSubscriptionByEndpoint(deviceId: string, endpoint: string, ctx?: TenantCtx): boolean {
    const r = this.exec(
      this.db
        .delete(this.t.pushSubscriptions)
        .where(
          and(
            eq(this.t.pushSubscriptions.deviceId, deviceId),
            eq(this.t.pushSubscriptions.endpoint, endpoint),
            ...this.scope('push_subscriptions', ctx),
          ),
        ),
    );
    return r.changes > 0;
  }
  bumpPushFailure(id: string, ctx?: TenantCtx): number {
    this.exec(
      this.db
        .update(this.t.pushSubscriptions)
        .set({ failedCount: sql`${this.t.pushSubscriptions.failedCount} + 1` })
        .where(and(eq(this.t.pushSubscriptions.id, id), ...this.scope('push_subscriptions', ctx))),
    );
    return (
      this.one<{ failedCount: number }>(
        this.db
          .select({ failedCount: this.t.pushSubscriptions.failedCount })
          .from(this.t.pushSubscriptions)
          .where(eq(this.t.pushSubscriptions.id, id)),
      )?.failedCount ?? 0
    );
  }
  resetPushFailures(id: string, ctx?: TenantCtx): void {
    this.exec(
      this.db
        .update(this.t.pushSubscriptions)
        .set({ failedCount: 0 })
        .where(and(eq(this.t.pushSubscriptions.id, id), ...this.scope('push_subscriptions', ctx))),
    );
  }
}

/** Tags are lowercase, trimmed, single-spaced, at most 40 chars. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
}
