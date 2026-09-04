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
| channel | text | `android_share` · `compose` · `ig_dm` · `ig_mention` · `web_share_target` · `library` (a question over the owner's own chats, [ADR 0021](adr/0021-cross-library-chat.md)) |
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
below), `tool` (e.g. `mlx-whisper/large-v3-turbo`; `library-fts` marks the retrieved past chats a
`library` question was answered from), `model`, `cost_usd`, `duration_ms`, `created_at`.

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
listed per kind in auto collections. Place attributes may carry brain-supplied `lat`/`lon`
(numbers, only when the model is sure), which the map uses before asking the geocoder.

### place_geo
Geocoder cache ([ADR 0022](adr/0022-map-view-place-geocoding.md)). `query` primary key (place
name + `address`/`city`/`town`/`region`/`state`/`country` attributes, deduplicated, ≤200
chars), `lat`, `lon` (both null for a miss, so unknown places are asked once), `label`
(provider display name), `provider` (`nominatim`), `resolved_at`. Filled after each research
run that produced places and by `POST /api/entities/geocode`. Never holds notes, answers or
URLs. Migration `0006_place_geo`.

### tags / item_tags / collections / collection_items
`tags`: `id`, `name` unique (normalised: trimmed, lowercase, single spaces, ≤40 chars), `kind`
(`auto` · `manual`). A manual tag whose name already exists as an auto tag reuses that row.
`item_tags`: `item_id`, `tag_id`, `confidence` (auto only; null for manual links). Removing the
last link deletes the tag row.
`collections`: `id`, `name`, `query` (`category:<c>`, `entity:<kind>`, `tag:<name>`, or an FTS
string; empty for manual lists), `manual` bool, `auto` bool, `hidden` bool, `created_at`. Auto
collections are seeded idempotently at every boot (`library/collections.ts`: one per category,
one per entity kind, matched by `query`) and cannot be deleted or retargeted, only hidden. A
collection's members are resolved at read time: manual → `collection_items`, otherwise the
query (`resolveQuery`, capped at 500 items).
`collection_items`: `collection_id`, `item_id`, `added_at`; unique on the pair, cascade on
delete of either side. Migration `0004_collections.sql`.

### devices / push_subscriptions
`devices`: `id`, `name`, `platform` (`android` · `ios` · `web`), `token_hash`, `created_at`,
`last_seen_at`, `revoked_at`.
`push_subscriptions`: `id`, `device_id`, `kind` (`webpush` · `fcm`; ntfy/Telegram are not rows here, see [ADR 0019](adr/0019-owner-notification-channels.md)), `endpoint_or_token`,
`keys` JSON (webpush p256dh/auth), `failed_count`, `created_at`.

### pending_notifications
Run notifications parked during quiet hours ([ADR 0020](adr/0020-quiet-hours-digest.md)):
`id`, `chat_id`, `title`, `body`, `url`, `tag`, `created_at`. Rows are deleted when the digest
goes out; they survive restarts. Migration `0005_pending_notifications.sql`.

### ig_accounts / ig_events
`ig_accounts`: `ig_user_id` pk, `username`, `access_token_enc` (SecretBox ciphertext, ADR 0018),
`expires_at`, `refreshed_at`, `created_at`, `updated_at`. One row at most.
`ig_events`: `id` pk (Meta message id, comment id, media id, or `poll:<media_id>` for the
polling fallback), `kind` (`dm_share` · `mention` · `comment` · `other`), `raw` JSON,
`item_id` nullable (set null on item delete), `sender_id` (IGSID of the DM sender, used for the
completion reaction), `received_at`, `processed_at`, `error`. Migration `0003_instagram.sql`.

### cost_ledger
`id`, `day` (YYYY-MM-DD, local), `run_id`, `adapter`, `model`, `cost_usd`. Index on `day`.

### settings
`key` pk, `value` text, `encrypted` bool. Secrets (`ig_app_secret`, `vapid_private`, API keys
entered via UI) are encrypted with the keyfile per ADR 0018. Plain keys: `owner_password_hash`,
`vapid_public`, `quiet_hours` (JSON `{ enabled, start, end, timeZone }`, ADR 0020).

### items_fts (FTS5)
Columns: `item_id` unindexed, `title`, `note`, `transcript`, `ocr`, `answer`, `tags`, `entities`
(names and attribute values joined).
Maintained in code, not by triggers: `QueueWorker.reindex()` rewrites the item's row after
every finished run and after every tag edit (`transcript` = transcript + caption + page text +
comments + thread flattened by `extract/flatten.ts`; `ocr` = OCR + frame descriptions). The same
call re-exports the Markdown note so frontmatter stays in step.

## Blob layout
```
~/.doubletake/
  doubletake.db (+ -wal, -shm)
  keyfile                       # 32 random bytes, mode 0600; root secret for SecretBox (ADR 0018)
  media/<item_id>/source.mp4 | image.jpg | frames/000123.jpg | audio.wav
  exports/<item_id>.md          # mirror of what was written to ~/Doubletake
  logs/server.log, worker.log
```

## Retention
Media blobs for `answered` items older than a configurable window (default 90 days) may be
pruned by a maintenance job; extractions, messages, and exports are kept. Nothing is deleted
without the setting being explicitly enabled.
