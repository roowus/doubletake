import type { Answer, IngestRequest, Mode, Platform, RunKind } from '@doubletake/shared';
import { newId, nowIso } from '@doubletake/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from './index.js';
import * as s from './schema.js';

export type ItemRow = typeof s.items.$inferSelect;
export type ChatRow = typeof s.chats.$inferSelect;
export type RunRow = typeof s.runs.$inferSelect;
export type MessageRow = typeof s.messages.$inferSelect;

export class Repo {
  constructor(
    readonly db: Db,
    readonly sqlite: import('better-sqlite3').Database,
  ) {}

  // ---- items / chats ----

  findRecentDuplicate(canonicalUrl: string, focus: string, hours = 24): ItemRow | undefined {
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    return this.db
      .select()
      .from(s.items)
      .where(
        and(
          eq(s.items.canonicalUrl, canonicalUrl),
          eq(s.items.focus, focus),
          gte(s.items.createdAt, since),
        ),
      )
      .orderBy(desc(s.items.createdAt))
      .get();
  }

  createItemWithChat(
    req: IngestRequest,
    platform: Platform,
    canonicalUrl: string | null,
    title: string,
  ) {
    const now = nowIso();
    const item: typeof s.items.$inferInsert = {
      id: newId(),
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
      createdAt: now,
      updatedAt: now,
    };
    const chat: typeof s.chats.$inferInsert = {
      id: newId(),
      itemId: item.id,
      unreadCount: 0,
      createdAt: now,
    };
    this.db.transaction((tx) => {
      tx.insert(s.items).values(item).run();
      tx.insert(s.chats).values(chat).run();
    });
    const created = this.getItem(item.id);
    const createdChat = this.getChat(chat.id);
    if (!created || !createdChat) throw new Error('insert did not persist item/chat');
    return { item: created, chat: createdChat };
  }

  getItem(id: string) {
    return this.db.select().from(s.items).where(eq(s.items.id, id)).get();
  }
  getChat(id: string) {
    return this.db.select().from(s.chats).where(eq(s.chats.id, id)).get();
  }
  getChatByItem(itemId: string) {
    return this.db.select().from(s.chats).where(eq(s.chats.itemId, itemId)).get();
  }

  updateItem(id: string, patch: Partial<typeof s.items.$inferInsert>) {
    this.db
      .update(s.items)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(s.items.id, id))
      .run();
  }

  updateChat(id: string, patch: Partial<typeof s.chats.$inferInsert>) {
    this.db.update(s.chats).set(patch).where(eq(s.chats.id, id)).run();
  }

  listChats(limit = 200) {
    return this.db
      .select({ chat: s.chats, item: s.items })
      .from(s.chats)
      .innerJoin(s.items, eq(s.items.id, s.chats.itemId))
      .orderBy(desc(sql`coalesce(${s.chats.lastMessageAt}, ${s.chats.createdAt})`))
      .limit(limit)
      .all();
  }

  markRead(chatId: string) {
    const now = nowIso();
    this.db.transaction((tx) => {
      tx.update(s.messages)
        .set({ readAt: now })
        .where(and(eq(s.messages.chatId, chatId), sql`${s.messages.readAt} IS NULL`))
        .run();
      tx.update(s.chats).set({ unreadCount: 0 }).where(eq(s.chats.id, chatId)).run();
    });
  }

  // ---- messages ----

  addMessage(m: {
    chatId: string;
    role: 'user' | 'assistant' | 'system';
    kind: 'answer' | 'followup' | 'status' | 'error' | 'question';
    content: string;
    structured?: Answer | null;
    runId?: string | null;
    unread?: boolean;
  }) {
    const now = nowIso();
    const row: typeof s.messages.$inferInsert = {
      id: newId(),
      chatId: m.chatId,
      role: m.role,
      kind: m.kind,
      content: m.content,
      structured: m.structured ? JSON.stringify(m.structured) : null,
      runId: m.runId ?? null,
      createdAt: now,
      readAt: m.unread ? null : now,
    };
    this.db.transaction((tx) => {
      tx.insert(s.messages).values(row).run();
      tx.update(s.chats)
        .set({
          lastMessageAt: now,
          unreadCount: m.unread ? sql`${s.chats.unreadCount} + 1` : s.chats.unreadCount,
        })
        .where(eq(s.chats.id, m.chatId))
        .run();
    });
    return row;
  }

  listMessages(chatId: string) {
    return this.db
      .select()
      .from(s.messages)
      .where(eq(s.messages.chatId, chatId))
      .orderBy(s.messages.createdAt)
      .all();
  }

  // ---- runs ----

  createRun(r: {
    itemId: string;
    chatId: string;
    kind: RunKind;
    mode: Mode;
    adapter: string;
    model?: string | null;
    userMessage?: string | null;
  }) {
    const row: typeof s.runs.$inferInsert = {
      id: newId(),
      itemId: r.itemId,
      chatId: r.chatId,
      kind: r.kind,
      mode: r.mode,
      adapter: r.adapter,
      model: r.model ?? null,
      status: 'queued',
      userMessage: r.userMessage ?? null,
      createdAt: nowIso(),
    };
    this.db.insert(s.runs).values(row).run();
    const created = this.getRun(row.id);
    if (!created) throw new Error('insert did not persist run');
    return created;
  }

  getRun(id: string) {
    return this.db.select().from(s.runs).where(eq(s.runs.id, id)).get();
  }

  updateRun(id: string, patch: Partial<typeof s.runs.$inferInsert>) {
    this.db.update(s.runs).set(patch).where(eq(s.runs.id, id)).run();
  }

  listRuns(chatId: string) {
    return this.db
      .select()
      .from(s.runs)
      .where(eq(s.runs.chatId, chatId))
      .orderBy(s.runs.createdAt)
      .all();
  }

  nextQueuedRun() {
    return this.db
      .select()
      .from(s.runs)
      .where(eq(s.runs.status, 'queued'))
      .orderBy(s.runs.createdAt)
      .limit(1)
      .get();
  }

  /** Runs left mid-flight by a crash go back to the queue at boot. */
  requeueInterrupted() {
    this.db
      .update(s.runs)
      .set({ status: 'queued', startedAt: null })
      .where(sql`${s.runs.status} IN ('extracting','researching')`)
      .run();
  }

  addRunEvent(runId: string, seq: number, type: string, payload: unknown) {
    this.db
      .insert(s.runEvents)
      .values({ runId, seq, type, payload: JSON.stringify(payload), at: nowIso() })
      .run();
  }

  listRunEvents(runId: string) {
    return this.db
      .select()
      .from(s.runEvents)
      .where(eq(s.runEvents.runId, runId))
      .orderBy(s.runEvents.seq)
      .all();
  }

  // ---- extractions / entities / tags ----

  addExtraction(e: {
    itemId: string;
    kind: string;
    content: unknown;
    tool?: string;
    model?: string;
  }) {
    this.db
      .insert(s.extractions)
      .values({
        id: newId(),
        itemId: e.itemId,
        kind: e.kind,
        content: JSON.stringify(e.content),
        tool: e.tool ?? null,
        model: e.model ?? null,
        createdAt: nowIso(),
      })
      .run();
  }

  listExtractions(itemId: string) {
    return this.db.select().from(s.extractions).where(eq(s.extractions.itemId, itemId)).all();
  }

  replaceEntities(itemId: string, runId: string, ents: Answer['entities']) {
    const now = nowIso();
    this.db.transaction((tx) => {
      tx.delete(s.entities).where(eq(s.entities.itemId, itemId)).run();
      for (const e of ents) {
        tx.insert(s.entities)
          .values({
            id: newId(),
            itemId,
            runId,
            kind: e.kind,
            name: e.name,
            attributes: JSON.stringify(e.attributes ?? {}),
            url: e.url ?? null,
            confidence: e.confidence,
            createdAt: now,
          })
          .run();
      }
    });
  }

  listEntities(itemId: string) {
    return this.db.select().from(s.entities).where(eq(s.entities.itemId, itemId)).all();
  }

  setAutoTags(itemId: string, names: string[]) {
    const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      12,
    );
    this.db.transaction((tx) => {
      for (const name of clean) {
        let tag = tx.select().from(s.tags).where(eq(s.tags.name, name)).get();
        if (!tag) {
          tag = { id: newId(), name, kind: 'auto' };
          tx.insert(s.tags).values(tag).run();
        }
        tx.insert(s.itemTags)
          .values({ itemId, tagId: tag.id, confidence: 0.8 })
          .onConflictDoNothing()
          .run();
      }
    });
  }

  listTags(itemId: string): string[] {
    return this.db
      .select({ name: s.tags.name })
      .from(s.itemTags)
      .innerJoin(s.tags, eq(s.tags.id, s.itemTags.tagId))
      .where(eq(s.itemTags.itemId, itemId))
      .all()
      .map((r) => r.name);
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
  ) {
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

  searchFts(query: string, limit = 50): string[] {
    const rows = this.sqlite
      .prepare('SELECT item_id FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(query, limit) as { item_id: string }[];
    return rows.map((r) => r.item_id);
  }

  // ---- cost ----

  addCost(adapter: string, model: string | null, costUsd: number, runId: string) {
    const now = nowIso();
    this.db
      .insert(s.costLedger)
      .values({ day: now.slice(0, 10), adapter, model, costUsd, runId, createdAt: now })
      .run();
  }

  spentToday(): number {
    const day = nowIso().slice(0, 10);
    const r = this.db
      .select({ total: sql<number>`coalesce(sum(${s.costLedger.costUsd}), 0)` })
      .from(s.costLedger)
      .where(eq(s.costLedger.day, day))
      .get();
    return r?.total ?? 0;
  }

  // ---- settings / devices ----

  getSetting(key: string): string | undefined {
    return this.db.select().from(s.settings).where(eq(s.settings.key, key)).get()?.value;
  }
  setSetting(key: string, value: string) {
    this.db
      .insert(s.settings)
      .values({ key, value, updatedAt: nowIso() })
      .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: nowIso() } })
      .run();
  }

  createDevice(name: string, platform: string, tokenHash: string) {
    const row: typeof s.devices.$inferInsert = {
      id: newId(),
      name,
      platform,
      tokenHash,
      createdAt: nowIso(),
    };
    this.db.insert(s.devices).values(row).run();
    return row;
  }
  findDeviceByTokenHash(hash: string) {
    return this.db
      .select()
      .from(s.devices)
      .where(and(eq(s.devices.tokenHash, hash), sql`${s.devices.revokedAt} IS NULL`))
      .get();
  }
  touchDevice(id: string) {
    this.db.update(s.devices).set({ lastSeenAt: nowIso() }).where(eq(s.devices.id, id)).run();
  }
  listDevices() {
    return this.db.select().from(s.devices).orderBy(desc(s.devices.createdAt)).all();
  }
  revokeDevice(id: string) {
    this.db.update(s.devices).set({ revokedAt: nowIso() }).where(eq(s.devices.id, id)).run();
  }
}
