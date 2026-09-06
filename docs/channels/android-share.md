# Android share sheet and push

## Pairing
1. Open the Doubletake PWA on the laptop → Settings → **Pair a device** → **Show pairing code**.
   The server (`POST /api/pair/start`) mints a 6-character, 10-minute, single-use code; the
   page shows it as text and as a QR whose payload is the URL
   `https://<host>.ts.net/?code=ABC123` (a plain URL, so any camera app opens the web pairing
   screen too). The same response carries `qr: {"url","code"}` as JSON for clients that prefer
   it; the Android app accepts either form.
2. Install the Android app (debug APK from `apps/mobile`, later a release). Its first screen
   is the same `Welcome` page as the web, opened on the **Pairing code** tab with an extra
   **Server URL** field. Paste the QR payload (the `https://…/?code=` URL or the `{url, code}`
   JSON) into the code field and both fields fill themselves; or type them. The app calls
   `POST /api/pair/redeem` `{ code, deviceName, platform: "android" }` and keeps the server URL
   and the long-lived token in `localStorage`, mirrored into Capacitor Preferences
   (`doubletake.serverUrl`, `doubletake.token`) so the native share activity can read them.
   Every API call from the WebView is prefixed with the stored server URL (`apiBase()` in
   `apps/web/src/native.ts`). Tokens are per device and revocable from Settings → Devices.
3. The phone must reach the server: install Tailscale on the phone and join the same tailnet.

## Share sheet
`ShareReceiverActivity` (Kotlin, `apps/mobile/android/app/src/main/java/.../ShareReceiverActivity.kt`):

- Declared in the manifest with intent filters for `ACTION_SEND` with `text/plain`,
  `image/*`, `video/*` and `ACTION_SEND_MULTIPLE` for images. Theme `AppTheme.ShareSheet` is a
  translucent bottom dialog (`excludeFromRecents`, `noHistory`, empty `taskAffinity`) so it
  floats over Instagram and never appears in Recents.
- Extracts the first `http(s)://` URL from `EXTRA_TEXT` (Instagram shares reels as a
  `text/plain` URL; Reddit and YouTube likewise; Chrome sends the page URL and `EXTRA_SUBJECT`
  title); the rest of the text stays as `text`.
- Renders a compact bottom sheet (`res/layout/activity_share.xml`): detected URL or the shared
  text, a one-line note field (IME "Send" submits), mode chips **Auto · Quick · Standard ·
  Deep** (a `RadioGroup`), and **Send**.
- On Send: `POST {serverUrl}/api/ingest` with `Authorization: Bearer <device token>`, body
  `{ url? | text?, note?, modeHint: "auto" | "quick" | "standard" | "deep", channel: "android_share", clientId }`
  over `HttpURLConnection` (8 s connect / 15 s read; `ShareApi.kt`). Success shows a toast and
  calls `finish()`; a server *rejection* (non-2xx) shows the `error` field (or `HTTP <code>`) and
  keeps the sheet open, since the same body would fail again. It never starts
  `MainActivity`/the WebView. Image and video files are accepted by the intent filter but
  uploaded only from M3 onwards (the media worker); until then the sheet says so and sends the
  note as the item text if one was typed.
- If unpaired (`Pairing.get()` finds no URL + token in Preferences): the share is saved as JSON
  under `doubletake.pendingShare`, a toast asks to pair, and `MainActivity` opens. After
  pairing the web app consumes the pending share once and opens `/share?…&channel=android_share`
  pre-filled.
- **Offline queue.** When nothing reaches the server (airplane mode, tailnet down, DNS, timeout)
  the exact body is appended to `ShareQueue` (a JSON array in the app-private SharedPreferences
  file `doubletake.shareQueue`; a few small records, so no Room database) and the sheet closes
  with "Offline: saved, will send when the server is reachable" (with the count when more are
  waiting). `ShareUploadWorker`, a WorkManager unique job (`doubletake-share-queue`, network
  constraint, exponential backoff from 30 s, `APPEND_OR_REPLACE`), drains the queue in order:
  2xx removes the record; 4xx other than 408/429 removes it and posts a local "could not send"
  notification with the server's reason; unreachable, 5xx, 408 and 429 stop the pass and retry
  later. `MainActivity.onCreate` re-schedules the drain when records are waiting, so a queue
  survives reboots and app kills. Once at least one record went through, a local notification
  "Sent N queued shares" is posted (channel `doubletake`, the same one FCM uses). Every share
  mints a `clientId` (`share-<uuid>`) that travels with the body: the server treats a repeated
  key as a replay of the first ingest and returns its item/chat/run with `replayed: true`, so a
  response lost on the way back never produces a second item or run. Verified on the API 36
  emulator (2026-09-06): share with the tunnel removed → record parked, worker `RETRY`; tunnel
  restored and the job run → `SUCCESS`, item on the server with the `clientId`, queue empty,
  "Sent 1 queued share" notification; re-posting the same key by hand returned `replayed: true`
  and no new run.

Alternative documented in ADR 0007: `@capgo/capacitor-share-target` routes through the WebView
and is fine if native code is unwanted; Doubletake keeps the native activity for speed.

## Web Share Target (no Capacitor)
`apps/web` manifest declares
`"share_target": { "action": "/share", "method": "GET", "params": { "title": "title", "text": "text", "url": "url" } }`
so an installed PWA on Android Chrome or desktop Chrome/Edge can receive text and link shares.
The `/share` route shows the compose sheet pre-filled (`channel: "web_share_target"`). GET is
enough for text; file shares would need POST + multipart and come with M3.

## Push
Every finished, failed or capped run sends one notification to each subscription of every
non-revoked device ([ADR 0016](../adr/0016-push-keys-and-fcm-http-v1.md)). Payloads are
`{ title, body, chatId, url, tag }`: the title is the item title or note, the body a fixed
phrase, `url` the deep link `/chat/<id>`; the answer text never leaves the server. The same
notification also goes to the owner channels (ntfy, Telegram) when configured
([Deployment](../DEPLOYMENT.md#push-notifications), [ADR 0019](../adr/0019-owner-notification-channels.md)).

- **API**: `POST /api/push/subscribe { kind: "webpush" | "fcm", endpoint, keys? }` registers
  the calling device's endpoint (`keys: { p256dh, auth }` is required for `webpush`; `409` when
  the server has no notifier of that kind), `POST /api/push/unsubscribe { endpoint }`,
  `GET /api/push/subscriptions` (this device), `POST /api/push/test` (sends to this device only;
  use it after pairing). `GET /api/status` returns `push.kinds` and `push.vapidPublicKey`.
- **FCM**: create a Firebase project, add an Android app with the Capacitor `appId`
  (`com.roowus.doubletake`), download `google-services.json` into `apps/mobile/android/app/`
  (git-ignored; the Gradle build applies the `google-services` plugin only when the file
  exists), and point `FCM_SERVICE_ACCOUNT_PATH` at the Firebase service-account JSON. Settings →
  Notifications → **Enable** in the app asks for `POST_NOTIFICATIONS`, creates the `doubletake`
  channel, registers with `@capacitor/push-notifications` and posts the registration token as
  `{ kind: "fcm", endpoint: <token> }` (`enableNativePush()` in `apps/web/src/native.ts`; a new
  token replaces the previous one). Enable resolves only after the token has been posted, and
  fails within 30 s with the plugin's `registrationError` translated into a readable message, so
  the toggle never shows "enabled" for a device the server cannot reach. Enable is refused with
  a clear message when the server reports no `fcm` kind.
  **Gotcha:** `SERVICE_NOT_AVAILABLE` / "Firebase Installations Service is unavailable" from
  Google Play services means the phone's Play services cannot reach Google right now, not a
  Firebase misconfiguration. Two causes seen on a Galaxy S25 FE with the Tailscale VPN up:
  (1) Android **Private DNS** set to a hostname (`dns.google`) broke every lookup although
  `ping 8.8.8.8` worked; fix with Private DNS *Automatic*
  (`adb shell settings put global private_dns_mode opportunistic`) or off. (2) Play's push
  socket to `mtalk.google.com:5228` failed on every VPN network ("Failed connection err:3" in
  `adb shell dumpsys activity service GcmService`, with backoff over an hour) and reconnected
  within a second once the VPN was disconnected. Register the token with Tailscale off, then
  turn it back on; if pushes stop again, allow Google Play services to bypass the VPN (Tailscale
  → Settings → "Allow LAN access"/app exclusions). Then Enable again. Tapping a notification navigates to `data.url` / `/chat/<chatId>`.
  The server sends **notification** messages (title, body, `data.chatId`, `data.url`, Android
  channel `doubletake`, high priority, collapse key `chat-<id>`) so delivery works when the app
  is killed; tapping opens `/chat/<id>`. The whole Firebase side can be provisioned from the
  terminal, no console clicking needed; see "FCM from the CLI" in
  [DEPLOYMENT.md](../DEPLOYMENT.md). After changing `google-services.json` rebuild the APK and
  check it carries the config before testing: `aapt2 dump resources app-debug.apk | grep
  google_app_id`.
- **Web Push**: the PWA's service worker subscribes with `push.vapidPublicKey` and posts the
  subscription as `{ kind: "webpush", endpoint, keys }`. Works on desktop Chrome/Edge/Firefox
  and on Android Chrome for the installed PWA. Keys are generated by the server on first boot;
  set `VAPID_*` only to bring your own.
- Subscriptions reported gone (404/410, `UNREGISTERED`) are deleted at once; eight consecutive
  failures also delete. Clients re-subscribe on open when their stored endpoint is missing.
- During owner-set quiet hours nothing is sent; one digest (`tag: digest`, title
  `N answers ready`, `url` = chat list, or the single chat when N = 1) follows when the window
  ends ([ADR 0020](../adr/0020-quiet-hours-digest.md)). Clients need no change: a digest without
  `chatId` opens `/`.

## Inside the Capacitor WebView
- **Edge-to-edge.** Capacitor 8 draws the web view under the status and navigation bars and
  injects the CSS variables `--safe-area-inset-*`. `apps/web/src/styles.css` folds them into
  `--inset-*` (falling back to `env(safe-area-inset-*)` for the installed PWA) and pads the top
  bar, page, composer, FAB and sign-in card with them. Without this the top bar sat under the
  status bar on the S25 FE.
- **No service worker on native.** `main.tsx` registers the PWA worker on the web only and,
  inside Capacitor, unregisters any worker and clears every cache. The assets are local there,
  and a precached shell kept serving the *previous* APK's bundle after `adb install -r`, so a
  fix looked like it had not shipped. Web Push on native is therefore impossible by design;
  FCM is the only native channel.
- **FCM re-registration after pairing.** Enabling notifications from Settings is what first posts
  the FCM token, but the server forgets that subscription when the device is revoked (or the app
  is reinstalled). `App.tsx` therefore calls `resumeNativePush()` whenever the app becomes
  authenticated: if `POST_NOTIFICATIONS` is already granted it re-creates the channel and
  re-registers, and the `registration` listener re-posts the token. It never prompts; a device
  that never enabled notifications stays silent until Settings → Enable. Found on the Pixel 4 XL
  (2026-09-05): revoke → re-pair → share produced an answer with no notification.
- **"Failed to fetch" right after a notification tap.** Tapping an FCM notification launches
  the app before the Tailscale tunnel on the phone is back up, so the first `fetch` to the
  tailnet URL dies with a bare `TypeError: Failed to fetch` (seen on the Pixel 4 XL,
  2026-09-06; the same tap a moment later works). `api.ts` now retries idempotent GETs twice
  (0.4 s, 1.2 s) and turns a network failure into a readable "Could not reach the server"
  message (`ApiError` with status 0); the chat page shows a **Retry** button under it. POSTs
  are never retried so an ingest cannot be sent twice. The WebView loads the bundle from the APK
  (`webDir`), so the app needs a rebuild + `adb install -r` to pick up web changes; only the
  installed PWA gets them live from the server.
- **Pairing input.** The code field accepts the QR URL or `{url, code}` JSON and splits it into
  server URL + code only when both are present, so typing a URL by hand is not split mid-way.
- **Plain-http server URLs (device testing over `adb reverse`).** The bundle is served from
  `https://localhost`, so `fetch("http://localhost:7391/…")` is *mixed content* and the WebView
  drops it with a bare `TypeError: Failed to fetch` (nothing reaches the server, nothing in
  logcat). `capacitor.config.ts` sets `android.allowMixedContent: true` and the manifest points
  at `res/xml/network_security_config.xml`, which permits cleartext to `localhost` and
  `127.0.0.1` only; every other host must be https (Tailscale). First hit on a Pixel 4 XL
  (Android 13, WebView 151) — the S25 FE had accepted the same URL before the flag existed, so
  do not rely on a single WebView version for this. The native share sheet uses
  `HttpURLConnection`, which honours the same network security config.

## Verified on device (Galaxy S25 FE, Android 16, 2026-09-03)
Over `adb reverse tcp:7391` with `DOUBLETAKE_PUBLIC_URL=http://localhost:7391` (that build
predates the mixed-content allowance above; the Pixel 4 XL needed it — see the WebView notes):
pairing by code and by typed QR URL; `ShareReceiverActivity` for a URL share (item lands with
`channel: android_share`, note, chosen mode; the run answers and the chat list updates live) and
for a text-only share; unreachable server shows the toast and keeps the text, retry succeeds;
unpaired share opens the app on the pairing screen and replays into the compose sheet after
pairing; Settings → Notifications refuses cleanly while the server has no FCM. Firebase project
provisioned from the CLI and the server boots with `push: webpush+fcm`; the APK built with
`google-services.json` installs.

Later the same day, over the tailnet (Tailscale installed on the phone, `adb reverse`
removed, app paired against `https://<host>.ts.net`):
- **FCM arrives.** Settings → Notifications → Enable registers the token; Send test and a
  finished run both post a notification with the app killed, and tapping it opens `/chat/<id>`.
  Gotcha: with Tailscale's VPN up and a Private DNS override, the phone lost Google's
  `mtalk` push socket for a while; toggling the VPN off/on restored delivery.
- **Tailnet pairing** by the QR URL works end to end.
- **Real shares:** Chrome (page URL + title) and the Reddit app (share button → *Share via*
  → Doubletake in the system chooser) both reach `ShareReceiverActivity` and land as
  `channel: android_share`. Reddit shares `https://www.reddit.com/r/<sub>/s/<id>` app links;
  the extractor now follows the 301 and falls back to the thread's Atom feed when the `.json`
  view is 403 ([MEDIA-PIPELINE.md](../MEDIA-PIPELINE.md)). The sheet closes itself after a
  short idle, so a share left alone falls back to the underlying app.
- **Instagram app:** reel → paper-plane → *Share* → Doubletake in the system chooser. The
  sheet shows `https://www.instagram.com/reel/<code>/?igsi=…`; the item lands as
  `platform: instagram` with the tracking parameter stripped, the run answers from the public
  page's Open Graph caption plus web research, and the FCM notification arrives. Instagram
  regains focus afterwards; the WebView never starts.

### Second device (Pixel 4 XL, Android 13, 2026-09-04)
Off the tailnet, over `adb reverse tcp:7391` with the app pointed at `http://localhost:7391`
(this is what needed the cleartext allowance above). Pairing by code, Settings → Notifications
→ Enable, then **Send test** and a real compose run both posted FCM notifications on the
device (`dumpsys notification`: channel `doubletake`, tags `test` and `chat-<id>`, a
`contentIntent` into `MainActivity`). FCM is therefore not tied to the tailnet path: the
phone only needs the Google push socket; the server URL can be anything the app can reach.

### Emulator run (Medium Phone AVD, API 36.1 with Google Play, 2026-09-06)
Same `adb reverse` setup, driven entirely from the Mac with `adb shell input`: fresh install,
pair by code, `am force-stop`, then an `ACTION_SEND` intent at `ShareReceiverActivity` with a
Wikipedia URL. The compact sheet appeared over the launcher, Quick + Send created the run, and
when it finished a real FCM notification ("Pixel 4 — Answer ready. Tap to open the chat.")
arrived with the app dead. Tapping it launched `MainActivity` straight into `/chat/<id>` with
the answer rendered. This closes the last M2 caveat: tap-to-open is verified, not just
delivery. A plain `http://10.0.2.2:7391` server URL fails with `Failed to fetch` because the
network security config only allows cleartext to localhost — use `adb reverse`.

## Build
Capacitor 8 (`@capacitor/*` 8.x), Android Gradle Plugin 8.13, Gradle 8.14 wrapper, compileSdk /
targetSdk 36, minSdk 24, Java 21, Kotlin 2.2. Android Studio's bundled JBR is a JDK 21 and is
what the build expects; on this Mac it is not the default `java`, so:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME=~/Library/Android/sdk
pnpm --filter @doubletake/mobile apk      # web build → cap sync android → gradlew assembleDebug
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm --filter @doubletake/mobile sync` runs only the web build + `cap sync`; `open` launches
Android Studio. The Capacitor CLI finishes its work in well under a second and then, on a
non-interactive terminal, waits on a telemetry prompt: run it from a real terminal or kill it
after `✔ Sync finished`. `scripts/doctor.sh` checks for `java`, `adb` and `xcodebuild`. iOS: same
wrapper plus a native Share Extension, see [ios-share.md](ios-share.md) (unverified on a device).
