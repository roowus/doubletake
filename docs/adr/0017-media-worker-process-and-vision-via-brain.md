# 0017 — Media worker as a spawned Python child; frame descriptions via the brain

- Status: accepted
- Date: 2026-09-03

## Context
ADR 0001 split the system into a TypeScript server and a Python media worker because the media
tooling (yt-dlp, ffmpeg bindings, Whisper, OCR runtimes) lives in Python. M3 had to decide how
the two processes talk, who owns retries and failure, which Whisper/OCR/vision backends run
where, and how extractions stay isolated from the brain's instructions.

## Decision
- **Process model**: the server spawns `uv run --frozen doubletake-media` (configurable via
  `DOUBLETAKE_MEDIA_WORKER_CMD` / `_CWD`) lazily on first use and keeps it alive. One request at
  a time (a promise chain in `MediaWorkerClient`); the worker is CPU-bound and a queue of
  parallel Whisper runs would only thrash.
- **Protocol**: JSON-lines over stdio, request `{id, op, …}`, zero or more `progress` events
  and exactly one `result` per id. Ops in v1: `ping`, `version`, `extract`, `shutdown`. The
  worker's stderr goes to `<dataDir>/logs/worker.log`.
- **Failure ownership**: the worker never partially answers. Tool/download problems are error
  results with a stable `code` (`download_failed`, `private_or_removed`, `too_long`,
  `no_speech`, `tool_missing`, `bad_request`, `worker_error`) and a `retryable` flag. A process
  exit fails every in-flight request with `worker_crashed`; the client respawns on the next
  request and retries an `extract` **once**. Each request has a per-mode media wall clock
  (`MODE_BUDGETS[mode].mediaWallClockMs`) separate from the research clock; expiry kills the
  process and fails the request with `timeout`. The run's hard ceiling is research wall clock +
  media wall clock + 60 s. A failed media stage is
  reported to the chat as a warning and the research run continues on page-level extraction.
- **Vision through the brain**: the worker returns `vision_requests` (frame paths); the server
  fulfils them with `BrainAdapter.describeImages()` when `DOUBLETAKE_VISION=cloud` (default).
  The Claude Agent SDK adapter implements it as a single tool-less turn with base64 image blocks
  and asks for a JSON array of descriptions. `DOUBLETAKE_VISION=local` runs `mlx-vlm` inside the
  worker instead; `off` skips descriptions.
- **On-device audio and OCR**: `mlx-whisper` on Apple Silicon (small for Quick, large-v3-turbo
  otherwise), `faster-whisper` elsewhere, `off` to skip. RapidOCR (ONNX) first, `tesseract`
  binary as fallback. Audio and frames never leave the machine unless vision is `cloud`, and
  then only the sampled frames do.
- **Isolation**: every extraction the worker produces becomes an `<untrusted source=… kind=…>`
  block in the brief (ADR 0005). Comment threads and transcripts are the most likely carriers
  of injected instructions, so the fixture test ships a transcript containing one and asserts
  it lands only inside the block and never in the answer.

## Alternatives considered
- HTTP or gRPC between server and worker: needs a port, auth, and a supervisor; stdio gives
  us process ownership for free and `DOUBLETAKE_WORKER_URL` remains possible later.
- Node-native pipeline (ffmpeg via child process, whisper.cpp bindings, Tesseract.js): slower
  Whisper, weaker OCR, and yt-dlp still needs Python.
- Vision inside the worker only (local VLM): 3B-parameter models describe reels poorly next
  to the configured frontier brain, and every self-hoster would download a multi-GB model.
- Parallel requests to the worker: rejected for now; a second worker process is the scaling
  knob if it is ever needed.

## Consequences
- `uv` is a hard requirement for media; without it the server boots with `media: off` and
  answers from page-level extraction only.
- Cost of frame descriptions is charged to the run's brain and recorded on the
  `frame_description` extraction.
- Long Deep runs can hold the single worker slot for minutes; per-mode budgets (frames,
  comments, 15/60-minute duration caps) bound that.
- The protocol is versioned only by `version`; adding an op is additive, changing `extract`'s
  result shape needs a bump on both sides in the same commit.
