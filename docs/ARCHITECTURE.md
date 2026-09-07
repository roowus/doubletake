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
object, reads the owner's files, and integrates with archives (Markdown export, an MCP server for
other agents, Karakeep and Memos import/export) rather than replacing them. The share sheet is the primary
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
| Mobile | One PWA; Android via Capacitor with a custom translucent share activity; iOS via the same wrapper plus a native Share Extension (App Group bridge, no push, **unverified**); desktop = installed PWA; Windows lower priority | [0007](adr/0007-capacitor-and-custom-share-activity.md), [0027](adr/0027-ios-share-extension.md) |
| Notifications | Web Push (VAPID) + Android FCM per device + IG reaction on the source DM; ntfy and Telegram as owner-level broadcasters configured in `.env`; owner-set quiet hours park notifications and send one digest | [0008](adr/0008-notifications.md), [0019](adr/0019-owner-notification-channels.md), [0020](adr/0020-quiet-hours-digest.md) |
| Push keys | VAPID pair auto-generated into `settings` unless env-provided; FCM HTTP v1 with a hand-rolled service-account JWT; `gone` prunes, 8 failures prune | [0016](adr/0016-push-keys-and-fcm-http-v1.md) |
| Network | Bind loopback; Tailscale serve by default; Cloudflare Tunnel or Tailscale Funnel only for the IG webhook path | [0009](adr/0009-networking.md) |
| Auth | Owner password at setup + long-lived per-device tokens via QR pairing | [0010](adr/0010-auth-owner-password-device-tokens.md) |
| Knowledge | Markdown export of every finished chat into `~/Doubletake`; FTS5 search; auto tags and collections; cross-library questions answered by the brain from FTS-retrieved chats | [0011](adr/0011-markdown-export-fts-tags.md), [0021](adr/0021-cross-library-chat.md) |
| Integrations | Other agents read and feed the library over MCP: stateless Streamable HTTP at `/mcp` behind the device-token gate, read tools mirror the REST library routes, extractions stay `<untrusted>`-wrapped, writes only enqueue runs. Karakeep and Memos interchange as files: export in their shapes, import a Karakeep file as `import`-channel items, no runs unless asked | [0023](adr/0023-mcp-server.md), [0024](adr/0024-karakeep-memos-interchange.md) |
| Sharing | A manual list or saved search can be shared as a read-only page at `/s/<token>` (token = credential, script-free HTML, first answers only, never notes or extractions); links stay on the tailnet unless `DOUBLETAKE_SHARE_PUBLIC=on` | [0025](adr/0025-shareable-collection-pages.md) |
| Multi-device | The media worker can run on another tailnet machine: same protocol over HTTP with a bearer token, server mirrors assets and frames into its own data dir (or trusts a shared filesystem path); database, brain, queue and vault never leave the server | [0026](adr/0026-remote-media-worker.md) |
| Uploads | Photos and videos shared as files go to `POST /api/ingest/upload` (raw body, metadata in headers, 500 MiB cap) and become a `text` item with an `upload` media asset that the worker processes in place (`hints.local_path`, pushed to a remote worker with `PUT /files`); the Android sheet copies the file into private storage when queuing offline | [0029](adr/0029-media-uploads.md) |
| Structure | Every run also extracts a category and typed entities (places, recipes, products, tools, tips); collections are automatic per category and entity kind; places are geocoded (brain coordinates first, else a Nominatim-compatible geocoder, cached) and shown on a Leaflet map | [0014](adr/0014-structured-extraction-and-categories.md), [0022](adr/0022-map-view-place-geocoding.md) |
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
                    Web Push) ◀──┤                     yt-dlp · ffmpeg · whisper  fcm, ntfy, telegram) │
                                 │                     · OCR · frame sampling                          │
                                 │ SQLite (~/.doubletake/doubletake.db) + blobs + FTS5 + md export     │
                                 └────────────────────────────────────────────────────────────────────┘
 PWA (Vite + React) ◀── same origin: /api + WebSocket for live run events; installed on desktop,
                        wrapped by Capacitor on Android (share-target activity + FCM) and iOS
                        (Share Extension, no push)
```

- **One process by default.** The server hosts the API, serves the built PWA, runs the queue
  worker, and spawns the Python media worker lazily as a long-lived child speaking JSON-lines
  over stdio ([Media pipeline](MEDIA-PIPELINE.md), [ADR 0017](adr/0017-media-worker-process-and-vision-via-brain.md)).
  A crashed worker is respawned and the request retried once; a failed media stage degrades
  the run to page-level extraction with a warning. `DOUBLETAKE_WORKER_URL` points at
  `doubletake-media serve` on another tailnet machine instead: same protocol over HTTP with a
  bearer token, results mirrored into the server's data dir ([ADR 0026](adr/0026-remote-media-worker.md),
  [Deployment](DEPLOYMENT.md#media-worker-on-another-machine)).
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
                  queue/ (worker), channels/instagram/ (Graph client + channel), secrets/ (SecretBox),
                  mcp/ (library tools for other agents over Streamable HTTP), library/
                  (collections, cross-library ask, Karakeep/Memos interchange)
apps/web          Vite + React PWA: chats, chat view, compose, settings, pairing, service worker,
                  native.ts (Capacitor glue: server-URL prefix, Preferences mirror, FCM, deep links)
apps/mobile       Capacitor 8 Android: ShareReceiverActivity + Pairing (Kotlin); iOS: App +
                  ShareExtension targets, Pairing (Swift), committed Xcode project
packages/shared   zod schemas + types (Item, Run, Message, events, API DTOs, untrusted wrappers)
packages/brain-sdk BrainAdapter interface, ToolPolicy, contract test harness
workers/media     Python 3.12 (uv): download, transcribe, OCR, frames, comments
docs/             this file, adr/, guides
design-system/    doubletake/MASTER.md: PWA experience principles, tokens, component rules
scripts/          doctor.sh, dev.sh, install-service.sh, check-links.py
```

Toolchain: Node 22, pnpm 10, TypeScript 5 strict, Fastify 5, drizzle-orm + better-sqlite3
(WAL), zod, vitest, biome; Vite, React 19, vite-plugin-pwa; Capacitor 8 (Android: Java 21, SDK 36; iOS: Xcode 26, iOS 15+);
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
   channel, focus, modeHint?, adapter?, model?, ig? }` (`adapter`/`model` pin the run to one
   configured brain instead of the mode binding, exactly like the research route). Dedupe on `canonical_url + focus` within 24 h: a re-share
   starts a new run on the existing chat instead of a new item. Create `item`, `chat`,
   `run(queued)`; reply `202` immediately. A photo or video shared as a file (no URL) arrives
   on `POST /api/ingest/upload` instead: the body is streamed into `media/<item_id>/` under a
   500 MiB cap, the item is a `text`-platform item whose `media_assets` row has
   `source: upload`, and the same `clientId` replay applies ([ADR 0029](adr/0029-media-uploads.md)). Only the IG channel sends an immediate
   acknowledgement: a `love` reaction on the DM the moment the share is accepted, so the owner
   knows it was picked up before any research has run (nothing public for mentions); the share
   sheet already shows its own toast.
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
   comments (Reddit JSON, yt-dlp; IG Graph API with M4). An uploaded file skips download: the
   worker gets `hints.local_path` (pushed with `PUT /files` when the worker is remote) and runs
   transcription, frames, OCR and descriptions on it; the `upload` row survives re-extraction.
   Every extraction is stored and enters the brief only as an untrusted block. With `focus = thread:<id>` the whole
   thread is fetched and marked primary; the rest of the comments are a sample.
4. **Research.** Build a `ResearchBrief`: system framing, untrusted content blocks, the owner's
   note, focus instructions, mode budget, tool policy. The adapter runs it, streaming
   `run_events`. Output = Markdown answer plus, when the question type calls for it, a
   structured `Answer { summary, category, entities[], claims[], recommendations[], tags[] }`.
   Entities are always extracted, even in `save_for_later`, so a run with no question still
   files the thing it saw into the right collection ([ADR 0014](adr/0014-structured-extraction-and-categories.md)).
5. **Finish.** Store the message, bump `unread_count`, export
   `~/Doubletake/<yyyy>/<yyyy-mm-dd> <slug>.md` with frontmatter, send Web Push + FCM (the
   IG DM was already hearted on receipt; the finished answer travels by push only), write
   `cost_ledger`.
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
SDK (`canUseTool`) and the API adapter (our loop in `brains/tools/`, which only declares the
tools the policy allows and refuses everything else), and by a sandboxed working directory plus
preamble for external CLI harnesses; the default adapter can be overridden per mode and per run.
Shipped: `claude-agent-sdk`, `openai-compatible` (self-managed JSON sessions under
`<dataDir>/sessions/`), `headless-cli` (any CLI harness as a child process in a per-run sandbox
cwd under `<dataDir>/runs/`, reused on resume because Gemini CLI and OpenCode scope sessions to
the cwd; presets for Claude Code, Codex, Gemini CLI, OpenCode, Hermes, all verified live; tool
policy as a text preamble only). `DOUBLETAKE_BRAIN_<MODE>=adapter[@model]` binds a mode to another adapter: research runs
are rebound after classification (unless the user pinned an adapter from the **Research this**
menu, see [BRAIN-ADAPTERS.md](BRAIN-ADAPTERS.md)), follow-ups stay on the adapter that owns the
chat's session, classification always uses the default adapter. `GET /api/status` carries cached healthchecks for
every configured adapter and Settings shows them ([guide](BRAIN-ADAPTERS.md#selection)).

## 8. Channels

- **Android share sheet** ([guide](channels/android-share.md)): translucent native activity,
  compact sheet with URL preview, note, mode chips; posts to `/api/ingest` with the device token
  and finishes without booting the WebView. A shared photo or video (`EXTRA_STREAM`) is streamed
  to `/api/ingest/upload` from the content URI; of several files only the first is sent. When
  the server is unreachable the body is parked in a WorkManager-drained offline queue and
  delivered later (files are copied into app-private storage first, since the URI grant dies
  with the sheet); each share carries a `clientId` so the server replays, rather than repeats,
  a retry whose first response was lost. Finished, failed and capped runs push a notification
  (`NotificationHub`, [ADR 0016](adr/0016-push-keys-and-fcm-http-v1.md)) to every subscribed
  device: FCM for the Android app (the token is first posted from Settings → Notifications and
  re-posted on every sign-in while permission is granted, so a revoked-then-re-paired device is
  not silently dropped), Web Push for installed PWAs. Owner-level channels (ntfy
  topic, Telegram chat; [ADR 0019](adr/0019-owner-notification-channels.md)) are configured
  in `.env` and receive every notification too.
- **iOS share extension** ([guide](channels/ios-share.md),
  [ADR 0027](adr/0027-ios-share-extension.md); simulator-verified, **unverified** on a device): native
  `ShareExtension` target with the same card (URL or text preview, note, mode chips) posting to
  `/api/ingest` as `channel=ios_share`; media-only shares stream the file to
  `/api/ingest/upload` with the same `X-Doubletake-*` headers as Android. The extension cannot read Capacitor Preferences, so
  `SceneDelegate` mirrors the server URL and token into the App Group
  `group.com.roowus.doubletake`; when unpaired the extension stashes the share there and opens
  `doubletake://share`, which the app replays into `/share` after pairing. No push on iOS in
  v1 (no APNs); Settings points at ntfy/Telegram.
- **In-app compose**: URL or free text plus note and mode.
- **Library chat** (`channel=library`, [ADR 0021](adr/0021-cross-library-chat.md)): a question
  about everything already saved. `library/ask.ts` turns it into an FTS query (filler words
  dropped, remaining terms OR-ed, bm25 rank), renders up to 8 matching chats (note, source,
  tags, entities, latest answer, extracted text) as untrusted `library` blocks, stores them as
  `library-fts` extractions, and the brain answers with links back to each `/chat/<id>`. No
  classifier call; Quick unless the chip or note keywords say otherwise. Library chats are never
  retrieved for later library questions.
- **Instagram** ([guide](channels/instagram-setup.md), [ADR 0018](adr/0018-instagram-channel-and-keyfile-secrets.md)):
  DM share (reliable path) and comment @mention (top-level ⇒ `focus=comments`; reply inside a
  thread ⇒ `focus=thread:<parent_id>`). `InstagramChannel` verifies and deduplicates webhook
  deliveries, stores caption/comments/thread from the Graph API as `instagram-graph`
  extractions (merged into the brief as untrusted blocks), hands the CDN URL to the media stage
  via `mediaHints`, polls `/tags` every 2 min as a mention fallback, refreshes the token every
  30 days and reacts `love` to the originating DM as soon as the share is accepted (the
  `onOutcome` worker hook stays wired but sends nothing). The bot never posts publicly.
  Enabled only when `IG_APP_ID` + `IG_APP_SECRET` are set; boot log prints `instagram: …`.
- **AI-chat share links** (Gemini, ChatGPT, Claude): treated as web pages with a dedicated
  readable-text extractor; no login.
- **Web Share Target** in the PWA manifest so an installed PWA can receive shares on
  Android/Chrome desktop without Capacitor.
- **Import** (`channel=import`, [ADR 0024](adr/0024-karakeep-memos-interchange.md)): a
  Karakeep export file posted to `/api/import/karakeep`. `library/interchange.ts` turns each
  bookmark into an item + chat with its original date, tags and manual lists (as manual
  collections), skips links already saved (canonical URL, all time) and indexes the note in
  FTS at once. No run is queued unless `?research=<mode>` is passed; imports are free by
  default. The same module renders the library as a Karakeep file and as Memos create bodies
  (`/api/export/karakeep`, `/api/export/memos`).

## 9. Clients

One PWA (`apps/web`, Vite + React, served by the server at `/` from `apps/web/dist`, or by
the Vite dev server with `/api` proxied). Its visual language is defined in
[`design-system/doubletake/MASTER.md`](../design-system/doubletake/MASTER.md): experience
principles per moment (**Capture** = share sheet / compose, **Return** = the answer chat,
**Browse** = list, collections, entities, map), colour tokens (**paper** light by default,
**ink** dark via `prefers-color-scheme` or a `data-theme` attribute on `<html>`, contrast
checked), typography (Instrument Sans for the interface, Newsreader for answer prose,
JetBrains Mono for run meta and code), a 4/8 px spacing rhythm, 44 px touch targets,
component rules and anti-patterns. The app is a four-tab shell (`components/Shell.tsx`):
**Inbox** `/`, **Library** `/library`, **Add** `/compose` and **Settings** `/settings`
(sections at `/settings/<section>`), drawn as a bottom tab bar on phones (56 px plus the safe
area; hidden on a chat page so the follow-up composer owns the bottom edge) and as a left rail
with the brand mark from 900 px, the content column capped at 760 px. `navigateWithTransition()`
in `router.tsx` wraps a navigation in the View Transitions API when the browser has it and
motion is not reduced. Implementation
conventions that follow from it: all styling lives in `src/styles.css` as CSS custom
properties and small utility classes (`.page`, `.card`, `.stack`, `.row`, `.chips`, `.field`,
`.banner`, `.list-row`, `.kv-row`), no inline `style=` in components; icons are an inline SVG
set (`components/Icon.tsx`, `platformIcon()` for platform marks), never emoji or arrow glyphs;
every icon-only control has an `aria-label`; form inputs have visible labels and inline help;
errors render as `.banner.error` with `role="alert"` and keep the user's input; chips never
wrap mid-word and use `aria-pressed` / `aria-current` for state; motion respects
`prefers-reduced-motion`. Fonts are bundled, never fetched from a CDN: `src/fonts.css` declares
the latin subsets of Instrument Sans, Newsreader and JetBrains Mono from `@fontsource-variable`
and the service worker precaches the `woff2` files with the rest of the shell, so an installed
app renders the same offline. `pnpm --filter @doubletake/web shots <dir>` (Playwright, Chromium)
screenshots every route of a running server at phone and desktop sizes in both colour schemes
for design review; `DOUBLETAKE_URL` and `DOUBLETAKE_TOKEN_FILE` point it at the server.

Screens: **Library** tab (`pages/Library.tsx`): entity kinds and the map as tiles with counts
(the counts come from the seeded `entity:<kind>` auto collections, so the page costs two
requests), the owner's manual lists and saved searches then the non-empty category collections
as tiles, a **New collection** form, and every tag in use as an alphabetical list with counts;
each tile opens the filtered inbox (`/?collection=`, `/?tag=`) or the entity view. **Inbox**
(`pages/Inbox.tsx`): a search field over the FTS index whose **Ask** button turns the text into
a `library` question and opens its chat, a funnel button beside it that opens the **Filter**
sheet (`components/Sheet.tsx`, a Base UI `Dialog` drawn as a bottom sheet on phones and a
centred dialog from 768 px: status, platform, collections and tags as pressed chips), and one
removable **summary chip** ("Places to visit · #ski · YouTube") while filters are active. Tag
and collection filters go to the server (`GET /api/chats?q=&tag=&collection=`); platform and
status are applied client-side on the summaries. Filters live in the URL (`?tag=`,
`?collection=`, `?platform=`, `?status=`) so Library tiles and shared links land on a filtered
inbox. The list itself is split into an **Unread** section and the rest, each row showing the
platform (or channel) glyph, the title in the prose face, a one-line meta row (status while a
run is working or has failed, category, up to three tags in clay) and the age with an unread
count. Collections are managed from the Library tab: each tile has an overflow menu
(`components/Menu.tsx`, Base UI Menu) with hide, **share** as a read-only page whose link is
copied to the clipboard ([ADR 0025](adr/0025-shareable-collection-pages.md)) and delete, the
latter behind an alert dialog (`components/Confirm.tsx`); the **New collection** form creates a
manual list or a saved search with a live match count.
The Library tab also links to the
**entity views** `/entities/<kind>` (kind chips, a filter field, one card per entity with the
name, icon links to the web page and to Maps, attributes as a definition list and a footer
linking back to the chat it came from; places, recipes, products, tools, tips, media, people,
events) and to the **map** `/map` (Leaflet, lazy-loaded as its own chunk so it never sits in
the main bundle, over OpenStreetMap tiles fetched by the browser;
one circle marker per located place, popup linking to its chat, a collapsible list of
unlocated places with a Maps search link and a **Locate N more** backfill button,
[ADR 0022](adr/0022-map-view-place-geocoding.md)). The chat view is a **notebook page** about one shared thing, not a chat
transcript (`pages/Chat.tsx`, split into `components/ChatHeader.tsx`, `ClipCard.tsx`,
`Answer.tsx`, `AnswerTabs.tsx` and `FollowUp.tsx`): nothing sits in a bubble. The header is
back, the status badge and an overflow menu (Tags…, Collections…, **Research again, deeper**),
then the title in the prose face with the platform glyph and one mono small-caps meta line
(mode, category, host, total cost). The **clip card** shows what was shared (thumbnail, image
or sampled frame, title, canonical link; `item.preview` on `GET /api/chats/:id` names the
asset and `GET /api/chats/:id/media/:mediaId` serves it behind the same device-token gate,
fetched with a bearer header into a blob URL so the token never appears in an `src`; typed
text has no card), followed by the tag chips. Turns then run down the page: the owner's note
and follow-up questions are a dated one-line label ("You wrote" / "You asked") over italic
prose, and every answer is full-width prose (Newsreader, measure capped at 68 ch, GitHub-
flavoured Markdown via `react-markdown` + `remark-gfm`: tables with hairlines and a sticky
first column on phones, task lists, blockquotes set as margin notes, code on `--code-bg`; raw
HTML never renders). Three fenced blocks are drawn instead of shown as code
(`components/Markdown.tsx` detects the fence language): \`\`\`chart is a JSON spec validated by
`packages/shared/src/chart.ts` (bar / line / pie with ≤ 8 series × 60 points, or `stat` rows)
and drawn as themed SVG by `components/Chart.tsx` from the parsed numbers only — colours come
from the `--chart-1..8` tokens through class names, labels are React text, and the same data is
always emitted as a table (visually hidden, or shown in place of the picture when the spec fails
validation, together with the reason); \`\`\`mermaid is rendered by `components/Mermaid.tsx`,
which lazy-loads Mermaid as its own chunk on first use, initialises it once per theme at
`securityLevel: 'strict'` with HTML labels off and theme variables read from the CSS tokens,
and still passes the returned SVG through DOMPurify (`svg.ts` `cleanMermaidSvg`: styles kept,
scripts / handlers / links / images / remote `url()` and `@import` stripped) before insertion,
falling back to the source as a code block with Mermaid's first error line when it does not
parse; \`\`\`svg is a small diagram the brain drew itself, inlined only after the stricter
`cleanSvg` profile (no styles either). The system prompt documents all three and when to use
which (numbers → chart, structure → mermaid, spatial → svg) and forbids facts that live only
in a picture (`apps/server/src/brains/prompts.ts`, `test/prompts.test.ts`, fixture
`test/fixtures/rich-answer.md` shared with the web render test). The prose sits beside the **margin rail**, the app's signature element: a 3 px rule in the accent colour that
marks where an answer starts, with the run's meta (mode, brain when pinned, duration, cost,
time) in mono small caps above it. While a run is live the rail is drawn faded and fills
top-to-bottom as the run moves through queued → extracting → classifying → researching (a
`data-rail-pct` attribute mapped to CSS, nudged by the number of tool events), skeleton lines
stand in for the answer and a Cancel button sits in the label. Under the turns four segmented
tabs (Base UI `Tabs`) hold the detail: **Claims** (verdict chip in `--ok/--warn/--err`, a
confidence bar, numbered source links), **Things** (entities grouped by kind with their
attributes and links), **Sources** (every extraction the brain saw — transcript, on-screen
text, frame descriptions, caption, comments, thread, page text — flattened to readable text by
`extract/flatten.ts`, one collapsible per extraction) and **Run** (each run as a disclosure with
its status, mode, duration and cost, and the live or backfilled event timeline from
`GET /api/chats/:id/runs/:runId/events` and the `/api/events` WebSocket). Tags and collections
are edited from bottom sheets opened by the tag chips or the overflow menu (`TagEditor.tsx`,
`CollectionPicker` from `pages/Entities.tsx`; every tag edit re-indexes FTS and re-exports the
Markdown note). The follow-up composer is a sticky bar at the foot of the page: a one-line
field that grows to six, Enter sends, and a compass opens the **Research this** menu
(Quick/Standard/Deep re-run with time hints plus a **Brain** selector when several adapters are
configured that pins the run). **Add** is a full-page compose (`pages/Compose.tsx`): a prose-face paste field
that becomes a question when the text is not a URL, a note field, the research mode as a
segmented control (`components/ModeControl.tsx`, radio group with the mode's hint and time
below) and a **Default brain** menu that pins the run to one adapter (sent as `adapter` on
`POST /api/ingest`) when several are configured; `/share` receives Web Share Target requests
into the same page. The **entity view** (`pages/Entities.tsx`, `/entities/<kind>`) lists one
kind with a count, a kind switcher and a filter field; cards show the attributes worth
surfacing per kind as a mono-labelled definition list and link back to their chat;
settings as titled sections (server status and spend vs cap, **Notifications** enable/disable
+ send test + quiet hours, **Instagram** connect/disconnect/status, QR pairing, devices,
import/export, sign out). The service worker
is a custom `src/sw.ts` (vite-plugin-pwa `injectManifest`): Workbox precache for the shell,
never the API, plus `push` (shows the notification) and `notificationclick` (focuses an open
window and navigates to `/chat/<id>`, else opens one) handlers. First run asks for the owner password; other devices redeem a pairing
code shown as a QR. Android wraps this in Capacitor and adds the native share activity and FCM.
Desktop uses the installed PWA over Tailscale.

### API surface (M1 + M2 + M4 + M6)

All routes under `/api` take `Authorization: Bearer <device token>` except `health`,
`setup/status`, `setup` (first run only), `login`, `pair/redeem` and `ig/callback` (OAuth
redirect, protected by a 10-minute random `state`). `/webhooks/instagram` is outside `/api`
and is authenticated by Meta's signature instead. `/mcp` is outside `/api` too but takes the
same Bearer token: it is the MCP endpoint for other agents ([ADR 0023](adr/0023-mcp-server.md),
connection recipe in [DEPLOYMENT.md](DEPLOYMENT.md#connect-an-agent-mcp)).

| route | purpose |
|---|---|
| `GET health`, `GET status` | liveness; brain id/model, spend today vs cap, notes dir, `push: { kinds, channels, vapidPublicKey, quietHours, pending }` |
| `POST setup`, `POST login` | create owner password once; exchange password for a device token |
| `POST pair/start`, `POST pair/redeem`, `GET/DELETE devices[/:id]` | 10-minute single-use pairing codes; device list and revocation |
| `POST ingest` | `{ url? , text?, note?, channel, modeHint?, focus?, clientId?, adapter?, model? }` (`adapter` must name a configured brain, else `400`; with it the run is `pinned`) → `202 { itemId, chatId, runId, deduplicated, replayed }`; a repeated `clientId` (offline share queue retrying after a lost response) returns the first ingest's ids with `replayed: true` and creates nothing |
| `POST ingest/upload` | raw body = one image or video (`Content-Type: image/*` or `video/*`, allow-listed types, ≤ 500 MiB); note, channel, mode and client id travel in URI-encoded `x-doubletake-note/channel/mode/client-id` headers → same `202` shape; `415` for non-media types, `400` for a media type outside the list, `413` over the cap ([ADR 0029](adr/0029-media-uploads.md)) |
| `POST library/chat` | `{ question, modeHint? }` → `202 { itemId, chatId, runId }`; a `library` item whose run answers from retrieved chats |
| `GET chats?q=&tag=&collection=`, `GET chats/:id`, `POST chats/:id/read` | list (FTS when `q`, tag filter when `tag`, membership of a collection when `collection`; 404 for an unknown id), detail with messages/runs/entities/extractions (flattened text, newest per kind+tool), clear unread |
| `GET tags`, `POST chats/:id/tags { name }`, `DELETE chats/:id/tags/:name` | all tags with counts; add a manual tag (normalised: trimmed, lowercase, ≤40 chars); remove any tag from the item. Both edits re-index FTS, re-export the note and emit `chat_updated` |
| `GET collections?all=&hidden=`, `POST collections { name, query? }`, `POST collections/:id { name?, query?, hidden? }`, `DELETE collections/:id` | list with item counts (empty auto collections omitted unless `all=true`, hidden ones unless `hidden=true`; auto collections are seeded at boot, one per category and one per entity kind); create a manual list (no `query`) or a saved search (`query` = `category:<c>` · `entity:<kind>` · `tag:<name>` · FTS text); rename/retarget/hide (400 when giving an auto collection a query); delete (400 for auto — hide instead) |
| `POST collections/:id/share`, `DELETE collections/:id/share`, `GET /s/:token` (no `/api` prefix, no token gate) | mint (idempotent) or revoke a read-only link for a manual list or saved search (400 for auto collections); `GET collections` carries `shareUrl` per collection; the page is self-contained HTML, `404` for unknown or revoked tokens and hidden collections ([ADR 0025](adr/0025-shareable-collection-pages.md)) |
| `POST collections/:id/items { chatId }`, `DELETE collections/:id/items/:chatId`, `GET chats/:id/collections`, `GET collections/preview?query=` | add to / remove from a manual list (400 otherwise; emits `chat_updated`); the manual collections a chat is in; how many items a query would match |
| `GET entities?kind=&limit=` | every entity of one kind across items, newest item first, each with `chatId`, `itemTitle`, `platform`, `createdAt` for the entity views; located places also carry `geo { lat, lon, label, source: brain \| geocoder }` |
| `POST entities/geocode?retry=` | locate every `place` entity not yet in the `place_geo` cache through the configured geocoder (`retry=misses` forgets cached misses first); returns `{ places, located, unknown, retried }`; 409 when `GEOCODER=off` |
| `POST chats/:id/messages` | follow-up turn (cheap path) |
| `POST chats/:id/research { mode?, note?, adapter?, model? }` | full re-run, session resumed; `adapter` pins the run to one configured brain (`pinned` on the run DTO; 400 if unknown) |
| `GET chats/:id/runs/:runId/events`, `POST runs/:id/cancel` | backfill run events; abort |
| `GET events` (WebSocket, `?token=`) | `run_event` and `chat_updated` frames for live views |
| `POST push/subscribe { kind: webpush\|fcm, endpoint, keys? }`, `POST push/unsubscribe { endpoint }`, `GET push/subscriptions`, `POST push/test` | register this device's push endpoint (webpush needs `keys`; 409 when the kind is not configured on the server); list/remove; send a test notification to this device only |
| `POST push/channels/test` | send a test message to the owner channels (ntfy, Telegram) only; 404 when none is configured. `GET status` lists them as `push.channels` |
| `PUT push/quiet-hours { enabled, start, end, timeZone }`, `POST push/digest/flush` | set the quiet window (`HH:MM`, IANA zone; disabling flushes at once); send the parked digest now ([ADR 0020](adr/0020-quiet-hours-digest.md)) |
| `GET ig/status`, `POST ig/connect`, `GET ig/callback`, `DELETE ig/account` | shadow-account state (username, expiry, polling); start OAuth (`{ url }`, 409 when unconfigured); OAuth redirect → `/settings?ig=connected\|error`; disconnect |
| `POST ig/refresh`, `POST ig/poll`, `POST ig/test { recipientId, text? }`, `POST ig/simulate-mention { media_id?, comment_id? }` | force token refresh; run one mention poll; send a DM to yourself; replay a mention through the handler |
| `POST ig/verify` | probe `subscribed_apps` and `/tags`, re-subscribe missing webhook fields, report `commentsOk` (Settings → Check comment access) |
| `GET/POST /webhooks/instagram` | Meta handshake (`hub.challenge`) and signed deliveries; `401` on bad signature, `200` then async processing |
| `GET export/karakeep`, `GET export/memos`, `POST import/karakeep?research=quick\|standard\|deep` | download the library as a Karakeep export file / as Memos `{ memos: [{ content, visibility, create_time }] }`; import a Karakeep file → `{ imported, skipped, collections, runs }` (32 MiB body limit; 400 when not that shape; [ADR 0024](adr/0024-karakeep-memos-interchange.md)) |
| `POST /mcp` (`GET`/`DELETE` → 405) | Streamable HTTP MCP, stateless, JSON responses. Tools: `search_library { query, limit }`, `list_chats { collection?, tag?, limit }`, `get_chat { chat_id, include_extractions, wait_seconds ≤120 }`, `list_collections`, `list_tags`, `list_entities { kind, limit }` (read-only); `save { url?, text?, note?, mode }` → channel `mcp`, `ask_library { question, mode }` → channel `library` (enqueue only) |

CORS is enabled for `capacitor://localhost` (the iOS WebView origin), `https://localhost` and
`http://localhost` (Android) so the Capacitor WebView can call the API on a different origin; every other origin is same-origin only.
On the Android side the WebView allows mixed content and the network security config permits
cleartext to `localhost`/`127.0.0.1` only, so `adb reverse` device testing works while any real
server URL stays https ([android-share.md](channels/android-share.md)).

## 10. Security model

Detailed in [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md).

- Untrusted content is wrapped (`<untrusted source= kind=>`) and the system prompt states that
  instructions inside are data. Tool policy is enforced in code, not prose.
- File reads: roots default to `~`, deny list default `~/.ssh`, `~/.aws`, `~/.config`,
  `~/.gnupg`, `~/Library/Keychains`, `~/.doubletake`, `**/.env*`, `**/*.pem`, `**/*.key`,
  `**/node_modules`; `~` expanded and symlinks resolved before the check; 2 MB per read. Writes only under
  `~/Doubletake`. No shell.
- Brain network access only through `web_search` and `web_fetch` (SSRF guard: no private
  ranges, size caps, no credentials).
- Brain output is rendered as Markdown with raw HTML disabled. The only markup that reaches the
  DOM is SVG: a fenced `svg` block or Mermaid's output, both after DOMPurify (SVG profile, no
  scripts / handlers / links / images / external references; styles only for Mermaid), and
  charts drawn by our own renderer from validated numbers. An injected answer can draw shapes
  but cannot run code, navigate or fetch from a third party. Mermaid itself runs at
  `securityLevel: 'strict'`, so `click` directives and HTML in labels are inert.
- The MCP endpoint exposes the library only: no file, shell or network tools, no settings or
  deletion. Scraped text leaves it inside the same `<untrusted>` wrapper the brain gets, and
  the calling agent is a paired device that Settings → Devices can revoke
  ([ADR 0023](adr/0023-mcp-server.md)).
- Every API route requires a device token except the signature-verified webhook, the
  state-checked OAuth callback and the shared collection pages at `/s/<token>`, where the
  random token is the credential and the response is script-free HTML under
  `default-src 'none'`, `noindex`, `no-store`, showing titles, tags and first answers only;
  hidden or unshared collections answer `404` ([ADR 0025](adr/0025-shareable-collection-pages.md)).
  When `DOUBLETAKE_WEBHOOK_PUBLIC_HOST` is set, requests carrying
  that `Host` get `404` for every path but the webhook (and `/s/` when
  `DOUBLETAKE_SHARE_PUBLIC=on`). Secrets at rest (`SecretBox`) are sealed
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
