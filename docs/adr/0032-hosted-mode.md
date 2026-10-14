# 0032 — Hosted mode: accounts, tenancy, Postgres behind a mode flag

- Status: accepted
- Date: 2026-10-10
- Supersedes the deferral in [ADR 0028](0028-hosted-service-deferred.md); service design lives
  in the private `roowus/doubletake-cloud` (docs/REVISION-2026-10.md there).

## Context
The hosted service is being built (2026-10 revival). The core was single-owner by design:
one owner password, one SQLite file, process-global config, one `ig_accounts` row. The
service needs many users, sign-in with Google or email, per-user BYOK credentials, and a
database that web, worker and MCP processes share concurrently. Serverless cannot host the
run pipeline (ADR 0028 research), so the target is one always-on box running the core in a
Postgres-backed, multi-tenant mode.

## Decision
Add a hosted mode to this repository, gated by `DOUBLETAKE_HOSTED=1`, additive to the
existing code:

1. **Database**: `apps/server/src/db/schema.pg.ts` + `openPgDb` (drizzle + postgres-js) port
   every table to Postgres. SQLite stays the default and the only mode self-hosters see.
2. **Tenancy**: every tenant table gains `user_id`; every query filters on it, enforced in
   the repository layer (`db/repo.ts`) as its first parameter — one code path, no per-route
   discipline.
3. **Auth**: hosted `Auth` resolves a bearer session token (`sessions` table, hashed, kind
   browser|device|mcp) to a `user_id`. Google OAuth and email+password issue sessions;
   existing device pairing maps to `sessions.kind='device'`. Self-hosted keeps the owner
   password unchanged.
4. **BYOK vault**: new `credentials` table storing only SecretBox-sealed keys; hosted mode
   loads the master key from `DOUBLETAKE_MASTER_KEY_FILE`. Per-user monthly and per-run
   spend caps are enforced in the run loop against `cost_ledger`.
5. **OpenRouter OAuth PKCE** connect as the default credential path; pasted keys second;
   an OpenAI-compatible harness URL as the zero-custody third tier.

## Alternatives considered
- **SQLite per tenant** (ADR 0028's plan): keeps one schema, but sprawls (one file per user),
  breaks cross-user search/ops and global FTS. Rejected in the revival; see
  doubletake-cloud REVISION-2026-10 decision 1.
- **Separate hosted codebase**: forks the brain/queue/extraction logic; every fix lands twice.
  Rejected — the seams ADR 0028 identified (Auth, config, SecretBox, ig_accounts) are narrow
  enough for a flag.
- **Supabase Auth + JWTs** (ADR 0028's plan): drops a vendor; first-party sessions reuse the
  device-token machinery. Rejected in the revival; revision decision 3.

## Consequences
Self-hosted behavior is frozen byte-for-byte behind the flag; every existing test must keep
passing. Postgres full-text search replaces FTS5 only in hosted mode. Hosted deploys publish
nothing new (AGPL already covers the core); deploy glue stays in the private repo. Revisit
the flag boundary if hosted settings grow beyond what `config` can multiplex.

## Addendum (2026-10-11, tenancy + caps implementation)

- **Dialect contract in `Repo`**: method signatures stay synchronous (SQLite callers and all
  existing tests untouched). On the pg dialect, statements fire eagerly and resolve behind a
  documented `lazy()` wrapper — pg callers must `await`. The async sweep of all call sites is
  **done** (2026-10-14): every consumer awaits, hosted runs the whole app on Postgres, and
  `apps/server/test/hosted-pg-await.test.ts` pins it. Two sync-by-contract surfaces remain by
  design: `Repo.transaction(fn)` (better-sqlite3 requires a sync callback) and the legacy
  `ingest()`/`ingestUpload()` shims, which now **throw** on pg and point at
  `ingestAsync()`/`ingestUploadAsync()` instead of silently mangling a Promise.
- **pg FTS stopgap**: hosted search is tenant-scoped `ILIKE` until the tsvector + GIN port
  (TODO in `schema.pg.ts`).
- **`tags.name` stays globally unique on pg** — cross-user tag-name collisions are possible
  at hosted cutover; the fix (per-user tag ids) is part of the cutover pass.
- **Spend caps** are enforced twice: ledger checks (`no_credential` / `cap_reached` /
  `per_run_cap`) and `RunOptions.maxBudgetUsd` clamped to the credential's per-run cap.
  Hosted credential resolution is most-recent-active; an explicit "default credential" flag
  is future work.
- **Registration** behind `DOUBLETAKE_INVITE_CODE` (first user bootstraps without it).
- **Instagram pairing** (2026-10-13): hosted DMs are ingested only from senders paired via a
  single-use code (Settings → Instagram); `ingestForUser()` in the channel replicates DM-share
  ingest per user on the pg dialect. The sweep above also fixed four latent pg bugs the first
  hosted run exposed: `getSetting`/`countOpenTodos`/`bumpPushFailure` derived scalars through
  `this.one(...)?.field` (which yields `undefined`, not a Promise, so nothing could recover
  them — every hosted settings read was empty), `graphData` returned two independently lazy
  arrays, and `pgVals` was missing `manual`/`auto`.
