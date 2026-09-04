# 0026 — Remote media worker over the tailnet

## Status
accepted

## Date
2026-09-04

## Context
The media stage (yt-dlp, ffmpeg, Whisper, OCR) is the only CPU-heavy part of a run. On the
laptop that also hosts the server it competes with the owner's work, drains the battery on the
go, and a fan-spinning transcription is the main reason to want the server somewhere else. Many
self-hosters have a second machine on the tailnet (a Mac mini, a Linux box with a GPU) that is
better at exactly this and worse at everything else (no browser session for cookies, no
`~/Doubletake` vault). ADR 0001 and ADR 0017 reserved `DOUBLETAKE_WORKER_URL` for "a worker on
another machine later without changing the protocol"; this ADR spends that reservation.

Two facts shape the design. The server, not the worker, reads frame files to call the brain's
vision (`cloud` vision, ADR 0017), and every stored asset path is relative to the server's data
dir. So a remote worker's output has to end up on the server's disk, or the two machines have
to share one filesystem at one path.

## Decision
- **Same protocol, second transport.** `doubletake-media serve --bind <tailnet-ip> --port 7392`
  runs the existing line server behind a small HTTP front: `GET /ping`, `POST /extract`
  (request body = the stdio request object; response = the progress and result lines as
  `application/x-ndjson`), `GET /files?path=…` (bytes of one file under the worker's data dir).
  One extraction at a time, as on stdio. No new ops, no new fields on the request; the result
  line gains one field, `out_dir`, so the server knows where the worker wrote.
- **Bearer token, refuse to listen open without one.** The worker reads
  `DOUBLETAKE_WORKER_TOKEN` and requires `Authorization: Bearer` on every route; binding to
  anything but loopback without a token exits with an error. Transport privacy comes from the
  tailnet (WireGuard); the token stops other tailnet devices from using the worker or reading
  its files.
- **Server side: `RemoteMediaClient`** implements the same `MediaClient` seam as the stdio
  client and is chosen when `DOUBLETAKE_WORKER_URL` is set. It keeps the queue's semantics:
  serialised requests, progress callbacks, the mode's media wall clock as a timeout, abort,
  `MediaWorkerError` codes (`unauthorized`, `timeout`, `worker_unavailable`, `worker_crashed`
  retryable as before). After a successful result it **mirrors** every asset and vision frame
  from the worker into `<dataDir>/media/<item_id>/` via `/files` and rewrites the paths, so
  `runMediaStage`, cloud vision, the export and the UI keep reading local files unchanged. Paths
  outside the worker's `out_dir` are refused. The worker's copy stays there (its own disk, its
  own cleanup).
- **Shared filesystem is the fast path, not the requirement.** With
  `DOUBLETAKE_WORKER_SHARED_PATHS=on` on the server and `--shared-paths` on the worker, the
  worker writes into the server's `out_dir` as sent and nothing is copied. This is for a
  network volume or a synced folder mounted at the same absolute path on both machines; it is
  the owner's job to make that true.
- **Nothing else moves.** The database, the brain, the queue, push, exports and the vault stay
  on the server. Vision stays where ADR 0017 put it (`cloud` on the server through the brain;
  `local` inside the worker, which is now the remote machine, so a GPU box can do local vision
  for a laptop server).

## Alternatives considered
- **A second server instance sharing the SQLite file.** SQLite over a network filesystem is
  unsafe, and two queues would fight over runs. Rejected.
- **Streaming frame bytes inline in the result.** Simpler wire shape, but base64 in JSON lines
  balloons multi-hundred-MB videos and the stdio path would carry it too. A separate file
  route keeps the result small and lets `--shared-paths` skip transfer entirely.
- **WebSocket or gRPC transport.** No benefit over chunked NDJSON for a one-request-at-a-time
  worker, and the Python side would need a dependency; `http.server` has none.
- **Server pushes the source URL and the worker uploads to the server.** Inverts the trust
  direction (the worker would need a device token with write access to the server) and needs a
  new upload route. The server pulling from the worker keeps the worker credential-free.
- **mTLS instead of a bearer token.** Tailscale already authenticates the machines; a token is
  enough to separate "on the tailnet" from "allowed to use the worker" and is one env var.

## Consequences
- New: `workers/media/src/doubletake_media/serve.py`, `apps/server/src/media/remote-client.ts`,
  env `DOUBLETAKE_WORKER_URL`, `DOUBLETAKE_WORKER_TOKEN`, `DOUBLETAKE_WORKER_SHARED_PATHS`.
  The stdio client and the fake worker in tests are untouched.
- A remote run costs one extra copy of the assets over the tailnet (seconds on a LAN; the
  media wall clock covers it). Frames for cloud vision are still read by the server, so a
  remote worker does not change which machine holds the brain credentials.
- `logs/worker.log` on the server is empty for a remote worker; its stderr is on the worker
  machine. Boot log says `media: remote http://…`.
- The worker exposes file reads under its data dir to any holder of the token. Keep the token
  out of the repo like every other secret (`.env` only), and bind to the tailnet IP, never
  `0.0.0.0` on a machine with a public interface.
- Verified 2026-09-04 with the real worker in `serve` mode and the real client on one machine
  (a YouTube extraction streamed progress and mirrored three files). **Unverified** across two
  physical tailnet machines; the first such run removes this line.
