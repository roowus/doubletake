# 0029 — Photos and videos shared as files: raw upload route and in-place extraction

## Status
accepted

## Date
2026-09-06

## Context
Every share so far carried a URL or text. The Android intent filter already accepted
`image/*` and `video/*` and the iOS activation rule accepted media, but both sheets said the
file would not be uploaded "until M3". M3's media worker has been live since 2026-09-03, so a
screenshot of a menu, a photo of a poster or a camera-roll video had no way into the pipeline
although the pipeline (OCR, frames, transcription, descriptions) is exactly what they need.
The extraction path assumed a URL: the worker's `/extract` took `url` and downloaded it; the
remote worker ([ADR 0026](0026-remote-media-worker.md)) mirrored results back but had no way
to receive a file from the server.

## Decision
- **Route.** `POST /api/ingest/upload` takes the file as the raw request body with its
  `Content-Type` (`image/*` or `video/*`, allow-listed subtypes: JPEG, PNG, WebP, GIF,
  HEIC/HEIF, MP4, QuickTime, WebM, 3GPP, Matroska) and the metadata in URI-encoded headers
  `x-doubletake-note`, `x-doubletake-channel`, `x-doubletake-mode`, `x-doubletake-client-id`.
  No multipart: the sheets stream one file and headers keep the parser trivial. Non-media
  types get `415` (no body parser is registered), media types outside the list `400`, and a
  body over 500 MiB `413` with the partial file removed; the cap is enforced while streaming
  because the raw parser bypasses Fastify's `bodyLimit`. The body is written to
  `<dataDir>/media/<item_id>/image.<ext>` or `source.<ext>` through a `.part` file with a
  sha256, then the item is created with the pre-minted id.
- **Model.** An upload is a `text`-platform item with no URL, titled from the note, plus a
  `media_assets` row with `source: upload`. That row is what tells the queue worker to run the
  media stage without a URL, and it is preserved when the stage deletes and re-creates the
  other asset rows, so re-extraction never loses the original. The reply is the same `202`
  shape as `POST /api/ingest`, and a repeated `clientId` drains the body and replays the first
  ingest ([offline queue](../channels/android-share.md#share-sheet)).
- **Worker.** The extract request carries `hints.local_path` and an empty `url`. The Python
  worker validates the path (absolute, inside the run directory, a regular file), probes it
  with ffmpeg and continues as if it had just downloaded it. For a remote worker the server
  first pushes the file with `PUT /files?path=media/<item_id>/<file>` (bearer token, three-part
  path, no `.`/`..`, non-empty, size-capped) and the worker rewrites `local_path` into its own
  data dir; a shared filesystem skips the push.
- **Clients.** The Android sheet resolves `EXTRA_STREAM`, asks the content resolver for the
  real MIME type, shows "Shared photo" / "Shared video", and streams the URI to the route. When
  the server is unreachable the file is copied into app-private storage before the record is
  queued, because the content-URI grant ends with the sheet. Several files send only the first,
  with a visible note. The chat renders the photo, or a sampled frame of the video, as the
  share card in place of the link preview. The iOS extension copies the provider's file into
  its temporary directory, uploads it with `URLSession.uploadTask(fromFile:)` and the same
  headers, and falls back to a text share of the note (with a warning) for types the server
  rejects; simulator-verified, **unverified** on a device.

## Alternatives considered
- **Multipart form upload**: the conventional shape, but it needs a multipart parser on the
  server and a multipart writer in Kotlin and Swift for a single file; the raw body with
  headers is smaller on every side and streams without buffering.
- **Base64 JSON through `POST /api/ingest`**: reuses one route but multiplies memory by the
  file size on both ends and breaks the 500 MiB cap; rejected.
- **Upload from the WebView after opening the app**: would force the app to launch on every
  photo share, which the translucent sheet exists to avoid ([ADR 0007](0007-capacitor-and-custom-share-activity.md)).
- **Web share target with `POST` + `files`**: worth adding for the installed PWA later; not
  needed for the native sheets and left out of this change.

## Consequences
- `media_assets.source` gains `upload`; no migration, the column is free text. Blob layout is
  unchanged: uploads live where downloads would.
- The remote worker protocol gains one route (`PUT /files`); servers and workers must be
  updated together, as with every protocol change ([MEDIA-PIPELINE.md](../MEDIA-PIPELINE.md)).
- Uploaded files are owner content, not scraped content, but their OCR, transcripts and
  descriptions are still wrapped `<untrusted>`: a photographed poster can carry an injected
  instruction as easily as a caption ([ADR 0005](0005-untrusted-content-and-file-policy.md)).
- Covered by server tests (route, replay, worker stage), remote-client tests (`PUT /files`
  ordering, shared-path skip) and worker tests (path validation, `PUT` handler); the Android
  path compiles and is pending live device verification.
