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

## Stages

### Download
Order of preference per platform:

| platform | 1st | 2nd | 3rd |
|---|---|---|---|
| instagram | signed CDN URL from the DM webhook (`hints.cdn_url`; TTL undocumented, fetch immediately) | `yt-dlp` (pinned ≥ 2026.08.19) anonymous | `yt-dlp --cookies-from-browser <browser>` if `DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER` is set |
| youtube | `yt-dlp` with `--write-subs --write-auto-subs` (skip transcription if captions exist) | | |
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
- Reddit: from the `.json` listing, top-level sorted by score; a focused thread is walked fully.
- YouTube: `yt-dlp --write-comments` with `max_comments` from budget.

Focus rules: `focus=thread:<id>` ⇒ the thread is one `thread` extraction marked primary and
the rest is a `comments` sample; `focus=comments` ⇒ larger comment budget (×2) and the brief
instructs the brain to treat the discussion as the main object; `focus=whole` ⇒ default.

## Failure modes surfaced in chat
`download_failed` (with the yt-dlp message and a hint to enable cookies), `private_or_removed`,
`too_long`, `no_speech`, `worker_crashed` (auto-retried once), `vision_budget_exhausted`.
