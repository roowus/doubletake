# 0015 — Platform extractor registry in the server

- Status: accepted
- Date: 2026-09-03

## Context
The owner shares links from Instagram, TikTok, YouTube (including Shorts), X/Twitter, Reddit,
AI-chat share pages and arbitrary web pages, and asked that further platforms be "easy to add
on". ADR 0001 put download/transcription/OCR in a Python worker (M3). M1 needed text from those
links before the worker exists, and even with the worker the server must recognise the URL
first to canonicalise it (dedupe), label the platform, and decide what to ask the worker for.

## Decision
A **platform extractor registry** in `apps/server/src/extract/`:

- `PlatformExtractor { platform, match(url), canonicalize(url), extract(url, ctx) }` — one file
  per platform under `platforms/`, registered in an ordered list in `registry.ts`; first
  `match` wins; `web` is the mandatory last fallback.
- `extract` is text-only and network-limited to `ctx.fetchText`, which carries the SSRF guard
  and size caps from ADR 0005. It returns labelled untrusted blocks, rows for the `extractions`
  table, and human-readable warnings that are shown in the chat. It must not throw on partial
  failure.
- The `Platform` enum in `packages/shared` is the single list of ids; adding a platform =
  new file + enum value + registry line + doc row ([how-to](../MEDIA-PIPELINE.md#adding-a-platform)).
- The media worker (M3) is layered *after* this step and keyed by the same `platform` id, so
  download recipes live next to the extractor's row in the pipeline doc.
- Canonicalisation strips tracking parameters (`utm_*`, `igsh`, `si`, `fbclid`, X's `s`/`t`)
  and unifies mirror/short hosts (`vm.tiktok.com`, `youtu.be`, `fxtwitter.com`, `redd.it`).

## Alternatives considered
- **Put URL recognition in the Python worker only.** Loses canonical URLs at ingest time
  (dedupe, dedupe-on-reshare) and makes M1 depend on M3.
- **One big `switch` on hostname.** Works for three platforms, not for a community adding a
  tenth; per-file extractors keep tests and ownership local.
- **Third-party unfurl service.** Sends every URL the owner looks at to someone else; against
  the self-hosting promise.

## Consequences
- Platform support has a fixed, documented recipe and a table in `MEDIA-PIPELINE.md` that must
  be updated in the same commit as a new extractor (CLAUDE.md rule).
- Text-only extraction is honest about its limits: Instagram behind a login wall yields only
  Open Graph metadata and a warning until M3 adds media; the UI shows the warning.
- The worker protocol (ADR 0001) gains a `platform` field and may consult extractor hints
  (media ids, short flag) instead of re-parsing URLs.
