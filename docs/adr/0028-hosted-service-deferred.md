# 0028 — Hosted bring-your-own-key service: designed, deferred

## Status
accepted (deferral)

## Date
2026-09-04

## Context
The owner wanted a hosted Doubletake alongside self-hosting: sign up with Google, GitHub,
Apple, a magic link or a passkey; connect your own AI credentials (OpenRouter one-click OAuth,
pasted API keys, headless CLIs); attach personal files through connectors (a companion agent on
the user's machine, Google Drive, GitHub, any MCP server URL) instead of local folders; one
store app that talks to the hosted service by default and to a self-hosted server on request.
Core logic would stay in this repository; website, auth-provider configuration and deploy
scripts would live in a private repository. The service would be free.

Research settled the shape and then the cost. The core needs an always-on process for the
queue, WebSockets, ffmpeg, whisper and Deep runs of up to 25 minutes. Vercel Functions stop at
300 s on the free plan with a 4.5 MB body limit; Supabase Edge Functions stop at 150 s wall
clock and 2 s CPU. Fly.io and Railway cost money from the first month. The only $0 always-on
host is Oracle Cloud Always Free, which is hard to obtain and adds a Linux box to operate.
Instagram for other people's accounts needs Meta App Review and Advanced Access. Anthropic does
not allow third-party products to use claude.ai logins, so hosted brains would be API keys only
unless the user runs a companion on their own machine.

## Decision
Stay a single-owner-per-instance product. Self-hosting is the product; no hosted mode, tenant
layer or identity-provider abstraction is added now. The full design, the verified limits and
the milestone plan (H1 accounts and BYOK, H2 connectors and push relay, H3 companion agent, H4
Instagram after App Review) are kept in the private repository `roowus/doubletake-cloud` so
the work can resume without redoing the research. The roadmap carries one line saying so.

## Alternatives considered
- **Ship the hosted service on Oracle Always Free + Vercel Hobby + Supabase Free**: $0 on
  paper, but signup capacity is a lottery, the box must be operated, and the owner chose not to
  take that on now.
- **Fly.io or Railway for the core**: simplest ops, $6–11/month from day one; rejected on cost.
- **Rework the core to fit serverless functions**: drop local transcription for cloud APIs and
  split runs into short jobs; weeks of work that would fork the self-hosted path. Rejected.
- **Per-tenant Postgres on Supabase**: 21 tables and FTS5 to port, and media never fits 500 MB.
  If the service ships, it uses one SQLite database and media directory per tenant instead.

## Consequences
Nothing changes in this repository's behaviour. When the hosted work resumes, the seams to
generalise are known and should stay narrow until then: the `Auth` class in
`apps/server/src/auth/index.ts` (one owner password, device tokens), the process-global env
config in `apps/server/src/config/index.ts` (brain, keys, caps, read roots, notes dir), the
per-instance `SecretBox` keyfile, and the single `ig_accounts` row. The Claude Agent SDK
adapter already accepts a per-config `env`, so per-run key injection needs no change. A push
relay for self-hosters using the store app, and the companion agent, are the two hosted pieces
most likely to be worth building on their own; either would get its own ADR.
