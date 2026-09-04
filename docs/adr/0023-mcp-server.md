# 0023 — MCP server exposing the library to other agents

- Status: accepted
- Date: 2026-09-04

## Context
Everything Doubletake learns is already exported as Markdown ([ADR 0011](0011-markdown-export-fts-tags.md)),
so Obsidian and grep can read it. Agents cannot, or not well: a coding assistant asked "what
was that CLI tool from the reel I saved last week" has to shell out and guess at file names, and
it gets none of the structure (claims, verdicts, entities, collections) that the app itself
shows. The Model Context Protocol is now the common way to hand an agent a set of tools, and
the server already speaks it on the other side of the fence: the Claude Agent SDK adapter
exposes `web_search`/`read_file`/… to the brain over an in-process MCP server
([BRAIN-ADAPTERS.md](../BRAIN-ADAPTERS.md)). The question is how to expose the *library* to
*outside* agents (Claude Code, Claude Desktop, Cursor, Hermes, anything with an MCP client)
without opening a second door.

## Decision
One **Streamable HTTP** MCP endpoint at `/mcp` on the existing Fastify server, behind the
existing device-token gate (`Authorization: Bearer dt_…`, [ADR 0010](0010-auth-owner-password-device-tokens.md)).
An agent is a device: pair it (or reuse the laptop's token), revoke it from Settings → Devices.
No new listener, no new secret, and `hostAllowed` keeps it off the public tunnel hostname like
every other route.

- **Stateless.** Each POST builds a fresh `McpServer` and transport (`sessionIdGenerator`
  unset, JSON responses). No session table, nothing to leak between clients, any number of
  agents can share a token. `GET` and `DELETE` answer `405`: there is no server-initiated
  stream and no session to end. Long-running work is not streamed; `get_chat` accepts
  `wait_seconds` (≤120) and clients poll beyond that.
- **Tools mirror the REST API**, rendered as Markdown for a model rather than JSON for a UI:
  `search_library` (FTS), `list_chats` (collection/tag filters), `get_chat` (answer, claims
  with verdict and sources, entities, follow-ups, optionally the raw extractions),
  `list_collections`, `list_tags`, `list_entities`. Two write tools only enqueue work through
  the normal ingest path: `save` (channel `mcp`) and `ask_library` (channel `library`,
  [ADR 0021](0021-cross-library-chat.md)). Nothing edits, deletes or changes settings. Each
  tool carries MCP annotations (`readOnlyHint`, `destructiveHint: false`) so clients can decide
  how much to ask the user.
- **Untrusted stays labelled.** Extractions leave the server inside the same
  `<untrusted source= kind=>` wrapper and preamble the brain receives
  ([ADR 0005](0005-untrusted-content-and-file-policy.md)); the answer section is headed
  "written by the Doubletake brain from the content below" so the calling agent can tell our
  synthesis from scraped text. Extractions are off by default (`include_extractions`) because
  they are long and because the answer usually suffices.
- **No file, shell or network tools.** The library is the only thing exposed. The brain-side
  tools stay in-process and unreachable from `/mcp`.

## Alternatives considered
- **stdio MCP server as a separate binary** (`doubletake mcp`): the usual shape for local
  agents, but it would need its own database handle next to the running server (SQLite WAL
  makes it possible, not pleasant), could not enqueue runs without a REST round-trip anyway,
  and would not serve agents on other tailnet machines. HTTP with a token serves both.
- **Stateful sessions with SSE streaming** (`sessionIdGenerator: randomUUID`): would allow
  progress notifications while a run executes. Adds an in-memory session map, per-session
  cleanup and the 409/404 dance for reconnects, for a benefit `wait_seconds` mostly covers.
  Can be added later without changing the tool set.
- **Reading `~/Doubletake/*.md` with a generic filesystem MCP server**: works today with zero
  code, but loses claims, entities, collections and the untrusted labelling, and cannot save
  or ask. Still fine for people who only want grep.
- **Exposing every REST route as a tool**: pushes the agent into managing device pairing, push
  subscriptions and Instagram; none of that is what an agent needs from a library.

## Consequences
`@modelcontextprotocol/sdk` becomes a direct dependency of `apps/server` (it was already
present through the Agent SDK). One more channel value, `mcp`, in the item schema and the chat
list icon. `docs/DEPLOYMENT.md` gains the connection recipe for Claude Code, Claude Desktop and
generic clients. A token pasted into an agent's config is a token in a config file; the
threat model gains T13 and Settings → Devices is the place to name and revoke it.
