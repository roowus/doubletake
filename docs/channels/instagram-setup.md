# Instagram channel setup

Doubletake uses Meta's official **Instagram API with Instagram Login** against a *shadow*
Instagram account you control. You DM reels to it, or @mention it under posts. Nothing here
touches your personal account's DMs; the official API cannot read those.

Statements marked **unverified** come from Meta's documentation and have not yet been
confirmed against the live API. M4 removes the markers as they are checked. Implementation:
`apps/server/src/channels/instagram/` and `apps/server/src/api/instagram.ts`
([ADR 0018](../adr/0018-instagram-channel-and-keyfile-secrets.md)).

## 0. Server configuration

| variable | meaning |
|---|---|
| `IG_APP_ID`, `IG_APP_SECRET` | Meta app credentials; both set ⇒ the channel is enabled (boot log `instagram: connected` / `not connected`) |
| `IG_WEBHOOK_VERIFY_TOKEN` | random string you also paste into the Meta webhook dialog |
| `DOUBLETAKE_WEBHOOK_PUBLIC_HOST` | hostname of the tunnel; requests with that `Host` are refused (`404`) on every path except `/webhooks/instagram` |
| `IG_MENTION_POLLING` | `on` (default) polls `/tags` every 2 minutes; `off` relies on the webhook alone |
| `IG_GRAPH_BASE` | default `https://graph.instagram.com/v25.0` |
| `DOUBLETAKE_PUBLIC_URL` | must be set: the OAuth redirect is `<public url>/api/ig/callback`, so add exactly that URL under **Valid OAuth redirect URIs** in the Meta dashboard |

The long-lived token is stored sealed with `~/.doubletake/keyfile` in `ig_accounts`; the app
secret stays in `.env` and is never written to the database.

## 1. Accounts

1. Create (or convert) an Instagram account to **Business** or **Creator** and set it to
   **public**. This is the shadow account (e.g. `@yourname.doubletake`).
2. Create a Meta developer account at developers.facebook.com and a new app of type
   **Business** (or "Other → Business"). No Facebook Page is required for the Instagram Login
   flavour of the API.
3. Add the product **Instagram** → **API setup with Instagram login**.
4. Add your shadow account as an **Instagram Tester** (App Roles) and accept the invite from
   the shadow account. App-role accounts are the only ones that trigger webhooks under Standard
   Access, which is exactly what a single-owner install needs.

## 2. Permissions and tokens

Scopes: `instagram_business_basic`, `instagram_business_manage_messages`,
`instagram_business_manage_comments`. Standard Access is sufficient; **do not** submit for App
Review for a personal install.

Doubletake's settings page runs the OAuth flow (`POST /api/ig/connect` → `{ url }`): it sends
you to `https://www.instagram.com/oauth/authorize?...` with a random 10-minute `state`,
receives the code at `/api/ig/callback` (any `#_` suffix is stripped), exchanges it for a short-lived token, then for a **60-day long-lived
token** (`GET /access_token?grant_type=ig_exchange_token`). Tokens are refreshed by a
scheduled job every 30 days (`GET /refresh_access_token?grant_type=ig_refresh_token`; the
token must be at least 24 h old; `POST /api/ig/refresh` forces it). After connecting, the
server subscribes the app to `messages`, `mentions`, `comments` (`POST /<IG_ID>/subscribed_apps`)
and redirects to `/settings?ig=connected` (or `?ig=error&message=…`). `DELETE /api/ig/account`
disconnects.

API host: `https://graph.instagram.com/v25.0`.

## 3. Webhooks

1. Expose `/webhooks/instagram` publicly (Cloudflare Tunnel or Tailscale Funnel; see
   [DEPLOYMENT.md](../DEPLOYMENT.md)). Only this path is reachable through the public
   hostname.
2. In the Meta dashboard → Instagram → Webhooks, set the callback URL and the verify token
   from `IG_WEBHOOK_VERIFY_TOKEN`. Subscribe to fields `messages`, `mentions`, `comments`.
3. Switch the app to **Live** mode (webhooks do not fire in Development mode for this API).
4. Doubletake verifies `X-Hub-Signature-256` with `IG_APP_SECRET` on every delivery, answers
   `200` immediately, and processes asynchronously. Every event id is stored in `ig_events`
   for deduplication (Meta retries).

Field availability: `messages` works under Standard Access. `comments` officially requires
Advanced Access (**unverified** whether it fires for app-role accounts anyway). `mentions`
under Standard Access is **unverified**. If mentions do not arrive, Doubletake polls
`GET /<IG_ID>/tags` every 2 minutes as a fallback (`IG_MENTION_POLLING`, default on;
`POST /api/ig/poll` runs one poll by hand) — also
**unverified** that `tags` covers comment mentions for this API flavour. DM share is the
guaranteed path either way.

## 4. Flows

### DM share (reliable)
Share a reel/post to the shadow account from the Instagram share sheet, optionally with a
text message (becomes the `note`).

Payload shape (abridged):
```json
{ "entry": [{ "messaging": [{ "sender": { "id": "OWNER_IGSID" }, "message": {
    "mid": "…", "text": "is this legit?",
    "attachments": [{ "type": "ig_reel", "payload": { "url": "https://lookaside.fbsbx.com/…", "title": "…", "reel_video_id": "…" } }] } }] }] }
```
`type` is `ig_reel` or `share` (`story_mention` is accepted too). `payload.url` is a signed CDN
URL handed to the media worker as `hints.cdn_url` so it downloads it immediately (TTL
undocumented) instead of going through yt-dlp. The item's URL is, in order: an
`instagram.com` permalink found in the message text, the permalink of `reel_video_id` when the
media is your own, else the CDN URL. `note` = message text minus that URL, else `payload.title`.
Echoes (`is_echo`), messages without `mid` and plain text without an attachment are recorded
as `other` and ignored; redeliveries of the same `mid` count as duplicates.

When the run finishes:
`POST /<IG_ID>/messages` with
`{ "recipient": { "id": "OWNER_IGSID" }, "sender_action": "react", "payload": { "message_id": "<mid>", "reaction": "love" } }`.

### Comment @mention
Comment `@yourname.doubletake what do people think?` under any public post.

Payload shape (abridged; Doubletake accepts both `changes[]` and flat `field`/`value`):
```json
{ "entry": [{ "changes": [{ "field": "mentions", "value": { "media_id": "…", "comment_id": "…" } }] }] }
```
Processing:
1. `GET /<IG_ID>?fields=mentioned_comment.comment_id(<comment_id>){text,username,timestamp,parent_id,replies{…}}`
   — `parent_id` presence is how a reply is detected (**unverified** field name on this
   edge; fallback: compare against the top-level comment list of the media).
2. `GET /<IG_ID>?fields=mentioned_media.media_id(<media_id>){caption,permalink,media_url,media_type,username,comments{…}}`.
3. `focus = thread:<parent_id>` if the mention is a reply, else `focus = comments`.
   `note` = the mention text minus the handle.
4. Caption, comments (total count + up to 200 sampled, replies flattened) and, for a reply,
   the whole thread (`{ parent, replies }`) are stored on the item as `instagram-graph`
   extractions and reach the brain as untrusted blocks (the thread labelled `primary thread`).
   `media_url` goes to the media worker as `hints.cdn_url`.
5. Comments that do not contain the shadow account's handle (from the `comments` field) are
   ignored. Every comment id is stored in `ig_events`, so Meta retries and the polling fallback
   never create a second item. `POST /api/ig/simulate-mention { media_id, comment_id }` replays
   a real id pair through the same code.
6. The bot posts **nothing**. Completion is signalled by push notification only.

Limits: the media owner must be a public account; private replies to comments are only
possible on your own media and are not used.

## 5. Settings UI
Connect / disconnect, show username and token expiry, polling state. Planned: "send test DM
to myself" (`POST /api/ig/test { recipientId, text? }`) and "simulate mention" buttons; both
routes exist and can be called with `curl` and a device token in the meantime.

## 6. Live verification checklist (M4 acceptance)
1. `GET /api/ig/status` → `connected: true`, `username` = shadow account.
2. Meta dashboard → Webhooks → **Test** on `messages`: server log shows the delivery and
   `ig_events` gains a row (`GET /api/chats` shows no item because test payloads have no
   attachment).
3. DM a public reel to the shadow account with a note: item `instagram | ig_dm`, media from the
   CDN URL, answer pushed, `love` reaction appears on the DM.
4. Comment `@<shadow> is this true?` under a public post: item with `focus=comments`; reply
   inside a thread: `focus=thread:<parent_id>`. If nothing arrives within 3 minutes the
   polling fallback should have picked it up (`ig_events.id = poll:<media_id>`); if it did
   not, `/tags` does not cover comment mentions and this guide must say so.
Remove the **unverified** markers above in the same commit as the observed behaviour.
