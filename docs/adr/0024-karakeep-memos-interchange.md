# 0024 — Karakeep and Memos interchange

- Status: accepted
- Date: 2026-09-04

## Context
Doubletake is not a bookmark manager and does not want to be one ([ARCHITECTURE.md §1](../ARCHITECTURE.md#1-purpose)):
Karakeep already archives links well, Memos already keeps short notes well, and people who
run one of them will keep running it. What they cannot do is move things across the fence.
Someone with two years of Karakeep bookmarks would like the reels and threads among them
researched; someone leaving Doubletake, or simply wanting its answers next to the rest of
their notes, should be able to take the library with them. The Markdown export
([ADR 0011](0011-markdown-export-fts-tags.md)) covers Obsidian and grep but is not a format
either tool imports.

Both tools' interchange shapes were read from source and pinned here so the mapping is
reviewable:

- **Karakeep** exports and re-imports one JSON file
  (`packages/shared/import-export/exporters.ts`, main branch): `{ bookmarks: [{ createdAt
  (unix seconds), title, tags: string[], lists: string[] (list ids), content: { type: "link",
  url } | { type: "text", text } | null, note, archived }], lists?: [{ id, name, type:
  "manual" | "smart", query, … }] }`. Its own importer accepts exactly this file, so the file is
  the interface; no API key is involved.
- **Memos** has no file import. `POST /api/v1/memos` takes `{ content (Markdown), visibility,
  create_time }`, tags are `#tag` tokens inside the Markdown, auth is a Bearer access token.
  The proto is verified; the JSON casing over HTTP and the token flow are **unverified**.

## Decision
Two exports and one import, all on the existing authenticated API, no new tables, no new
channel to the outside world.

- **`GET /api/export/karakeep`** renders the library as a Karakeep export file: link items →
  `{ type: "link", url }` with the canonical URL, text items → `{ type: "text", text }`, our
  tags as its tags, the owner's note with the first answer appended after a rule as its note
  (that is the field Karakeep shows and searches), `createdAt` from the item, manual collections
  as `lists` of type `manual`. Auto collections and library questions are left out: the former
  are queries in our syntax, the latter are not saved things.
- **`GET /api/export/memos`** renders `{ memos: [{ content, visibility: "PRIVATE",
  create_time }] }`, one Markdown memo per item (title, URL or text, note as a quote, first
  answer, `#tags` on the last line). The owner posts them with a script; the server never
  holds a Memos token. Pushing server-side would add a credential and a network target for one
  more setting nobody asked for yet.
- **`POST /api/import/karakeep`** accepts the same file (body limit raised to 32 MiB on this
  route only). Every bookmark with usable content becomes an item + chat with channel
  **`import`**, its original `createdAt`, its tags as manual tags, and a membership in a manual
  collection per referenced manual list (found by name or created; smart lists are skipped).
  Links already in the library are skipped by canonical URL over all time, not the 24-hour
  share window: an import is not a re-share. The note is stored and indexed at once so the
  item is searchable before any run.
- **Imports are free by default.** No run is queued unless the caller passes
  `?research=quick|standard|deep`, in which case one research run per imported item is
  enqueued and the daily cap ([ADR 0012](0012-cost-cap.md)) throttles them like any other
  work. Importing a thousand bookmarks must never be a thousand-dollar surprise.
- Settings gets an **Import and export** card: two download buttons, a file picker, and an
  "after import" selector defaulting to *do nothing (free)*.

## Alternatives considered
- Talking to the Karakeep REST API (`POST /bookmarks`, `PUT /lists/{id}/bookmarks/{id}`)
  instead of writing its file: needs an API key stored on our side and a reachable Karakeep;
  the file works offline and is what Karakeep's own backup path uses. Left for later if
  someone wants a live sync.
- A Memos file the user "imports": Memos has no such thing, so the export mirrors its create
  request body instead.
- Treating an import as a batch of shares through `/api/ingest`: would apply the 24-hour
  dedupe, stamp `createdAt = now`, lose list membership and queue a run each. Every one of
  those is wrong for an import.
- Importing archived bookmarks as a hidden collection: not now; `archived` is read and ignored.

## Consequences
One module (`library/interchange.ts`), three routes, one new `Channel` value shown with a 📥
icon in the chat list, and imported items sitting at status `new` with no run until the owner
asks (Chat's **Research this** works per item; the `?research=` option per import). Round trip
export → import into an empty library → export is byte-equal for titles, tags, content, notes
and dates (list ids differ, list names match), and a test pins that. Memos API details stay
marked unverified until someone posts the file against a live Memos.
