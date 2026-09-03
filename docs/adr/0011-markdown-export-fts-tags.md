# 0011 — Markdown export, FTS5, auto tags

- Status: accepted, extended by [0014](0014-structured-extraction-and-categories.md)
- Date: 2026-09-03

## Context
Answers are only useful if they can be found again and reused in the owner's own notes.
Competitors mostly archive without making the content useful downstream.

## Decision
Export every finished chat to `~/Doubletake/<yyyy>/<yyyy-mm-dd> <slug>.md` with frontmatter
(url, platform, tags, mode, cost, item id), Obsidian-compatible. Index title, note,
transcript, OCR, and answers in an FTS5 table. The brain returns `tags[]`; collections are
saved tag queries; manual tags are allowed.

## Alternatives considered
- Export-only, no DB search: the app needs search too, and FTS5 is free with SQLite.
- Vector search: adds a model dependency for a corpus of hundreds of items; revisit if the
  library grows.

## Consequences
Export files are regenerated on edit (idempotent by item id in frontmatter). The notes dir is
also the brain's write sandbox, so exports and brain-written artifacts share a folder.
