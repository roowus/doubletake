# workers/media

Python media worker for Doubletake. Spawned by the server as a long-lived child process
speaking JSON-lines over stdio (protocol and stages in `docs/MEDIA-PIPELINE.md`,
[ADR 0017](../../docs/adr/0017-media-worker-process-and-vision-via-brain.md)).

```sh
cd workers/media
uv sync --extra media --extra whisper-mlx     # Apple Silicon; use --extra whisper-cpu elsewhere
uv run pytest
echo '{"id":"1","op":"ping"}' | uv run doubletake-media   # → {"id":"1","event":"result","ok":true,"pong":true}
```

Modules: `protocol` (line server), `download` (yt-dlp, captions, YouTube comments, caps),
`ffmpeg` (probe, audio), `transcribe` (mlx-whisper / faster-whisper), `frames` (scene changes),
`ocr` (RapidOCR → tesseract), `vision` (local mlx-vlm opt-in), `extract` (the `extract` op).

Env read by the worker (set by the server): `DOUBLETAKE_VISION`, `DOUBLETAKE_WHISPER_BACKEND`,
`DOUBLETAKE_YTDLP_COOKIES_FROM_BROWSER`. Stderr is the log; stdout is the protocol only.

On another machine ([ADR 0026](../../docs/adr/0026-remote-media-worker.md)):

```sh
DOUBLETAKE_WORKER_TOKEN=… uv run doubletake-media serve --bind $(tailscale ip -4) --port 7392 --data-dir ~/.doubletake-worker
```

serves the same protocol over HTTP (`GET /ping`, `POST /extract` → NDJSON stream, `GET /files?path=`)
behind the bearer token; the server mirrors results into its own data dir. `serve` module: `serve`.
Set `DOUBLETAKE_VISION` / `DOUBLETAKE_WHISPER_BACKEND` in this process's environment yourself
when remote (the server cannot set them for you).
