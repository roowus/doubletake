# Instagram channel setup

Doubletake uses Meta's official **Instagram API with Instagram Login** against a *shadow*
Instagram account you control. You DM reels to it, or @mention it under posts. Nothing here
touches your personal account's DMs; the official API cannot read those.

Statements marked **unverified** come from Meta's documentation and have not yet been
confirmed against the live API. M4 removes the markers as they are checked.

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

Doubletake's settings page runs the OAuth flow: it sends you to
`https://www.instagram.com/oauth/authorize?...`, receives the code at
`/api/ig/callback`, exchanges it for a short-lived token, then for a **60-day long-lived
token** (`GET /access_token?grant_type=ig_exchange_token`). Tokens are refreshed by a
scheduled job every 30 days (`GET /refresh_access_token?grant_type=ig_refresh_token`; the
token must be at least 24 h old). Stored encrypted in `ig_accounts`.

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
`GET /me/tags` every 2 minutes as a fallback (`ig.mentionPolling: true`) — also
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
`type` is `ig_reel` or `share`. `payload.url` is a signed CDN URL; the worker downloads it
immediately (TTL undocumented). The permalink is resolved when a media id is available;
otherwise the item keeps the CDN-derived title and the transcript.

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
4. The bot posts **nothing**. Completion is signalled by push notification only.

Limits: the media owner must be a public account; private replies to comments are only
possible on your own media and are not used.

## 5. Settings UI
Connect / disconnect, show token expiry, "send test DM to myself", "simulate mention"
(replays a fixture through the handler), mention polling toggle.
