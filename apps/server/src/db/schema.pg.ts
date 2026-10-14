/**
 * Postgres port of `./schema.ts` for a future hosted multi-tenant mode. The SQLite schema
 * remains the source of truth and the default; keep this file in sync with it when it
 * changes. Mapping: sqliteTable→pgTable, text→text, integer→integer, real→doublePrecision.
 * `id` stays text (ULIDs); timestamps stay text (ISO strings, app-owned); JSON-in-text
 * columns (`content`, `structured`, `raw`, `attributes`, `keys`, `payload`) stay text.
 */

import { sql } from 'drizzle-orm';
import { doublePrecision, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const items = pgTable(
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
    /** Idempotency key sent by a retrying client (`IngestRequest.clientId`); unique when present. */
    clientId: text('client_id'),
    /** Tenant owner (ADR 0032); null on the self-hosted SQLite equivalent. */
    userId: text('user_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('items_dedupe').on(t.canonicalUrl, t.focus, t.createdAt),
    // Idempotency (ADR 0032): globally unique for legacy (user_id IS NULL) rows, unique per
    // tenant for hosted rows. Nullable-safe: Postgres treats NULLs as distinct in the composite index.
    uniqueIndex('items_client_id_null_idx').on(t.clientId).where(sql`user_id is null`),
    uniqueIndex('items_user_client_idx').on(t.userId, t.clientId),
    index('items_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const extractions = pgTable('extractions', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  content: text('content').notNull(), // JSON
  tool: text('tool'),
  model: text('model'),
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms'),
  /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
  userId: text('user_id'),
  createdAt: text('created_at').notNull(),
});

/** Files the media worker produced for an item (docs/DATA-MODEL.md §media_assets). */
export const mediaAssets = pgTable(
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
    durationS: doublePrecision('duration_s'),
    width: integer('width'),
    height: integer('height'),
    frameTsS: doublePrecision('frame_ts_s'),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    source: text('source').notNull(), // cdn | ytdlp | direct | ffmpeg | upload (owner-shared file)
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('media_assets_item_idx').on(t.itemId)],
);

export const chats = pgTable(
  'chats',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .unique()
      .references(() => items.id, { onDelete: 'cascade' }),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessageAt: text('last_message_at'),
    brainSessionId: text('brain_session_id'),
    brainAdapter: text('brain_adapter'),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('chats_user_created_idx').on(t.userId, t.createdAt.desc())],
);

export const messages = pgTable(
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
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    readAt: text('read_at'),
  },
  (t) => [index('messages_chat').on(t.chatId, t.createdAt)],
);

export const runs = pgTable(
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
    /** Chosen by the user for this run; the worker never rebinds it after classification. */
    pinned: integer('pinned').notNull().default(0),
    status: text('status').notNull().default('queued'),
    userMessage: text('user_message'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    costUsd: doublePrecision('cost_usd'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('runs_status').on(t.status, t.createdAt)],
);

export const runEvents = pgTable(
  'run_events',
  {
    // SQLite autoincrement → Postgres identity column (still an integer primary key).
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    at: text('at').notNull(),
  },
  (t) => [index('run_events_run').on(t.runId, t.seq)],
);

export const artifacts = pgTable('artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  createdAt: text('created_at').notNull(),
});

export const entities = pgTable(
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
    confidence: doublePrecision('confidence'),
    /** Owner-starred thing; re-runs replace entities, so a star lives on the current row only. */
    starred: integer('starred').notNull().default(0),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('entities_kind_name').on(t.kind, t.name)],
);

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
  userId: text('user_id'),
  kind: text('kind').notNull().default('auto'),
});

export const itemTags = pgTable(
  'item_tags',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    confidence: doublePrecision('confidence'),
  },
  (t) => [uniqueIndex('item_tags_pk').on(t.itemId, t.tagId)],
);

export const collections = pgTable(
  'collections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    query: text('query').notNull(),
    manual: integer('manual').notNull().default(0),
    auto: integer('auto').notNull().default(0),
    hidden: integer('hidden').notNull().default(0),
    /** Random secret in the public read-only URL `/s/<token>` (ADR 0025); null = not shared. */
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    shareToken: text('share_token'),
  },
  (t) => [uniqueIndex('collections_share_token_idx').on(t.shareToken)],
);

export const collectionItems = pgTable(
  'collection_items',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    addedAt: text('added_at').notNull(),
  },
  (t) => [
    uniqueIndex('collection_items_pk').on(t.collectionId, t.itemId),
    index('collection_items_item_idx').on(t.itemId),
  ],
);

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
  userId: text('user_id'),
  createdAt: text('created_at').notNull(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey(),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  endpoint: text('endpoint').notNull(),
  keys: text('keys'),
  /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
  userId: text('user_id'),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

/** Run notifications parked during quiet hours, flushed as one digest (ADR 0020). */
export const pendingNotifications = pgTable('pending_notifications', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  tag: text('tag').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Geocoder cache for place entities, keyed by the query string; misses are stored with null coords (ADR 0022). */
export const placeGeo = pgTable('place_geo', {
  query: text('query').primaryKey(),
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  label: text('label'),
  provider: text('provider').notNull(),
  /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
  userId: text('user_id'),
  resolvedAt: text('resolved_at').notNull(),
});

export const costLedger = pgTable(
  'cost_ledger',
  {
    // SQLite autoincrement → Postgres identity column (still an integer primary key).
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    day: text('day').notNull(),
    adapter: text('adapter').notNull(),
    model: text('model'),
    costUsd: doublePrecision('cost_usd').notNull(),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    runId: text('run_id'),
    /** Which BYOK credential paid for this spend (ADR 0032 cap enforcement). */
    credentialId: text('credential_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('cost_ledger_day').on(t.day),
    index('cost_ledger_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** The connected Instagram shadow account (docs/DATA-MODEL.md §ig_accounts). One row in v1. */
export const igAccounts = pgTable('ig_accounts', {
  igUserId: text('ig_user_id').primaryKey(),
  username: text('username'),
  /** Long-lived token, encrypted with the keyfile (ADR 0018). */
  accessTokenEnc: text('access_token_enc').notNull(),
  expiresAt: text('expires_at'),
  refreshedAt: text('refreshed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Webhook dedupe + audit; `id` is Meta's message id or comment id. */
export const igEvents = pgTable(
  'ig_events',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // dm_share | dm_note | mention | comment | other
    raw: text('raw').notNull(), // JSON
    itemId: text('item_id').references(() => items.id, { onDelete: 'set null' }),
    /** IGSID of the DM sender, needed to react to the message when the run finishes. */
    senderId: text('sender_id'),
    receivedAt: text('received_at').notNull(),
    processedAt: text('processed_at'),
    error: text('error'),
  },
  (t) => [index('ig_events_item_idx').on(t.itemId)],
);

/** Saved list (ADR 0031): things the owner chose to keep from an answer, plus free-form tasks. */
export const todos = pgTable(
  'todos',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // an entity kind, or `task` for a free-form to-do
    title: text('title').notNull(),
    url: text('url'),
    note: text('note'),
    attributes: text('attributes').notNull().default('{}'), // JSON snapshot of the entity's attributes
    chatId: text('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    /** `open` (the owner's list, `done_at` set once ticked) or `suggested` (brain proposal, ADR 0031). */
    status: text('status').notNull().default('open'),
    doneAt: text('done_at'),
    /** Tenant owner (ADR 0032); null on legacy/self-hosted rows. */
    userId: text('user_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('todos_done_created_idx').on(t.doneAt, t.createdAt)],
);

// TODO(hosted-mode): Postgres full-text search is not ported yet. The SQLite path uses FTS5
// (drizzle/0001_fts.sql triggers + content tables); design the pg equivalent (tsvector column
// + GIN index) when the hosted mode lands.

// ---- hosted mode (ADR 0032): accounts, sessions, BYOK vault, OAuth state ----

/** Hosted-mode end user. Self-hosted mode never touches this table (the owner password lives in settings). */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: text('email_verified_at'),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub').unique(),
  displayName: text('display_name'),
  createdAt: text('created_at').notNull(),
  disabledAt: text('disabled_at'),
});

/**
 * Bearer sessions, hashed like self-hosted device tokens. `kind` distinguishes browser
 * sign-ins from device pairings and MCP clients; the raw token is returned once and never stored.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    kind: text('kind').notNull().default('browser'), // browser | device | mcp
    label: text('label'),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Per-user BYOK credential vault (ADR 0032): only SecretBox-sealed key material is stored.
 * `kind` is openrouter | api_key | harness; caps are enforced in the run loop against cost_ledger.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    provider: text('provider'),
    label: text('label'),
    /** `v1.<nonce>.<ct>.<tag>` SecretBox envelope; wiped to '' when the credential is revoked. */
    sealedKey: text('sealed_key').notNull(),
    meta: text('meta'), // JSON (e.g. base_url for harness credentials)
    monthlyCapUsd: doublePrecision('monthly_cap_usd'),
    perRunCapUsd: doublePrecision('per_run_cap_usd'),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('credentials_user_idx').on(t.userId)],
);

/** Short-lived PKCE/OAuth flow state; swept by age. */
export const oauthStates = pgTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    purpose: text('purpose').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    returnTo: text('return_to'),
    codeVerifier: text('code_verifier'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('oauth_states_created_idx').on(t.createdAt)],
);

/**
 * Hosted Instagram account pairing (ADR 0032 + ADR 0018): a user generates a short-lived code
 * in settings, DMs it to the service's Instagram account, and the sender's IGSID is linked to
 * their account. Self-hosted mode never touches these tables (single owner, no pairing).
 */
export const igPairingCodes = pgTable(
  'ig_pairing_codes',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('ig_pairing_codes_user_idx').on(t.userId)],
);

/** One active Instagram sender (IGSID) per user account; `revoked_at` soft-revokes. */
export const igLinks = pgTable(
  'ig_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: text('sender_id').notNull().unique(),
    igUsername: text('ig_username'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('ig_links_user_idx').on(t.userId)],
);

/**
 * Rate limit + audit for the "connect your account" prompt a stranger gets when they DM the
 * communal Instagram account before pairing (ADR 0032). `last_prompt_at` is the unix-ms epoch
 * as text; one row per sender, so the window survives a restart (the self-hosted in-memory map
 * never fires because self-hosted instances do not prompt at all).
 */
export const igPrompts = pgTable('ig_prompts', {
  senderId: text('sender_id').primaryKey(),
  lastPromptAt: text('last_prompt_at').notNull(),
});

/** A sender who replied STOP/UNSUBSCRIBE: never prompted again (ADR 0032). Sender-scoped, no user. */
export const igPromptOptouts = pgTable('ig_prompt_optouts', {
  senderId: text('sender_id').primaryKey(),
  createdAt: text('created_at').notNull(),
});

export const pgSchema = {
  items,
  extractions,
  mediaAssets,
  chats,
  messages,
  runs,
  runEvents,
  artifacts,
  entities,
  tags,
  itemTags,
  collections,
  collectionItems,
  devices,
  pushSubscriptions,
  pendingNotifications,
  placeGeo,
  costLedger,
  settings,
  igAccounts,
  igEvents,
  todos,
  users,
  sessions,
  credentials,
  oauthStates,
  igPairingCodes,
  igLinks,
  igPrompts,
  igPromptOptouts,
};
