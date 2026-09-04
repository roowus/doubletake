# Doubletake architecture

Living document. Every behavioural change updates this file in the same commit (see
`CLAUDE.md`). Decisions are recorded as [ADRs](adr/README.md); this document describes the
current state that results from them.

## 1. Purpose

Turn "I saw something while scrolling" into a researched, personalised answer delivered
asynchronously by push notification, with a per-item chat for follow-ups. One owner per
instance, self-hosted on the owner's daily laptop.


### Where this sits

Surveyed 2026-09-03 against 31 products. Capture bots (SaveToList) extract into lists but
never research; summarisers (SuperBrain, reel-summary apps) stop at a transcript; archives
(Karakeep, Raindrop, Readwise) keep things findable but not answered; Recall has library chat
but no reels and no local files. Doubletake sells **the answer**, keeps SaveToList-style
structured extraction as a by-product of every run, treats the comment thread as a first-class
object, reads the owner's files, and integrates with archives (Markdown export now, Karakeep
import and an MCP server later) rather than replacing them. The share sheet is the primary
channel; the Instagram bot is optional and documented as fragile.

## 2. Decisions table

| Area | Decision | ADR |
|---|---|---|
| Stack | TypeScript/Node server (Fastify) + Python media worker (uv), pnpm monorepo | [0001](adr/0001-monorepo-ts-server-python-worker.md) |
| Storage | SQLite in one data dir (`~/.doubletake`): DB, media blobs, logs; FTS5 | [0002](adr/0002-sqlite-single-data-dir.md) |
| Brain | Pluggable `BrainAdapter`; v1 adapters: Claude Agent SDK (default), headless CLI, OpenAI/Anthropic-compatible API with built-in tool loop | [0003](adr/0003-brain-adapter-interface.md) |
| Modes | Quick / Standard / Deep, auto-picked from note keywords + cheap classifier, overridable | [0004](adr/0004-research-modes.md) |
| Content safety | Scraped content wrapped and labelled untrusted; file reads = home dir minus deny list; writes = notes dir only; no shell | [0005](adr/0005-untrusted-content-and-file-policy.md) |
| Instagram | Official "Instagram API with Instagram Login" on a shadow Business account; DM share + comment @mention; mention semantics set `focus`; bot silent in comments; Graph data enters as extractions + media hints, raw-body HMAC, host confinement, polling fallback | [0006](adr/0006-instagram-official-api-and-mention-semantics.md), [0018](adr/0018-instagram-channel-and-keyfile-secrets.md) |
| Mobile | One PWA; Android via Capacitor with a custom translucent share activity; desktop = installed PWA; iOS/Windows lower priority | [0007](adr/0007-capacitor-and-custom-share-activity.md) |
| Notifications | Web Push (VAPID) + Android FCM + IG reaction on the source DM; channel interface for Telegram/ntfy later | [0008](adr/0008-notifications.md) |
| Push keys | VAPID pair auto-generated into `settings` unless env-provided; FCM HTTP v1 with a hand-rolled service-account JWT; `gone` prunes, 8 failures prune | [0016](adr/0016-push-keys-and-fcm-http-v1.md) |
| Network | Bind loopback; Tailscale serve by default; Cloudflare Tunnel or Tailscale Funnel only for the IG webhook path | [0009](adr/0009-networking.md) |
| Auth | Owner password at setup + long-lived per-device tokens via QR pairing | [0010](adr/0010-auth-owner-password-device-tokens.md) |
| Knowledge | Markdown export of every finished chat into `~/Doubletake`; FTS5 search; auto tags and collections | [0011](adr/0011-markdown-export-fts-tags.md) |
| Structure | Every run also extracts a category and typed entities (places, recipes, products, tools, tips); collections are automatic per category and entity kind | [0014](adr/0014-structured-extraction-and-categories.md) |
| Platforms | Server-side extractor registry, one file per platform, `web` fallback; v1: Instagram, TikTok, YouTube + Shorts, X, Reddit, AI-chat shares | [0015](adr/0015-platform-extractor-registry.md) |
| Cost | Daily spend cap; runs queue as `capped` when hit; per-run cost shown in chat | [0012](adr/0012-cost-cap.md) |
| License | AGPL-3.0, public repo from day one | [0013](adr/0013-agpl-public.md) |

## 3. System shape

```
 phone share sheet ─┐
 in-app compose ────┤            ┌──────────────── Doubletake server (Node/TS, Fastify) ───────────────┐
 IG DM / @mention ──┤  HTTPS     │ channels/  → ingest → queue (SQLite-backed) → runs → brains/        │
   (Meta webhook) ──┴──────────▶ │     ▲                        │                 │                    │
                                 │     │                        ▼                 ▼                    │
                    push (FCM /  │ auth/devices        media worker (Python, uv)  notify/ (webpush,    │
                    Web Push) ◀──┤                     yt-dlp · ffmpeg · whisper  fcm, ig-reaction)    │
                                 │                     · OCR · frame sampling                          │
                                 │ SQLite (~/.doubletake/doubletake.db) + blobs + FTS5 + md export     │
                                 └────────────────────────────────────────────────────────────────────┘
 PWA (Vite + React) ◀── same origin: /api + WebSocket for live run events; installed on desktop,
                        wrapped by Capacitor on Android (share-target activity + FCM)
```

- **One process by default.** The server hosts the API, serves the built PWA, runs the queue
  worker, and spawns the Python media worker lazily as a long-lived child speaking JSON-lines
  over stdio ([Media pipeline](MEDIA-PIPELINE.md), [ADR 0017](adr/0017-media-worker-process-and-vision-via-brain.md)).
  A crashed worker is respawned and the request retried once; a failed media stage degrades
  the run to page-level extraction with a warning. `DOUBLETAKE_WORKER_URL` can point at a
  worker on another machine later without changing the protocol.
- **Reachability.** Binds `127.0.0.1`. `tailscale serve` gives HTTPS on the tailnet for
  clients. Only `/webhooks/instagram` is reachable from the public internet, through
  Cloudflare Tunnel or Tailscale Funnel; the server refuses every other route when the request
  arrives with the public hostname ([Deployment](DEPLOYMENT.md)).

## 4. Repository layout

```
apps/server       Fastify + TS: api/ (REST + WebSocket), auth/, brains/ (adapters, prompts,
                  tools), config/, db/ (drizzle + migrations, repo), export/ (Markdown),
                  extract/ (platform extractor registry + HTTP with SSRF guard), ingest/
                  (normalise + classify), media/ (worker client + stage), notify/ (push),
                  queue/ (worker), channels/instagram/ (Graph client + channel), secrets/ (SecretBox)
apps/web          Vite + React PWA: chats, chat view, compose, settings, pairing, service worker,
                  native.ts (Capacitor glue: server-URL prefix, Preferences mirror, FCM, deep links)
apps/mobile       Capacitor 8 Android: ShareReceiverActivity + Pairing (Kotlin); iOS scaffold later
packages/shared   zod schemas + types (Item, Run, Message, events, API DTOs, untrusted wrappers)
packages/brain-sdk BrainAdapter interface, ToolPolicy, contract test harness
workers/media     Python 3.12 (uv): download, transcribe, OCR, frames, comments
docs/             this file, adr/, guides
scripts/          doctor.sh, dev.sh, install-service.sh, check-links.py
```

Toolchain: Node 22, pnpm 10, TypeScript 5 strict, Fastify 5, drizzle-orm + better-sqlite3
(WAL), zod, vitest, biome; Vite, React 19, vite-plugin-pwa; Capacitor 8 (Java 21, SDK 36);
Python 3.12, uv,
ruff, pytest.

## 5. Domain model (summary)

Full column-level detail in [DATA-MODEL.md](DATA-MODEL.md).

- **item**: one share. Has `platform`, `channel`, `note`, `focus` (`whole` | `comments` |
  `thread:<comment_id>`), requested and effective `mode`, `status`.
- **media_asset** and **extraction**: what was downloaded and what text was derived from it
  (transcript, OCR, frame descriptions, caption, comments, page text, thread).
- **chat** (1:1 with item in v1) and **message**s.
- **run**: one brain execution with mode, adapter, model, status, cost, tokens; **run_event**s
  stream its steps to the UI.
- **artifact**: files the brain wrote into the notes dir during a run.
- **entity**: a typed thing extracted from the item (place, recipe, product, tool, tip, …) with
  a free-form attribute map; items also carry one `category`.
- **tag**, **collection**, **device**, **push_subscription**, **ig_account**, **ig_event**,
  **cost_ledger**, **settings**, and the `items_fts` FTS5 index.

## 6. Ingest and research pipeline

1. **Receive.** A channel handler normalises its input to `IngestRequest { url?, text?, note?,
   channel, focus, modeHint?, ig? }`. Dedupe on `canonical_url + focus` within 24 h: a re-share
   starts a new run on the existing chat instead of a new item. Create `item`, `chat`,
   `run(queued)`; reply `202` immediately. Only the IG channel sends an immediate
   acknowledgement (a DM reaction); the share sheet already shows its own toast.
2. **Pick a mode.** Keyword rules on the note first (`quick`, `tl;dr`, `is this true`,
   `deep dive`, `compare`, `research`), else one cheap classifier call through the configured
   brain returning `{ mode, question_type, needs_comments }`; default Standard
   ([Research modes](RESEARCH-MODES.md)).
3. **Extract.** Two layers. The **platform extractor registry** in
   `apps/server/src/extract/` (TypeScript, runs in the server, [ADR 0015](adr/0015-platform-extractor-registry.md))
   recognises the URL, canonicalises it (tracking params stripped, short links resolved) and
   pulls whatever text is reachable without media: captions via oEmbed or Open Graph, Reddit's
   `.json` view, readable page text. Supported today: Instagram, TikTok, YouTube (incl. Shorts),
   X/Twitter, Reddit, AI-chat share links, generic web. Adding a platform is one file plus one
   registry line ([how-to](MEDIA-PIPELINE.md#adding-a-platform)). For Instagram, TikTok, YouTube,
   X and Reddit the **media worker** then adds, with per-mode budgets: download (CDN URL from
   the IG webhook first, yt-dlp second, cookies opt-in third), transcription (mlx-whisper /
   faster-whisper, captions preferred), scene-change frame sampling, OCR (RapidOCR, Tesseract
   fallback), frame descriptions (the brain's `describeImages` by default, local VLM opt-in),
   comments (Reddit JSON, yt-dlp; IG Graph API with M4). Every extraction is stored and enters
   the brief only as an untrusted block. With `focus = thread:<id>` the whole
   thread is fetched and marked primary; the rest of the comments are a sample.
4. **Research.** Build a `ResearchBrief`: system framing, untrusted content blocks, the owner's
   note, focus instructions, mode budget, tool policy. The adapter runs it, streaming
   `run_events`. Output = Markdown answer plus, when the question type calls for it, a
   structured `Answer { summary, category, entities[], claims[], recommendations[], tags[] }`.
   Entities are always extracted, even in `save_for_later`, so a run with no question still
   files the thing it saw into the right collection ([ADR 0014](adr/0014-structured-extraction-and-categories.md)).
5. **Finish.** Store the message, bump `unread_count`, export
   `~/Doubletake/<yyyy>/<yyyy-mm-dd> <slug>.md` with frontmatter, send Web Push + FCM, react
   `love` on the originating IG DM (nothing public for mentions), write `cost_ledger`.
6. **Follow-up.** Default = cheap turn: same adapter, resume the session when the adapter can,
   `maxTurns` 1–3, no extraction. Escalate to a full run (Standard or Deep) when the owner taps
   **Research this** or the model returns `escalate: { mode, reason }`; the session is resumed
   so prior context carries. A model-suggested escalation is surfaced as a status message, never
   started automatically, and is dropped when it does not point at a strictly higher mode or its
   own reason says no more research is needed (models misuse the field that way).

## 7. Brains

Interface, adapters, and configuration are specified in [BRAIN-ADAPTERS.md](BRAIN-ADAPTERS.md).
Key properties: every adapter reports `capabilities()` (resume, vision, streaming, cost
reporting, how tools are provided); tool policy is enforced by code on our side for the Agent
SDK (`canUseTool`) and the API adapter (our loop), and by a sandboxed working directory plus
preamble for external CLI harnesses; the default adapter can be overridden per mode and per run.

## 8. Channels

- **Android share sheet** ([guide](channels/android-share.md)): translucent native activity,
  compact sheet with URL preview, note, mode chips; posts to `/api/ingest` with the device token
  and finishes without booting the WebView. Finished, failed and capped runs push a notification
  (`NotificationHub`, [ADR 0016](adr/0016-push-keys-and-fcm-http-v1.md)) to every subscribed
  device: FCM for the Android app, Web Push for installed PWAs.
- **In-app compose**: URL or free text plus note and mode.
- **Instagram** ([guide](channels/instagram-setup.md), [ADR 0018](adr/0018-instagram-channel-and-keyfile-secrets.md)):
  DM share (reliable path) and comment @mention (top-level ⇒ `focus=comments`; reply inside a
  thread ⇒ `focus=thread:<parent_id>`). `InstagramChannel` verifies and deduplicates webhook
  deliveries, stores caption/comments/thread from the Graph API as `instagram-graph`
  extractions (merged into the brief as untrusted blocks), hands the CDN URL to the media stage
  via `mediaHints`, polls `/tags` every 2 min as a mention fallback, refreshes the token every
  30 days and reacts `love` to the originating DM via `onOutcome`. The bot never posts publicly.
  Enabled only when `IG_APP_ID` + `IG_APP_SECRET` are set; boot log prints `instagram: …`.
- **AI-chat share links** (Gemini, ChatGPT, Claude): treated as web pages with a dedicated
  readable-text extractor; no login.
- **Web Share Target** in the PWA manifest so an installed PWA can receive shares on
  Android/Chrome desktop without Capacitor.

## 9. Clients

One PWA (`apps/web`, Vite + React, served by the server at `/` from `apps/web/dist`, or by
the Vite dev server with `/api` proxied). Chat list with unread badges, tag filter and FTS
search; chat view with answer, entity cards, claims table, sources, live run timeline over the
`/api/events` WebSocket, cost line, follow-up composer, **Research this** (Quick/Standard/Deep
re-run); compose (URL or text + note + mode); `/share` receives Web Share Target requests;
settings (status, spend vs cap, **Notifications** enable/disable + send test, QR pairing,
devices, sign out; **Instagram** connect/disconnect/status; brains/network arrive with their milestones). The service worker
is a custom `src/sw.ts` (vite-plugin-pwa `injectManifest`): Workbox precache for the shell,
never the API, plus `push` (shows the notification) and `notificationclick` (focuses an open
window and navigates to `/chat/<id>`, else opens one) handlers. First run asks for the owner password; other devices redeem a pairing
code shown as a QR. Android wraps this in Capacitor and adds the native share activity and FCM.
Desktop uses the installed PWA over Tailscale.

### API surface (M1 + M2 + M4)

All routes under `/api` take `Authorization: Bearer <device token>` except `health`,
`setup/status`, `setup` (first run only), `login`, `pair/redeem` and `ig/callback` (OAuth
redirect, protected by a 10-minute random `state`). `/webhooks/instagram` is outside `/api`
and is authenticated by Meta's signature instead.

| route | purpose |
|---|---|
| `GET health`, `GET status` | liveness; brain id/model, spend today vs cap, notes dir, `push: { kinds, vapidPublicKey }` |
| `POST setup`, `POST login` | create owner password once; exchange password for a device token |
| `POST pair/start`, `POST pair/redeem`, `GET/DELETE devices[/:id]` | 10-minute single-use pairing codes; device list and revocation |
| `POST ingest` | `{ url? , text?, note?, channel, mode? }` → `202 { itemId, chatId, runId }` |
| `GET chats?q=&tag=`, `GET chats/:id`, `POST chats/:id/read` | list (FTS when `q`), detail with messages/runs/entities, clear unread |
| `POST chats/:id/messages` | follow-up turn (cheap path) |
| `POST chats/:id/research { mode?, note? }` | full re-run, session resumed |
| `GET chats/:id/runs/:runId/events`, `POST runs/:id/cancel` | backfill run events; abort |
| `GET events` (WebSocket, `?token=`) | `run_event` and `chat_updated` frames for live views |
| `POST push/subscribe { kind: webpush\|fcm, endpoint, keys? }`, `POST push/unsubscribe { endpoint }`, `GET push/subscriptions`, `POST push/test` | register this device's push endpoint (webpush needs `keys`; 409 when the kind is not configured on the server); list/remove; send a test notification to this device only |
| `GET ig/status`, `POST ig/connect`, `GET ig/callback`, `DELETE ig/account` | shadow-account state (username, expiry, polling); start OAuth (`{ url }`, 409 when unconfigured); OAuth redirect → `/settings?ig=connected\|error`; disconnect |
| `POST ig/refresh`, `POST ig/poll`, `POST ig/test { recipientId, text? }`, `POST ig/simulate-mention { media_id?, comment_id? }` | force token refresh; run one mention poll; send a DM to yourself; replay a mention through the handler |
| `GET/POST /webhooks/instagram` | Meta handshake (`hub.challenge`) and signed deliveries; `401` on bad signature, `200` then async processing |

CORS is enabled for `capacitor://localhost`, `https://localhost` and `http://localhost` so the
Capacitor WebView can call the API on a different origin; every other origin is same-origin only.

## 10. Security model

Detailed in [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md).

- Untrusted content is wrapped (`<untrusted source= kind=>`) and the system prompt states that
  instructions inside are data. Tool policy is enforced in code, not prose.
- File reads: roots default to `~`, deny list default `~/.ssh`, `~/.aws`, `~/.config`,
  `~/.gnupg`, `~/Library/Keychains`, `~/.doubletake`, `**/.env*`, `**/*.pem`, `**/*.key`,
  `**/node_modules`; symlinks resolved before the check; 2 MB per read. Writes only under
  `~/Doubletake`. No shell.
- Brain network access only through `web_search` and `web_fetch` (SSRF guard: no private
  ranges, size caps, no credentials).
- Every API route requires a device token except the signature-verified webhook and the
  state-checked OAuth callback. When `DOUBLETAKE_WEBHOOK_PUBLIC_HOST` is set, requests carrying
  that `Host` get `404` for every path but the webhook. Secrets at rest (`SecretBox`) are sealed
  with ChaCha20-Poly1305 under `~/.doubletake/keyfile` ([ADR 0018](adr/0018-instagram-channel-and-keyfile-secrets.md)).
- Cost: per-run `maxBudgetUsd` and the daily cap in `cost_ledger`.

## 11. Operations

Runs as a user service (launchd / systemd --user), keeps the machine awake while a run is
active, survives restarts because the queue is in SQLite, logs to `~/.doubletake/logs`.
Backup = copy `~/.doubletake` and `~/Doubletake`. See [DEPLOYMENT.md](DEPLOYMENT.md).

## 12. Known uncertainties (verify during the milestone that depends on them)

- Instagram `mentions` and `comments` webhooks under Standard Access may not fire reliably;
  polling fallback and DM-share are the mitigations (M4).
- TTL of the signed CDN media URL in DM payloads is undocumented; download immediately (M4).
- ~~Claude Agent SDK result-message `subtype` names~~ — verified in M1 against SDK 0.3.x: the
  adapter branches on `is_error` and the presence of `result`. New finding: a proxied or free
  model can return `subtype: success` with an **empty** `result`; the adapter turns that into a
  failed run with an explanatory error instead of storing a blank answer.
- yt-dlp's Instagram extractor breaks periodically; pin the version and surface errors in chat
  (M3).
