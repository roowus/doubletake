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
| Instagram | Official "Instagram API with Instagram Login" on a shadow Business account; DM share + comment @mention; mention semantics set `focus`; bot silent in comments | [0006](adr/0006-instagram-official-api-and-mention-semantics.md) |
| Mobile | One PWA; Android via Capacitor with a custom translucent share activity; desktop = installed PWA; iOS/Windows lower priority | [0007](adr/0007-capacitor-and-custom-share-activity.md) |
| Notifications | Web Push (VAPID) + Android FCM + IG reaction on the source DM; channel interface for Telegram/ntfy later | [0008](adr/0008-notifications.md) |
| Network | Bind loopback; Tailscale serve by default; Cloudflare Tunnel or Tailscale Funnel only for the IG webhook path | [0009](adr/0009-networking.md) |
| Auth | Owner password at setup + long-lived per-device tokens via QR pairing | [0010](adr/0010-auth-owner-password-device-tokens.md) |
| Knowledge | Markdown export of every finished chat into `~/Doubletake`; FTS5 search; auto tags and collections | [0011](adr/0011-markdown-export-fts-tags.md) |
| Structure | Every run also extracts a category and typed entities (places, recipes, products, tools, tips); collections are automatic per category and entity kind | [0014](adr/0014-structured-extraction-and-categories.md) |
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
  worker, and spawns the Python media worker as a long-lived child speaking JSON-lines over
  stdio ([Media pipeline](MEDIA-PIPELINE.md)). `DOUBLETAKE_WORKER_URL` can point at a worker on
  another machine later without changing the protocol.
- **Reachability.** Binds `127.0.0.1`. `tailscale serve` gives HTTPS on the tailnet for
  clients. Only `/webhooks/instagram` is reachable from the public internet, through
  Cloudflare Tunnel or Tailscale Funnel; the server refuses every other route when the request
  arrives with the public hostname ([Deployment](DEPLOYMENT.md)).

## 4. Repository layout

```
apps/server       Fastify + TS: channels/, ingest/, modes/, brains/, media/ (worker client),
                  notify/, api/, auth/, db/ (drizzle + migrations), export/
apps/web          Vite + React PWA: chats, chat view, compose, settings, pairing, service worker
apps/mobile       Capacitor Android (ShareReceiverActivity, FCM); iOS scaffold later
packages/shared   zod schemas + types (Item, Run, Message, events, API DTOs, untrusted wrappers)
packages/brain-sdk BrainAdapter interface, ToolPolicy, contract test harness
workers/media     Python 3.12 (uv): download, transcribe, OCR, frames, comments
docs/             this file, adr/, guides
scripts/          doctor.sh, dev.sh, install-service.sh, check-links.py
```

Toolchain: Node 22, pnpm 10, TypeScript 5 strict, Fastify 5, drizzle-orm + better-sqlite3
(WAL), zod, vitest, biome; Vite 6, React 19, vite-plugin-pwa; Capacitor 7; Python 3.12, uv,
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
3. **Extract** in the media worker, with per-mode budgets: download (CDN URL from the IG
   webhook first, yt-dlp second, cookies opt-in third), transcription (local Whisper family),
   scene-change frame sampling, OCR (RapidOCR, Tesseract fallback), frame descriptions (cloud
   via brain by default, local VLM opt-in), comments (IG Graph API, Reddit JSON, yt-dlp), page
   text (trafilatura), AI-chat share pages (readable text). With `focus = thread:<id>` the
   whole thread is fetched and marked primary; the rest of the comments are a sample.
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
   **Research this** or the model returns `{ "escalate": true }`; the session is resumed so
   prior context carries.

## 7. Brains

Interface, adapters, and configuration are specified in [BRAIN-ADAPTERS.md](BRAIN-ADAPTERS.md).
Key properties: every adapter reports `capabilities()` (resume, vision, streaming, cost
reporting, how tools are provided); tool policy is enforced by code on our side for the Agent
SDK (`canUseTool`) and the API adapter (our loop), and by a sandboxed working directory plus
preamble for external CLI harnesses; the default adapter can be overridden per mode and per run.

## 8. Channels

- **Android share sheet** ([guide](channels/android-share.md)): translucent native activity,
  compact sheet with URL preview, note, mode chips; posts to `/api/ingest` with the device token
  and finishes without booting the WebView.
- **In-app compose**: URL or free text plus note and mode.
- **Instagram** ([guide](channels/instagram-setup.md)): DM share (reliable path) and comment
  @mention (top-level ⇒ `focus=comments`; reply inside a thread ⇒ `focus=thread:<parent_id>`).
  The bot never posts publicly. Webhook payloads are signature-checked and deduplicated.
- **AI-chat share links** (Gemini, ChatGPT, Claude): treated as web pages with a dedicated
  readable-text extractor; no login.
- **Web Share Target** in the PWA manifest so an installed PWA can receive shares on
  Android/Chrome desktop without Capacitor.

## 9. Clients

One PWA. Chat list with unread badges, tag filter and FTS search; chat view with answer,
claims table, sources, live run timeline over WebSocket, cost line, **Research this**, re-run
with another mode; compose; settings (brains, Instagram connect, network, spend cap, paths,
devices); pairing screen that shows a QR for new devices. Android wraps this in Capacitor and
adds the native share activity and FCM. Desktop uses the installed PWA over Tailscale.

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
- Every API route requires a device token except the signature-verified webhook. Secrets at
  rest are encrypted with a key derived from the owner password and a machine keyfile.
- Cost: per-run `maxBudgetUsd` and the daily cap in `cost_ledger`.

## 11. Operations

Runs as a user service (launchd / systemd --user), keeps the machine awake while a run is
active, survives restarts because the queue is in SQLite, logs to `~/.doubletake/logs`.
Backup = copy `~/.doubletake` and `~/Doubletake`. See [DEPLOYMENT.md](DEPLOYMENT.md).

## 12. Known uncertainties (verify during the milestone that depends on them)

- Instagram `mentions` and `comments` webhooks under Standard Access may not fire reliably;
  polling fallback and DM-share are the mitigations (M4).
- TTL of the signed CDN media URL in DM payloads is undocumented; download immediately (M4).
- Claude Agent SDK result-message `subtype` names differ between doc versions; branch on
  `is_error` and presence of `result` (M1).
- yt-dlp's Instagram extractor breaks periodically; pin the version and surface errors in chat
  (M3).
