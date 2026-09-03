# 0002 — SQLite in a single data directory

- Status: accepted
- Date: 2026-09-03

## Context
One owner, one laptop, tens of items per day at most, but rich text (transcripts, OCR, answers)
that must be searchable and a job queue that must survive restarts. Backup and "move to a new
machine" should be a folder copy.

## Decision
Everything lives under `~/.doubletake` (overridable): `doubletake.db` (SQLite, WAL mode,
drizzle migrations, FTS5 virtual table maintained by triggers), `media/<item_id>/`, `logs/`,
`exports/`, and `keyfile`. The queue is a table with row-level status, not a separate broker.

## Alternatives considered
- Postgres: better concurrency that a single owner never needs; another service to run.
- Files-only (Markdown + JSON): fine for export, useless for the queue, chat state, and search.
- Redis/BullMQ for the queue: an extra daemon for a workload of a few jobs per hour.

## Consequences
Concurrency is one writer; the queue worker runs runs sequentially by default (configurable
parallelism later, still one process). Large blobs stay on disk with paths in the DB.
