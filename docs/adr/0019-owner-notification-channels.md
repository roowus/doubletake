# 0019 — Owner notification channels (ntfy, Telegram) as broadcasters, not subscriptions

- Status: accepted (amends 0008)
- Date: 2026-09-04

## Context
ADR 0008 promised that Telegram and ntfy would "plug into the same `Notifier` interface later".
When it came to it, the fit was wrong: a `Notifier` delivers to a **push subscription** that a
device registers (`POST /api/push/subscribe`) and that the push service can declare dead (`gone`
⇒ delete). An ntfy topic or a Telegram chat is neither: the owner configures it once in `.env`,
no device owns it, there is no endpoint to register from a client, and a 4xx from the service
means misconfiguration, not a stale token. Modelling them as synthetic `push_subscriptions` rows
for a pseudo-device would have made the pruning logic delete the owner's configuration after
eight transient failures and made "Disable on this device" ambiguous.

## Decision
Add a second, deliberately small interface next to `Notifier`: a `Broadcaster` (`kind`,
`send(notification)`) with no target and no `gone` outcome. `NotificationHub` holds a list of
broadcasters and sends every notification to all of them in addition to the per-device fan-out;
device-targeted sends (`onlySubscriptionIds`, i.e. Settings → Send test) skip them. v1 ships
`NtfyBroadcaster` (`POST <NTFY_URL>/<NTFY_TOPIC>`, `Title`/`Click`/optional `Authorization`
headers) and `TelegramBroadcaster` (Bot API `sendMessage` with an inline **Open chat** button
when the server has a public URL). Both are configured only by environment variables
(`NTFY_TOPIC`, `NTFY_URL`, `NTFY_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); there is no
client-side subscribe flow. `GET /api/status` lists them under `push.channels`, and
`POST /api/push/channels/test` sends a test message to them alone. Payload rule of ADR 0008 is
unchanged: title, fixed body phrase and deep link only, never answer text.

## Alternatives considered
- Synthetic `push_subscriptions` rows: reuses the hub loop, but pruning and per-device
  semantics do not apply (see Context).
- A per-device "forward to Telegram" preference: more UI for no gain; one owner per instance.
- Telegram as an *ingest* channel (share links to the bot): out of scope here; it would be a
  `channels/` entry like Instagram and can reuse the same bot token later.

## Consequences
Two interfaces to explain instead of one, each a few lines. Owner channels cannot be toggled
from the UI, only tested; changing them means editing `.env` and restarting. Failures are
logged and counted in the hub result but never disable the channel. The Telegram bot token
lives in `.env` like the other secrets (ADR 0018's `SecretBox` is for tokens the server
obtains itself). Verified live 2026-09-04 against ntfy.sh only when the owner configures a
topic; the Telegram path is exercised by tests with an injected `fetch` and marked
**unverified** in the deployment guide until someone runs it against the real Bot API.
