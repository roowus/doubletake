# 0018 — Instagram channel implementation; secrets at rest sealed with the machine keyfile

- Status: accepted
- Date: 2026-09-03
- Amends: [0006](0006-instagram-official-api-and-mention-semantics.md) (mechanics, not
  semantics), [0010](0010-auth-owner-password-device-tokens.md) (secrets-at-rest key)

## Context
ADR 0006 fixed *what* the Instagram channel means (shadow Business account, DM share, comment
@mention ⇒ `focus`, bot silent in comments). M4 had to decide *how* it is wired into the
server: where Graph-API data enters the pipeline, how webhook bodies are authenticated, how
the public tunnel hostname is confined to one route, how mentions are found if Meta's
`mentions` webhook does not fire under Standard Access, and how the 60-day access token is
stored. ADR 0010 said secrets are encrypted "with a key derived from the owner password and a
machine keyfile"; a password-derived key means the server cannot refresh the Instagram token
or send a reaction unattended after a reboot until someone types the password, which defeats
a 24/7 laptop service.

## Decision
- **One channel module** (`apps/server/src/channels/instagram/`): `graph.ts` is the only code
  that talks to `graph.instagram.com` (`IgGraph` interface + `IgGraphClient`; tests use a fake),
  `index.ts` holds `InstagramChannel` (OAuth connect/disconnect, 30-day token refresh, webhook
  handling, mention polling, completion reaction). Routes live in `api/instagram.ts`.
- **Graph data enters as ordinary extractions.** Caption, comments (≤200 sampled, total kept)
  and, for reply mentions, the full thread (`{parent, replies}`) are stored on the item with
  `tool = 'instagram-graph'` before the run starts. The queue worker merges such extractions
  into the research brief as untrusted blocks (kind `thread` labelled `primary thread`). The
  CDN `media_url` / `payload.url` and `media_id` from the payload are handed to the media stage
  through a `mediaHints(item)` hook so yt-dlp is only the fallback. `ingest()` is unchanged.
- **Completion signal through a hook**: the worker calls `onOutcome(item, outcome)`; the channel
  reacts `love` to the originating DM (`ig_events.sender_id` + message id) when the item came
  via `ig_dm` and the run answered. Nothing is ever posted for mentions.
- **Webhook authentication**: a per-route `application/json` parser keeps the raw body so
  `X-Hub-Signature-256` is checked over the exact bytes (constant-time compare). The GET
  handshake compares `hub.verify_token` with `IG_WEBHOOK_VERIFY_TOKEN`. Deliveries are
  acknowledged with 200 before processing; `ig_events.id` (message id, comment id, media id or
  `poll:<media id>`) makes retries and polling idempotent.
- **Public host confinement in code**: when `DOUBLETAKE_WEBHOOK_PUBLIC_HOST` is set, any request
  whose `Host` matches it and whose path is not `/webhooks/instagram` gets `404` from the first
  `onRequest` hook, before auth. Tailscale-side requests are unaffected.
- **Mentions: webhook first, polling second.** Both `changes[]` and the flat `field`/`value`
  payload shapes are accepted for `mentions` and `comments`. Independently, when
  `IG_MENTION_POLLING` is not `off`, the channel polls `GET /<IG_ID>/tags` every 2 minutes and
  feeds new media through the same handler. A comment that does not contain the shadow
  account's handle is ignored.
- **Secrets at rest = machine keyfile only.** `SecretBox` (`apps/server/src/secrets/box.ts`)
  seals with ChaCha20-Poly1305 under a random 32-byte key in `<dataDir>/keyfile` (mode 0600,
  created on first use). Ciphertext format `v1.<nonce>.<ct>.<tag>`. The owner password is no
  longer an input to this key. The Instagram long-lived token is the first secret stored this
  way (`ig_accounts.access_token_enc`).

## Alternatives considered
- Passing Graph data through `ingest()` as new request fields: would leak channel specifics
  into the shared ingest schema and every test; hooks keep the channel removable.
- Data-only Fastify body parsing plus re-serialisation for the HMAC: JSON re-encoding is not
  byte-stable; signatures would fail on whitespace/ordering differences.
- Reverse-proxy path allow-listing only (documented in DEPLOYMENT.md): still recommended, but
  a misconfigured tunnel must not expose the API; the in-process check costs one string compare.
- Password-derived key (ADR 0010 wording): safer if the disk is stolen while FileVault is off,
  but unusable for an unattended service. The keyfile sits beside the database it protects, so
  the residual benefit was small; FileVault is the recommended disk-level answer.
- Replying in the comment thread when done: rejected again (ADR 0006); leaves a public trace.

## Consequences
- Adding a channel = a module with `handle…()` methods that call `ingest()`, optional
  `mediaHints`/`onOutcome` hooks, and routes; nothing else changes.
- Third-party facts still **unverified** against the live API (marked in the guide): whether
  `mentions` fires under Standard Access, whether `/tags` covers comment mentions, the
  `parent_id` field on `mentioned_comment`, the exact DM attachment shapes. The handler
  accepts the documented variants; live testing in M4 acceptance removes the markers.
- `keyfile` is now the root secret of the data directory: back it up with the database and keep
  `~/.doubletake` out of any sync folder. Rotating it means re-connecting Instagram.
- ADR 0010's secrets-at-rest sentence is superseded by this ADR; its authentication parts stand.
