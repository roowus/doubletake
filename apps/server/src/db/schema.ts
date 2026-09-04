import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    sourceUrl: text('source_url'),
    canonicalUrl: text('canonical_url'),
    platform: text('platform').notNull(),
    channel: text('channel').notNull(),
    note: text('note'),
    text: text('text'),
    focus: text('focus').notNull().default('whole'),
    modeRequested: text('mode_requested').notNull().default('auto'),
    modeEffective: text('mode_effective'),
    questionType: text('question_type'),
    category: text('category'),
    status: text('status').notNull().default('new'),
    title: text('title'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('items_dedupe').on(t.canonicalUrl, t.focus, t.createdAt)],
);

export const extractions = sqliteTable('extractions', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  content: text('content').notNull(), // JSON
  tool: text('tool'),
  model: text('model'),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull(),
});

/** Files the media worker produced for an item (docs/DATA-MODEL.md §media_assets). */
export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // video | image | audio | thumbnail | frame
    path: text('path').notNull(), // relative to the data dir
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    durationS: real('duration_s'),
    width: integer('width'),
    height: integer('height'),
    frameTsS: real('frame_ts_s'),
    source: text('source').notNull(), // cdn | ytdlp | direct | ffmpeg
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('media_assets_item_idx').on(t.itemId)],
);

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .unique()
    .references(() => items.id, { onDelete: 'cascade' }),
  unreadCount: integer('unread_count').notNull().default(0),
  lastMessageAt: text('last_message_at'),
  brainSessionId: text('brain_session_id'),
  brainAdapter: text('brain_adapter'),
  createdAt: text('created_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    structured: text('structured'), // JSON Answer
    runId: text('run_id'),
    createdAt: text('created_at').notNull(),
    readAt: text('read_at'),
  },
  (t) => [index('messages_chat').on(t.chatId, t.createdAt)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('research'),
    mode: text('mode').notNull(),
    adapter: text('adapter').notNull(),
    model: text('model'),
    status: text('status').notNull().default('queued'),
    userMessage: text('user_message'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    costUsd: real('cost_usd'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('runs_status').on(t.status, t.createdAt)],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('run_events_run').on(t.runId, t.seq)],
);

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  createdAt: text('created_at').notNull(),
});

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    attributes: text('attributes').notNull().default('{}'),
    url: text('url'),
    confidence: real('confidence'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('entities_kind_name').on(t.kind, t.name)],
);

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').notNull().default('auto'),
});

export const itemTags = sqliteTable(
  'item_tags',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    confidence: real('confidence'),
  },
  (t) => [uniqueIndex('item_tags_pk').on(t.itemId, t.tagId)],
);

export const collections = sqliteTable('collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
  auto: integer('auto', { mode: 'boolean' }).notNull().default(false),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  endpoint: text('endpoint').notNull(),
  keys: text('keys'),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const costLedger = sqliteTable(
  'cost_ledger',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    day: text('day').notNull(),
    adapter: text('adapter').notNull(),
    model: text('model'),
    costUsd: real('cost_usd').notNull(),
    runId: text('run_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('cost_ledger_day').on(t.day)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});
