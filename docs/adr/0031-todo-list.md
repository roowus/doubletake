# 0031 — A saved list ("To do") filled from answers

## Status
accepted

## Date
2026-09-07

## Context
Doubletake answers a question about a shared thing and extracts typed entities from it
(places, recipes, products, tools, tips, …), but the answer is where the story ended. The
owner asked for the obvious next step: after reading an answer, pick out the parts they want
to *act on* later ("a place I want to go to", "a program I want to install and try out") and
keep them somewhere that is not the inbox and not a collection. Collections group chats; tags
label chats; neither holds "the third restaurant in this answer" or "install ripgrep", and
neither can be ticked off.

Constraints that shaped the design:

- Entities are replaced on every re-run of a chat ([DATA-MODEL](../DATA-MODEL.md) `entities`),
  so anything that pointed at an entity row would dangle after the owner presses
  "Research again".
- The answer page's structured block already carries `recommendations[]`, which are exactly
  the sentences a person would copy into a task list.
- The app is single-owner and self-hosted; there is no sharing, assignment or sync problem to
  solve. The list must work on the phone first (bottom tabs, one-thumb tick).
- Other agents read the library over MCP ([ADR 0023](0023-mcp-server.md)); the list should be
  readable there too, so an assistant can answer "what did I mean to try out?".

## Decision
Add a **todo**: one entry on the owner's saved list. It is the tenth domain noun and the
user's own word; `favourite` and `pin` are not synonyms to introduce.

- **Storage**: a `todos` table (migration `0010_todos`) with `kind` (an entity kind or
  `task`), `title`, `url`, `note`, `attributes` (copied from the entity at save time),
  `chat_id` (`ON DELETE SET NULL`), `done_at`, `created_at`. Entries are **snapshots** of the
  thing, never references to `entities` rows, so a re-run or a deleted chat leaves the list
  intact; the chat link is a convenience, not an identity.
- **API**: `GET /api/todos?done=open|done|all` (newest first, with the source chat's title
  joined in), `POST /api/todos` (zod `TodoCreate`; 404 when `chatId` is unknown),
  `POST /api/todos/:id { done?, title?, note? }`, `DELETE /api/todos/:id`. Writes emit
  `chat_updated` for the linked chat so open pages refresh over the live socket.
- **Where it is filled**: on the answer page. Every row in the **Things** tab and every
  recommendation carries a bookmark button ("Save … to your list"); the header menu gains
  **Add a task…**, a sheet with a title and an optional note, linked to the chat. Saving
  shows a toast, nothing navigates away: the reader stays in the answer.
- **Where it lives**: a **To do** row at the top of the Library tab (open count, first titles
  as a hint) opening `/todo`: tick button, kind glyph, title linking out when the thing has a
  URL, note in the prose face, the attributes that matter for the kind, link back to the source
  chat, Maps link for places, remove behind Confirm; done entries fold into a **Done**
  section; a **Task** button adds a free-text task from the list itself.
- **MCP**: one read-only tool, `list_todos { done }`, rendering the list as GFM task lines.
  No write tool: agents feed the library through `save` and `ask_library`, and what the owner
  intends to do stays the owner's decision.

## Alternatives considered
- **A "todo" collection or tag on the chat.** Rejected: the unit is a thing inside an answer,
  not the chat, and a chat about five restaurants produces five separate intentions.
- **Reference `entities.id`.** Rejected: rows are replaced on every re-run; the list would
  empty itself exactly when the owner digs deeper.
- **Export to an external task app (Reminders, Todoist, Memos).** Deferred: the Memos and
  Karakeep exports exist for the library ([ADR 0024](0024-karakeep-memos-interchange.md)); a per-todo
  export can be added the same way once the list has been lived with. Building on an external
  app first would have made the feature depend on one.
- **A fifth tab.** Rejected: four tabs is the ceiling the design system set
  ([ADR 0030](0030-field-notebook-ui-and-rich-answer-blocks.md)); the list is a Library
  artefact and sits there with a distinct accent rule so it reads as one thing, not a tile.
- **Due dates, priorities, projects.** Rejected for v1: nothing in the source (an answer)
  supplies them, and the owner's request was a list to keep and tick.

## Consequences
- Easier: an answer has a "so what" that survives the answer. Agents over MCP can read the
  owner's intentions. The list is a plain table, so exports and reminders can follow.
- Harder: the snapshot can go stale (a price, an address) while the chat has newer entities;
  the link back to the chat is the remedy, not a sync. Kinds are duplicated between
  `EntityKind` and `TodoKind` (`+ 'task'`) on purpose, so a new entity kind needs no migration.
- Revisit when: the owner wants reminders (push channel exists, quiet hours apply), an export
  target, or ordering beyond newest first.
