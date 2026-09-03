# 0016 — VAPID keys generated into settings; FCM over HTTP v1 without the Google SDK

- Status: accepted
- Date: 2026-09-03

## Context
ADR 0008 chose Web Push + FCM behind a `Notifier` interface. Implementing it in M2 raised two
practical questions. (1) Web Push needs a VAPID key pair; asking every self-hoster to run a
key generator and paste two env vars is friction the product does not need, and a lost key
silently invalidates every browser subscription. (2) The FCM HTTP v1 API needs an OAuth2 access
token minted from a Firebase service account. The official route is `google-auth-library`
(plus transitive dependencies for a single RS256 JWT), or the whole `firebase-admin` SDK.

## Decision
- **VAPID**: if `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are set they are used. Otherwise the
  server generates a pair on first boot with `web-push` and stores it in the `settings` table
  under `vapid_keys`; the public key is exposed on `GET /api/status` (`push.vapidPublicKey`)
  for the PWA to subscribe with. `VAPID_SUBJECT` defaults to `mailto:doubletake@localhost`.
- **FCM**: implement the service-account flow directly. `FcmNotifier` signs a JWT (RS256 via
  `node:crypto`, scope `firebase.messaging`) against the service account's `token_uri`, caches
  the access token until a minute before expiry, and posts to
  `projects/<id>/messages:send`. No Google SDK dependency. FCM is enabled only when
  `FCM_SERVICE_ACCOUNT_PATH` points at a readable service-account JSON; otherwise the server
  logs "FCM disabled" and runs with Web Push only.
- **Subscription lifecycle** lives in a `NotificationHub`: one `push_subscriptions` row per
  endpoint (upsert by endpoint; a re-subscribe moves the row to the current device and resets
  its failure count), joined to non-revoked devices at send time. A `gone` outcome (HTTP
  404/410 for Web Push; `UNREGISTERED` for FCM) deletes the row immediately; other failures
  increment `failed_count` and the row is dropped at 8 consecutive failures. Sending never
  throws into the queue worker.
- **Payload** is fixed to `{ title, body, chatId, url, tag }`. The title is the item title or
  note (80 chars); the body is a fixed phrase per outcome (`answered`, `failed`, `capped`).
  Answer text never leaves the server via push (ADR 0008).

## Alternatives considered
- Require env VAPID keys: rejected; zero-config self-hosting matters more, and env still wins
  when set (multi-instance or restore scenarios).
- `google-auth-library` / `firebase-admin`: rejected for now; the token exchange is ~40 lines
  and the SDKs pull in far more than the feature needs. Revisit if FCM adds an auth requirement
  the hand-rolled path cannot follow.
- Data-only FCM messages: rejected in ADR 0008 (not delivered when the app is killed).

## Consequences
- Deleting `~/.doubletake` (or the `settings` row) invalidates browser subscriptions; the PWA
  re-subscribes on next open when the server key differs from the stored one.
- The `push_subscriptions` table has no per-kind uniqueness beyond the endpoint; the same
  browser installed twice yields two rows, which is correct.
- Rotating a compromised service account is an env change plus restart; no code path caches
  the key.
