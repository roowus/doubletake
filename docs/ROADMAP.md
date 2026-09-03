# Roadmap

Milestones are sequential. Each has acceptance criteria that a person can check by hand;
"done" means every criterion holds and the docs describe what shipped.

## M0 — Docs before code (this phase)

- Repo scaffold green in CI (biome, tsc, vitest, ruff, pytest, link check).
- Every document linked from the README exists and cross-links resolve.
- ADRs 0001–0013 written; decisions table in `ARCHITECTURE.md` points at them.

## M1 — Vertical slice

Paste a URL (or text) in the compose box → Claude Agent SDK researches it in Standard mode →
answer appears in a chat.

- `apps/server` boots, creates `~/.doubletake/doubletake.db` with migrations, serves the PWA.
- `POST /api/ingest` creates item + chat + run; queue worker executes runs one at a time.
- `claude-agent-sdk` adapter implements `run()` and `followUp()` with session resume;
  `canUseTool` enforces `ToolPolicy` (read roots/deny, notes-dir writes, no shell).
- Web page extraction only (trafilatura in the worker, or a TS fallback) — no media yet.
- PWA shows chat list with unread badge, chat view with streamed run events and cost line,
  compose box, owner login and device pairing (QR).
- Markdown export written to `~/Doubletake` on completion.
- Contract tests in `packages/brain-sdk` pass against the adapter with a mocked SDK.

## M2 — Android share sheet + push

- Capacitor project builds a debug APK; QR pairing stores server URL + device token.
- `ShareReceiverActivity` receives `text/plain` from Instagram, Reddit, Chrome, YouTube; shows
  the compact sheet; posts to `/api/ingest`; never boots the WebView.
- Web Push (VAPID) and FCM both deliver a notification that deep-links to the chat when the app
  is killed.
- Mode chips (Auto / Quick / Standard / Deep) honoured end to end.

## M3 — Media pipeline

- Worker protocol (JSON-lines over stdio) implemented; server restarts a crashed worker.
- Instagram reel / YouTube / Reddit video: download, transcript (mlx-whisper on Apple Silicon,
  faster-whisper on Linux), scene-change frames, RapidOCR, cloud frame descriptions via the
  brain; local VLM behind `DOUBLETAKE_VISION=local`.
- Comments fetched for Reddit and YouTube; per-mode caps respected; extraction budget per mode.
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

## M5 — More brains

- `headless-cli` adapter with presets for `claude -p`, Codex, Gemini CLI, OpenCode, Hermes.
- `openai-compatible` adapter with our tool loop (web_search via SearXNG/Brave/Tavily,
  web_fetch, read_file, list_dir, write_sandbox_file) and self-managed conversation storage.
- Per-mode adapter override; adapter healthcheck in settings.

## M6 — Search, tags, collections

- FTS5 over title, note, transcript, OCR, answers; search UI.
- Auto tags from the run's `tags[]`; collections as saved tag queries; manual tags.
- Re-export on edit; Obsidian-friendly frontmatter stable.

## Later (not scheduled)

Telegram and ntfy notification channels · iOS share extension · tailscale multi-device
(worker on another machine, shared data dir) · MCP server exposing the library to other
agents · Karakeep / Memos import and export · structured answer templates per question type ·
digest notifications (batch quiet-hours pushes).
