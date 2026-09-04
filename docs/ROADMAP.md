# Roadmap

Milestones are sequential. Each has acceptance criteria that a person can check by hand;
"done" means every criterion holds and the docs describe what shipped.

## M0 — Docs before code — DONE 2026-09-03

- Repo scaffold green in CI (biome, tsc, vitest, ruff, pytest, link check).
- Every document linked from the README exists and cross-links resolve.
- ADRs 0001–0013 written; decisions table in `ARCHITECTURE.md` points at them.

## M1 — Vertical slice — code complete 2026-09-03, owner acceptance pending

Paste a URL (or text) in the compose box → Claude Agent SDK researches it in Standard mode →
answer appears in a chat. Verified end to end against a real model (Haiku 4.5 through a local
router): quick mode, structured answer with category, entities, tags, Markdown export, cost
recorded. Beyond the original scope, M1 also shipped the server-side platform extractor
registry with Instagram, TikTok, YouTube (incl. Shorts), X/Twitter, Reddit and AI-chat share
links ([ADR 0015](adr/0015-platform-extractor-registry.md)).

- `apps/server` boots, creates `~/.doubletake/doubletake.db` with migrations, serves the PWA.
- `POST /api/ingest` creates item + chat + run; queue worker executes runs one at a time.
- `claude-agent-sdk` adapter implements `run()` and `followUp()` with session resume;
  `canUseTool` enforces `ToolPolicy` (read roots/deny, notes-dir writes, no shell).
- Text-only extraction in the server (readable page text, oEmbed/Open Graph captions, Reddit
  JSON) through the platform extractor registry — no media yet.
- PWA shows chat list with unread badge, chat view with streamed run events and cost line,
  compose box, owner login and device pairing (QR).
- Structured `Answer` parsed from the model output; category and entities stored and shown as
  cards under the answer; tags and category in export frontmatter.
- Markdown export written to `~/Doubletake` on completion.
- Contract tests in `packages/brain-sdk` pass against the adapter with a mocked SDK.

## M2 — Android share sheet + push (done 2026-09-03)

Done: server push layer (Web Push + FCM notifiers, `NotificationHub`, `push/*` routes,
notifications on answered/failed/capped, CORS for Capacitor); PWA service worker with push +
click handlers and the Settings toggle; Capacitor 8 project in `apps/mobile` with
`ShareReceiverActivity` and `Pairing` (Kotlin), pairing screen with server URL, pending-share
replay, FCM registration and notification deep links in `apps/web/src/native.ts`.
Verified on a Galaxy S25 FE (2026-09-03): pairing (code and QR URL), share sheet for URL and
text shares, failure toast + retry, unpaired share → pair → replay, no-FCM refusal in Settings
(details in [android-share.md](channels/android-share.md)). Firebase project provisioned from
the CLI ([DEPLOYMENT.md](DEPLOYMENT.md)), server boots `push: webpush+fcm`, APK carries
`google-services.json`. Verified later the same day over the tailnet (Tailscale on the phone):
FCM notifications arrive with the app killed and deep-link to the chat; pairing by QR URL
against the `ts.net` hostname; real shares from Chrome, the Reddit app (the Reddit app short
link needed a resolver + an Atom fallback in the extractor) and the Instagram app (reel link,
answered with a notification). M2 acceptance is complete. Offline queue for the share sheet
stays a v2 item.

- Capacitor project builds a debug APK; QR pairing stores server URL + device token.
- `ShareReceiverActivity` receives `text/plain` from Instagram, Reddit, Chrome, YouTube; shows
  the compact sheet; posts to `/api/ingest`; never boots the WebView.
- Web Push (VAPID) and FCM both deliver a notification that deep-links to the chat when the app
  is killed.
- Mode chips (Auto / Quick / Standard / Deep) honoured end to end.

## M3 — Media pipeline

Status: **live-verified 2026-09-03** on YouTube (quick run, 73 s end to end: yt-dlp download,
captions, 2 scene frames, RapidOCR, 2 cloud frame descriptions in 9 s, classify, agent answer with
claims table, Markdown export, $0.09) and on Instagram (public reel, page-level + media). The
mlx-whisper path was exercised on the same clip's audio (`whisper-small-mlx`, 2 s warm, ~15 s
first-time model download). The first live run timed out because one-shot brain calls did not
pin the model (fixed in `94c26a1`). Remaining: a caption-less video through the full pipeline
and a Reddit video.

- Worker protocol (JSON-lines over stdio) implemented; server restarts a crashed worker.
- Instagram reel / YouTube / Reddit video: download, transcript (mlx-whisper on Apple Silicon,
  faster-whisper on Linux), scene-change frames, RapidOCR, cloud frame descriptions via the
  brain; local VLM behind `DOUBLETAKE_VISION=local`.
- Comments fetched for Reddit (server extractor) and YouTube (worker); per-mode caps respected;
  extraction budget per mode.
- Untrusted wrappers applied to every extraction; a fixture with an injected instruction is
  ignored by the brain in tests.

## M4 — Instagram channel

- Meta app in Live mode; webhook verified with `X-Hub-Signature-256`; events deduped.
- DM share: media downloaded from the CDN URL immediately; note = message text; `love`
  reaction sent on completion.
- Comment @mention: `focus` derived from whether the mention comment has a parent; thread
  fetched fully; nothing posted publicly.
- Token refresh job; connect/disconnect flow in settings.
- **Verify or refute**: mention webhook under Standard Access. If it does not fire, ship the
  polling fallback and document the limitation prominently.
- Status 2026-09-03: **code complete** ([ADR 0018](adr/0018-instagram-channel-and-keyfile-secrets.md);
  channel module, webhook + host guard, OAuth connect, refresh job, polling fallback, Graph
  extractions, DM reaction; 19 tests against a fake Graph client). **Live verification pending**
  (needs a Meta app, shadow Business account and tunnel; checklist in the
  [guide](channels/instagram-setup.md#6-live-verification-checklist-m4-acceptance)). Settings
  card for connect/status/poll/refresh/disconnect shipped.

## M5 — More brains — done 2026-09-04 (`openai-compatible` verified live; non-Claude CLI presets still unverified)

- ✅ `headless-cli` adapter with presets for `claude -p`, Codex, Gemini CLI, OpenCode, Hermes
  (unit-tested with a fake `spawn`; `claude-code` run live with resume; the other presets'
  flags are unverified).
- ✅ `openai-compatible` adapter with our tool loop (web_search via SearXNG/Brave/Tavily,
  web_fetch, read_file, list_dir, write_sandbox_file) and self-managed conversation storage
  (`apps/server/src/brains/{openai-compatible.ts,tools/}`; unit-tested against a fake endpoint
  and run live against 9Router's OpenAI endpoint with tool calls + follow-up).
- ✅ Per-mode adapter override (`DOUBLETAKE_BRAIN_QUICK/STANDARD/DEEP=adapter[@model]`, runs
  rebound after classification, follow-ups pinned to the session's adapter) and per-adapter
  healthchecks in `GET /api/status` + Settings → Server.

## M6 — Search, tags, collections

- ✅ FTS5 over title, note, transcript, OCR, answers, entities; search box + tag chips in the
  chat list (`GET /api/chats?q=&tag=`, `GET /api/tags`).
- ✅ Auto tags from the run's `tags[]`; manual tags (`POST/DELETE /api/chats/:id/tags`) editable
  from the chat header.
- ✅ Auto collections per category and entity kind seeded at boot; manual collections and
  saved searches (`/api/collections`, `?collection=` filter, chip row + picker in the PWA).
- ✅ Entity views per kind (`/entities/<kind>`, `GET /api/entities?kind=`): places with map
  links, recipes with ingredients, products with price and link, tools with install line.
- ✅ Transcript, OCR, frame descriptions, caption, comments and page text visible in the
  **Sources** panel of the chat view (`extractions[]` on `GET /api/chats/:id`).
- ✅ Re-export on edit; frontmatter stable (tags slugified + sorted), entities as frontmatter
  arrays (`places:`, `recipes:`, `products:`, `tools:`, `people:`).

## Later (not scheduled)

~~Telegram and ntfy notification channels~~ (done 2026-09-04, [ADR 0019](adr/0019-owner-notification-channels.md)) · iOS share extension · tailscale multi-device
(worker on another machine, shared data dir) · MCP server exposing the library to other
agents · Karakeep / Memos import and export · shareable read-only collection pages (SaveToList's
shared lists) · cross-library chat ("what did I save about ski wax?") over FTS, Recall-style ·
map view over place entities · digest notifications (batch quiet-hours pushes).
