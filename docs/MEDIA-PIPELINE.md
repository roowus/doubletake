# Media pipeline

Runs in `workers/media` (Python 3.12, uv). The server spawns it once and keeps it alive.

## Worker protocol

JSON-lines over stdio. Server → worker requests, worker → server responses and progress events.

```jsonc
// request
{ "id": "01J…", "op": "extract", "item_id": "…", "url": "…", "platform": "instagram",
  "focus": "thread:178…", "mode": "standard",
  "hints": { "cdn_url": "https://lookaside.fbsbx.com/…", "media_id": "…", "comment_id": "…" },
  "budget": { "frames": 12, "vision_frames": 6, "comments": 100, "transcribe_model": "large-v3-turbo" },
  "out_dir": "/Users/me/.doubletake/media/01J…" }

// progress (many)
{ "id": "01J…", "event": "progress", "stage": "download" | "transcribe" | "frames" | "ocr" | "comments" | "page", "pct": 40, "detail": "…" }

// result (one)
{ "id": "01J…", "event": "result", "ok": true,
  "assets": [{ "kind": "video", "path": "source.mp4", "sha256": "…", "bytes": 1, "duration_s": 31.2, "width": 1080, "height": 1920, "source": "cdn" }],
  "extractions": [{ "kind": "transcript", "tool": "mlx-whisper/large-v3-turbo", "duration_ms": 4100, "content": { … } }],
  "vision_requests": [{ "frame_path": "frames/000004.jpg", "ts": 4.1 }],   // server fulfils via brain when vision=cloud
  "canonical_url": "https://www.instagram.com/reel/…/", "title": "…" }

// error
{ "id": "01J…", "event": "result", "ok": false, "error": { "code": "download_failed", "message": "…", "retryable": true } }
```

Other ops: `ping`, `describe_frames` (only when `DOUBLETAKE_VISION=local`), `fetch_comments`
(re-fetch for Deep escalation), `shutdown`. The server restarts the worker on crash and fails
the in-flight run with `retryable: true`.

## Platform extractors (server side, M1)

Before the media worker exists (and always, as the first step), the server's extractor
registry in `apps/server/src/extract/` turns a shared URL into text the brain can use. Each
extractor implements `PlatformExtractor { platform, match(url), canonicalize(url), extract(url, ctx) }`;
`ctx.fetchText` is the only network access and carries the SSRF guard and size cap. The first
extractor whose `match` returns true wins; `web` is registered last as the fallback.

| platform | matches | canonical form | text sources without media | notes |
|---|---|---|---|---|
| instagram | `instagram.com/{p,reel,reels,tv}/<code>` (optional `/<user>/` prefix) | `https://www.instagram.com/<kind>/<code>/` | Open Graph caption/title from the public page (often a login wall → warning) | media, transcript and comments arrive with M3/M4 |
| tiktok | `tiktok.com/@user/video|photo/<id>`, `/v/<id>`, `/embed/v2/<id>`, `vm.`/`vt.` short links | `https://www.tiktok.com/@<user>/video/<id>` | official oEmbed (title = caption, author) | short links are resolved by one HEAD-like fetch first |
| youtube | `youtube.com/watch?v=`, `/shorts/<id>`, `/embed/`, `/live/`, `/v/`, `youtu.be/<id>`, music/mobile hosts | `https://www.youtube.com/watch?v=<id>` or `https://www.youtube.com/shorts/<id>` | oEmbed (title, channel); `short: true` flag stored | Shorts keep the `/shorts/` form so the UI can label them and the worker can skip caption download for very short clips |
| x | `x.com|twitter.com/<user>/status/<id>`, also `fxtwitter`/`vxtwitter`/`fixupx` mirrors | `https://x.com/<user>/status/<id>` | `publish.twitter.com/oembed` (tweet text, author) | quote tweets and threads are M3 (syndication JSON) |
| reddit | `reddit.com/r/<sub>/comments/<id>`, `/comments/<id>`, `/r/<sub>/s/<id>` app share links, `redd.it/<id>` | `https://www.reddit.com/r/<sub>/comments/<id>/` (share links are followed through their 301 at extract time; the resolved URL and platform are written back to the item) | public `.json` view: title, self text, capped comment tree; when Reddit answers 403 ("blocked by network security", seen from a home network for every UA and for `api.`/`old.` too) the thread's Atom feed `<permalink>.rss?limit=200` is used instead: title, author, self text, outbound link, flat comments without scores (a warning says so) | already covers `focus=comments` without the worker |
| aichat | `gemini.google.com/share/…`, `chatgpt.com/share/…`, `claude.ai/share/…` | as given, tracking stripped | readable page text | no login; treated as a transcript of the shared chat |
| web | anything else `http(s)` | tracking params stripped | readable text + Open Graph description | fallback |

All extractors strip the common tracking parameters (`utm_*`, `igsh`, `si`, `fbclid`, `s`, `t`
on X, …) so dedupe on `canonical_url` works across share sheets.

### Adding a platform

1. Create `apps/server/src/extract/platforms/<name>.ts` exporting a `PlatformExtractor`. Use
   `_shared.ts` helpers (`stripTracking`, `fetchOEmbed`, `stripHtml`, `result`, `MEDIA_LATER`).
   `extract` must not throw on partial failure: push a human-readable line into `warnings`
   instead; it is shown in the chat.
2. Add the id to the `Platform` enum in `packages/shared/src/schemas.ts`.
3. Register it in `apps/server/src/extract/registry.ts` **above** `webExtractor`.
4. Add a row to the table above and, if the worker needs a download recipe, to the Download
   table below. Add a `match`/`canonicalize` unit test next to the existing ones.

## Stages

### Download
Order of preference per platform:

| platform | 1st | 2nd | 3rd |
|---|---|---|---|
| instagram | signed CDN URL from the DM webhook (`hints.cdn_url`; TTL undocumented, fetch immediately) | `yt-dlp` (pinned ≥ 2026.08.19) anonymous | `yt-dlp --cookies-from-browser <browser>` if `DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER` is set |
| tiktok | `yt-dlp` anonymous (resolves `vm.`/`vt.` short links first) | `yt-dlp --cookies-from-browser` opt-in | |
| youtube (videos and Shorts) | `yt-dlp` with `--write-subs --write-auto-subs` (skip transcription if captions exist) | | |
| x | `yt-dlp` for native video; images via the syndication CDN URLs in the tweet metadata | | |
| reddit | `<permalink>.json` for post + comments; `yt-dlp` for v.redd.it video | | |
| web / aichat | HTTP fetch + `trafilatura` readable text (AI share pages: gemini.google.com/share, chatgpt.com/share, claude.ai/share are ordinary pages; extract turns by their DOM roles when recognisable) | | |

Size cap 500 MB, duration cap 60 min (Deep), 15 min (Quick/Standard, keep first 15 min).

### Transcription
Backend chosen by `DOUBLETAKE_WHISPER_BACKEND=auto`:

| platform | backend | model by mode |
|---|---|---|
| Apple Silicon | `mlx-whisper` | quick: `large-v3-turbo` (still fast on MLX) · standard/deep: `large-v3-turbo` |
| Apple Silicon fallback | `whisper.cpp` (Metal, CoreML encoder) | same GGML models |
| Linux / Intel CPU | `faster-whisper` int8 | quick: `small` · standard: `medium` · deep: `large-v3-turbo` |

Audio extracted with ffmpeg to 16 kHz mono WAV. Output: language, segments with timestamps.
Silence/no-speech detection short-circuits to an empty transcript (music-only reels).

### Frames
`ffmpeg -vf "select='gt(scene,0.3)',showinfo"` for scene changes, plus first and last frame,
capped at `budget.frames` by keeping the frames with the highest scene score. Saved as JPEG
q=85 at max 1280 px on the long side.

### OCR
RapidOCR (ONNX runtime, CPU) on every sampled frame; Tesseract as fallback when RapidOCR is
unavailable. Lines deduplicated across frames (normalised Levenshtein ≤ 0.15 treated as same
overlay). Output keeps per-frame lines plus a merged unique list.

### Vision (frame descriptions)
Default `cloud`: the worker returns `vision_requests` and the server calls the configured
brain's `describeImages()` with a prompt that asks for on-screen text, products, UI, people
(no identification), and actions. Opt-in `local`: `mlx-vlm` with Qwen2.5-VL-3B-Instruct
(Apple Silicon) or Moondream2 (CPU), run in the worker. Cost per frame in cloud mode is
recorded on the `frame_description` extraction.

### Comments
- Instagram (own media): `GET /<media_id>/comments?fields=id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}`.
- Instagram (someone else's media, via mention): `GET /<IG_ID>?fields=mentioned_media.media_id(<id>){caption,permalink,media_url,media_type,comments{…}}` and for a focused thread `mentioned_comment.comment_id(<id>){text,username,timestamp,like_count,replies{…}}`. **Unverified** whether `replies` is expanded on `mentioned_comment` for non-owned media; fallback is to fetch the parent via `mentioned_comment.comment_id(<parent_id>)`.
- Reddit: from the `.json` listing, top-level sorted by score; a focused thread is walked fully. Atom fallback (when `.json` is 403): flat, feed order, no scores.
- YouTube: `yt-dlp --write-comments` with `max_comments` from budget.

Focus rules: `focus=thread:<id>` ⇒ the thread is one `thread` extraction marked primary and
the rest is a `comments` sample; `focus=comments` ⇒ larger comment budget (×2) and the brief
instructs the brain to treat the discussion as the main object; `focus=whole` ⇒ default.

## Failure modes surfaced in chat
`download_failed` (with the yt-dlp message and a hint to enable cookies), `private_or_removed`,
`too_long`, `no_speech`, `worker_crashed` (auto-retried once), `vision_budget_exhausted`.
