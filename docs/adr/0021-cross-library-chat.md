# 0021 — Cross-library chat: ask a question over everything you saved

- Status: accepted (extends 0011)
- Date: 2026-09-04

## Context
Every chat is about one shared item. Once a few hundred items are in, the natural question is
not "what does this reel say" but "what did I save about ski wax?" — a Recall-style answer that
gathers several past chats, reconciles them and points back at each. ADR 0011 gives us FTS5
over titles, notes, transcripts, OCR, answers, tags and entities, and the list search already
uses it as a keyword filter. What is missing is a brain turn that reads the matching chats and
answers, with the same isolation rules as any other run.

## Decision
A sixth channel, `library`. `POST /api/library/chat { question, modeHint? }` (and the **Ask
library** button next to the chat-list search field) creates an ordinary item + chat + run
through `ingest()`: platform `text`, no URL detection or dedupe, title from the question, the
question stored as the item note and as the first user message. The queue worker branches on
`item.channel === 'library'` into `researchLibrary()` (`apps/server/src/queue/worker.ts`):

- **Retrieval** (`apps/server/src/library/ask.ts`): `libraryQuery()` drops question filler
  (stopwords such as *what, did, I, save, about*) and joins the remaining prefix terms with
  `OR`, ranked by bm25 — the list search's AND query would return nothing for a natural
  question. Up to 8 chats, other library chats and the asking item excluded. Each hit is
  rendered as note, source, tags, entities, latest answer and extracted-text snippets, clipped
  per hit (3 000 chars) and in total (16 000 chars).
- **Untrusted, still.** Past answers were produced from scraped content, so every hit reaches
  the brain as an `UntrustedBlock { source: 'library', kind: 'page_text', label: '<title>
  (/chat/<id>)' }` under the usual preamble; `localContextHints` lists the consulted chats.
  `ResearchBrief.kind = 'library'` makes `renderBrief()` emit a "question about the library"
  frame and the `LIBRARY_TEMPLATE` output template (direct answer, then one line per supporting
  item as a Markdown link to `/chat/<id>`, contradictions called out, web research only when
  the library has nothing and a web tool exists, and then labelled as such).
- **Stored as an extraction.** The retrieved context is saved as `extractions` rows with
  `kind='page_text'`, `tool='library-fts'`, so the Sources panel shows what the brain read and
  follow-ups reuse it through the existing stored-blocks path.
- **Mode.** No classifier call: forced chip, else the note keyword rules, else Quick. Question
  type is `other`. Run events add `status { phase: 'retrieving' }` and
  `{ phase: 'retrieved', hits, chats }`.

Library chats appear in the list with a 💬 icon (`ChatSummary.channel`).

## Alternatives considered
- Embeddings + vector index: better recall for paraphrases, but a new dependency, a model to
  run locally or pay for, and a second index to keep in sync. FTS with stopword-stripped OR
  terms answers the questions the owner actually asks (they name the thing they saved); revisit
  if recall proves poor.
- Letting the brain call FTS as a tool and iterate: more turns, more cost, and every adapter
  would need the tool; a single retrieval step keeps Quick runs cheap and adapter-agnostic.
- Trusting past answers (rendering them as plain context): they are derived from untrusted
  input, so rule 6 applies unchanged.
- A separate `library_questions` table: an item + chat + run reuses the timeline, follow-ups,
  push, export and unread badge for free; the `channel` column already tells them apart.

## Consequences
Library questions are exported to `~/Doubletake` like any chat and are themselves indexed, but
never retrieved for later library questions (no echo chamber). Quality depends on the FTS
corpus: items with thin extractions contribute only title, note and answer. `Channel` enum,
`ChatSummary` DTO and `ResearchBrief` gain fields; adapters that ignore `kind` still work
because `renderBrief()` handles both. Third-party adapters see one more block source
(`library`).
