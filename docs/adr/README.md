# Architecture decision records

One file per decision, numbered, never deleted. Superseding a decision means a new ADR whose
"Status" says which one it replaces, and the old one gets `Status: superseded by NNNN`.

| # | Title | Status |
|---|---|---|
| [0001](0001-monorepo-ts-server-python-worker.md) | pnpm monorepo, TypeScript server, Python media worker | accepted |
| [0002](0002-sqlite-single-data-dir.md) | SQLite in a single data directory | accepted |
| [0003](0003-brain-adapter-interface.md) | Pluggable brain adapter interface | accepted |
| [0004](0004-research-modes.md) | Quick / Standard / Deep research modes | accepted |
| [0005](0005-untrusted-content-and-file-policy.md) | Untrusted content isolation and file access policy | accepted |
| [0006](0006-instagram-official-api-and-mention-semantics.md) | Instagram via official API; comment-mention semantics | accepted |
| [0007](0007-capacitor-and-custom-share-activity.md) | One PWA; Capacitor Android with a custom share activity | accepted |
| [0008](0008-notifications.md) | Web Push + FCM + IG reaction; notifier interface | accepted |
| [0009](0009-networking.md) | Loopback bind; Tailscale by default; tunnel for the webhook only | accepted |
| [0010](0010-auth-owner-password-device-tokens.md) | Owner password and per-device tokens | accepted |
| [0011](0011-markdown-export-fts-tags.md) | Markdown export, FTS5, auto tags | accepted |
| [0012](0012-cost-cap.md) | Daily spend cap and per-run budgets | accepted |
| [0013](0013-agpl-public.md) | AGPL-3.0, public from day one | accepted |
| [0014](0014-structured-extraction-and-categories.md) | Structured extraction, categories, auto-collections | accepted |
| [0015](0015-platform-extractor-registry.md) | Platform extractor registry in the server (IG, TikTok, YouTube/Shorts, X, Reddit, AI chat, web) | accepted |
| [0016](0016-push-keys-and-fcm-http-v1.md) | VAPID keys generated into settings; FCM over HTTP v1 without the Google SDK; subscription pruning | accepted |

## Template

```markdown
# NNNN — Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context
What situation forced a decision. Facts, constraints, what was researched.

## Decision
One paragraph, imperative.

## Alternatives considered
Bullet per alternative with the reason it lost.

## Consequences
What becomes easier, what becomes harder, what must be revisited and when.
```
