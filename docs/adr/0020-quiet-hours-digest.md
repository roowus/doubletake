# 0020 — Quiet hours: park run notifications and send one digest

- Status: accepted (amends 0008)
- Date: 2026-09-04

## Context
ADR 0008 sends one push per finished run, at once. Shares pile up in the evening and their
answers land between midnight and breakfast; every one wakes the phone. The owner wants a daily
window during which nothing buzzes, and a single "N answers ready" when the window ends. The
answer text must still never leave the server (ADR 0008), and the rule has to hold for every
delivery path at once: per-device Web Push and FCM, and the owner channels of ADR 0019.

## Decision
A `DigestGate` (`apps/server/src/notify/quiet.ts`) sits between the queue worker and the
`NotificationHub`; the worker's `notifier` is the gate, not the hub. It reads one setting,
`quiet_hours` (`{ enabled, start, end, timeZone }`, `HH:MM` in an IANA zone, window may wrap
midnight, `start === end` means never quiet), stored in the `settings` table and edited from
Settings → Notifications. Inside the window a notification is written to a new
`pending_notifications` table (chat id, title, body, url, tag) instead of being sent. A
once-a-minute timer, plus one check at boot, calls `flush()`: outside the window it sends **one**
digest through the hub, then deletes the rows. The digest's title is `Answer ready` for one
parked item (deep link to that chat) or `N answers ready` (opens the chat list); its body is the
first three item titles, truncated. Tag `digest`, so repeated digests collapse on the device.
Owner API: `PUT /api/push/quiet-hours` (validates times and zone; turning quiet hours off flushes
at once) and `POST /api/push/digest/flush` ("Send now", ignores the window). `GET /api/status`
adds `push.quietHours` and `push.pending`.

## Alternatives considered
- Delaying inside each `Notifier`/`Broadcaster`: four copies of the same logic and no single
  place to count what is pending.
- Scheduling a delivery per parked item at window end: N pushes at 07:30 is exactly what the
  owner asked not to get.
- Storing the window in `.env`: it changes with travel and holidays; a setting the phone can edit
  fits better. Time zone is explicit because the laptop's zone is not the phone's.
- Per-device quiet hours: Android and browsers already do this locally (Do Not Disturb); the
  server-side feature exists for the digest, which is owner-level.

## Consequences
Notifications can arrive up to a minute after the window ends. A run that fails during quiet
hours is reported in the digest with its title only; the failure detail is in the chat as
before. `pending_notifications` rows survive restarts, so a laptop that sleeps through 07:30
sends the digest when it wakes. Tests drive the gate with an injected clock
(`test/digest.test.ts`).
