# Data model

SQLite (WAL) at `~/.doubletake/doubletake.db`, schema owned by drizzle migrations in
`apps/server/src/db/`. IDs are ULIDs (sortable, URL-safe). Timestamps are ISO-8601 UTC text.
JSON columns are validated with zod schemas from `packages/shared` on read and write.

## Tables

### items
| column | type | notes |
|---|---|---|
| id | text pk | ULID |
| source_url | text | as shared (may be a share-redirect) |
| canonical_url | text | resolved permalink; null for free text |
| platform | text | `instagram` · `tiktok` · `youtube` (incl. Shorts) · `x` · `reddit` · `aichat` · `web` · `text` — the id of the extractor that claimed the URL |
| channel | text | `android_share` · `compose` · `ig_dm` · `ig_mention` · `web_share_target` |
| note | text | the owner's question or remark |
| focus | text | `whole` · `comments` · `thread:<comment_id>` |
| mode_requested | text | `auto` · `quick` · `standard` · `deep` |
| mode_effective | text | what actually ran |
| question_type | text | classifier output, see RESEARCH-MODES.md |
| category | text | brain output: `place` · `food` · `product` · `tech` · `skill` · `health` · `travel` · `finance` · `entertainment` · `news` · `other` |
| status | text | `new` · `extracting` · `researching` · `answered` · `failed` · `capped` |
| title | text | derived (caption / page title / first line) |
| created_at, updated_at | text | |

Index: `(canonical_url, focus, created_at)` for the 24 h dedupe.

### media_assets
`id`, `item_id` fk, `kind` (`video` · `image` · `audio` · `thumbnail` · `frame`), `path`
(relative to data dir), `sha256`, `bytes`, `duration_s`, `width`, `height`, `frame_ts_s`
(for frames), `source` (`cdn` · `ytdlp` · `direct` · `ffmpeg` for derived frames/audio),
`created_at`. Rows are replaced wholesale when an item is re-extracted.

### extractions
`id`, `item_id` fk, `kind` (`caption` · `transcript` · `ocr` · `frame_description` ·
`comments` · `thread` · `page_text` · `aichat_transcript`), `content` (JSON; shape per kind
below), `tool` (e.g. `mlx-whisper/large-v3-turbo`), `model`, `cost_usd`, `duration_ms`,
`created_at`.

Content shapes:
- `transcript`: `{ language, segments: [{ start, end, text }] }`
- `ocr`: `{ frames: [{ ts, lines: [string] }] , merged: [string] }`
- `frame_description`: `{ frames: [{ ts, text }] }`
- `comments`: `{ total, sampled: [{ id, author, text, likes, ts, parent_id? }] }`
- `thread`: `{ root: Comment, replies: [Comment], is_primary: true }`
- `page_text`: `{ title, text, links: [string] }`

### chats / messages
`chats`: `id`, `item_id` fk unique, `brain_adapter`, `brain_session_id`, `unread_count`,
`last_message_at`.
`messages`: `id`, `chat_id` fk, `role` (`user` · `assistant` · `system`), `kind` (`answer` ·
`followup` · `status` · `error`), `content` (Markdown), `structured` (JSON `Verdict`, nullable),
`run_id` fk nullable, `created_at`, `read_at`.

### runs / run_events
`runs`: `id`, `item_id`, `chat_id`, `kind` (`research` · `followup` · `escalation`), `mode`,
`adapter`, `model`, `status` (`queued` · `extracting` · `researching` · `done` · `failed` ·
`capped` · `aborted`), `started_at`, `finished_at`, `cost_usd`, `tokens_in`, `tokens_out`,
`stop_reason`, `error`.
`run_events`: `run_id`, `seq`, `type` (`status` · `tool_call` · `tool_result` · `text` ·
`extraction`), `payload` JSON, `at`. Streamed to the UI over WebSocket, kept for the timeline.

### artifacts
`id`, `run_id`, `path` (under notes dir), `bytes`, `created_at`.

### entities
`id`, `item_id` fk, `run_id` fk, `kind` (`place` · `recipe` · `product` · `tool` · `tip` · `media` ·
`person` · `event` · `other`), `name`, `attributes` (JSON map; well-known keys per kind, e.g.
place: `address`, `city`, `cuisine`, `maps_url`; recipe: `ingredients[]`, `time_min`; product:
`brand`, `price`, `url`; tool: `install`, `url`), `url`, `confidence`, `created_at`.
Index `(kind, name)`. Re-runs replace the item's entities. Rendered as cards in the chat and
listed per kind in auto collections.

### tags / item_tags / collections / collection_items
`tags`: `id`, `name` unique (lowercase), `kind` (`auto` · `manual`).
`item_tags`: `item_id`, `tag_id`, `confidence` (auto only).
`collections`: `id`, `name`, `query` (tag expression, `category:<c>`, `entity:<kind>`, or FTS string),
`manual` bool, `auto` bool. Auto collections are seeded at first boot (one per category and one
per entity kind) and cannot be deleted, only hidden.
`collection_items`: for manual collections.

### devices / push_subscriptions
`devices`: `id`, `name`, `platform` (`android` · `ios` · `web`), `token_hash`, `created_at`,
`last_seen_at`, `revoked_at`.
`push_subscriptions`: `id`, `device_id`, `kind` (`webpush` · `fcm`), `endpoint_or_token`,
`keys` JSON (webpush p256dh/auth), `failed_count`, `created_at`.

### ig_accounts / ig_events
`ig_accounts`: `ig_user_id` pk, `username`, `access_token_enc`, `expires_at`, `refreshed_at`.
`ig_events`: `id` (Meta event/message id) pk, `kind` (`dm_share` · `mention` · `comment` ·
`other`), `raw` JSON, `item_id` nullable, `received_at`, `processed_at`.

### cost_ledger
`id`, `day` (YYYY-MM-DD, local), `run_id`, `adapter`, `model`, `cost_usd`. Index on `day`.

### settings
`key` pk, `value` text, `encrypted` bool. Secrets (`ig_app_secret`, `vapid_private`, API keys
entered via UI) are encrypted with the key derived per ADR 0010.

### items_fts (FTS5)
Columns: `item_id` unindexed, `title`, `note`, `transcript`, `ocr`, `answer`, `tags`, `entities`
(names and attribute values joined).
Maintained by triggers on `items`, `extractions`, `messages`, `item_tags`.

## Blob layout
```
~/.doubletake/
  doubletake.db (+ -wal, -shm)
  keyfile
  media/<item_id>/source.mp4 | image.jpg | frames/000123.jpg | audio.wav
  exports/<item_id>.md          # mirror of what was written to ~/Doubletake
  logs/server.log, worker.log
```

## Retention
Media blobs for `answered` items older than a configurable window (default 90 days) may be
pruned by a maintenance job; extractions, messages, and exports are kept. Nothing is deleted
without the setting being explicitly enabled.
