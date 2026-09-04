# 0008 — Web Push + FCM + IG reaction; notifier interface

- Status: accepted (amended by [0019](0019-owner-notification-channels.md): ntfy/Telegram are broadcasters, not `Notifier`s)
- Date: 2026-09-03

## Context
The point of the product is "keep scrolling, get told when the answer is ready". Notifications
must work when the app is killed, on Android and on desktop, and the Instagram path should
acknowledge in-channel.

## Decision
A `Notifier` interface with three v1 implementations: Web Push (VAPID) for the PWA, FCM via
`@capacitor/push-notifications` for Android (notification payloads, not data-only, so
delivery works when killed), and an Instagram `love` reaction on the source DM. Telegram and
ntfy plug into the same interface later.

## Alternatives considered
- Web Push only: Chrome on Android throttles PWA pushes aggressively when the app is killed.
- Polling in the app: battery and latency.
- Public IG reply as acknowledgement: rejected in ADR 0006.

## Consequences
FCM needs a Firebase project and a service-account file; the docs make it optional. Push
payloads carry only the chat id and a short title, never content, because they transit third
parties.
