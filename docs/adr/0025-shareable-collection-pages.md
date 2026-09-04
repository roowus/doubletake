# 0025 — Shareable read-only collection pages

## Status
accepted

## Date
2026-09-04

## Context
SaveToList's one social feature is a shared list: a link that shows friends what you collected.
Doubletake's answers are worth passing on too ("here are the five ski tips that checked out"),
but the instance is single-owner and every route needs a device token. Pairing a friend's
device to read one list is out of proportion, and so is copying answers into a message by hand.

The page has to leave the tailnet only when the owner wants it to, must carry none of the
owner's private context (notes, extractions, cost, the rest of the library) and must not become
a script-injection surface: answers are brain-written Markdown built from untrusted content.

## Decision
- A manual list or saved search gains an optional `share_token` (random 18 bytes, base64url,
  unique index). `POST /api/collections/:id/share` mints it once and returns the link;
  calling it again returns the same link; `DELETE …/share` revokes it. Auto collections cannot
  be shared (their names are the owner's categories, and hiding is the only lifecycle they have).
- `GET /s/<token>` is the only unauthenticated read route. The token in the path is the whole
  credential. Unknown token, revoked token or a hidden collection all answer `404`.
- The page is one self-contained HTML document with no script: collection name, then per item
  the title linking to the original URL, platform, saved date, tags and the first brain answer
  rendered from a deliberately small Markdown subset (headings, bullets, paragraphs, bold,
  code, `http(s)` links only) after escaping everything. Never included: the owner's note, any
  extraction text, follow-up turns, costs, chat ids. Headers: `Cache-Control: no-store`,
  `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.
- Reach: by default the link uses `DOUBLETAKE_PUBLIC_URL`, so it works for people on the
  tailnet only. `DOUBLETAKE_SHARE_PUBLIC=on` opts `/s/` pages onto the public tunnel hostname
  (`DOUBLETAKE_WEBHOOK_PUBLIC_HOST`); `hostAllowed` then admits that prefix beside the webhook
  and the returned link uses the public host. The tunnel's own path filter must be widened to
  `^/s/` as well (Deployment guide).
- The PWA shows a **share / unshare** chip for the selected non-auto collection, copies the link
  to the clipboard, shows it under the row and marks shared collections with 🔗.
  The service worker never handles `/s/`.

## Alternatives considered
- Token in a query string: leaks into referrers and logs more readily than a path segment and
  is easier to strip by accident when pasting. Path it is.
- Requiring a login or a pairing for readers: kills the point (send a link in a chat).
- Per-item share links: a collection of one covers it, and one lifecycle is enough to reason
  about.
- Public by default: no. Exposure beyond the tailnet is one explicit switch plus a tunnel rule.
- Rendering with the PWA (React) behind a token: would ship the whole client bundle to a
  stranger and reintroduce script on a page that only needs text.

## Consequences
Anyone with the link reads the page until it is revoked; there is no view count and no
expiry, so the UI says "read-only link" and revoke is one tap. Answers may contain untrusted
text from the original post; escaping plus the CSP means it can only ever be text and links.
The Markdown subset drops tables and images on purpose; if a richer page is wanted later it
should still be built server-side without script. Migration `0007_collection_share.sql`.
