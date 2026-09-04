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
  `{ url? | text?, note?, modeHint: "auto" | "quick" | "standard" | "deep", channel: "android_share" }`
  over `HttpURLConnection` (8 s connect / 15 s read). Success shows a toast and calls
  `finish()`; failure shows the server's `error` field (or `HTTP <code>`) and keeps the sheet
  open. It never starts `MainActivity`/the WebView. Image and video files are accepted by the
  intent filter but uploaded only from M3 onwards (the media worker); until then the sheet says
  so and sends the note as the item text if one was typed.
- If unpaired (`Pairing.get()` finds no URL + token in Preferences): the share is saved as JSON
  under `doubletake.pendingShare`, a toast asks to pair, and `MainActivity` opens. After
  pairing the web app consumes the pending share once and opens `/share?…&channel=android_share`
  pre-filled.
- An offline queue (Room + WorkManager) is a roadmap item, not in M2.

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
phrase, `url` the deep link `/chat/<id>`; the answer text never leaves the server.

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
- **Pairing input.** The code field accepts the QR URL or `{url, code}` JSON and splits it into
  server URL + code only when both are present, so typing a URL by hand is not split mid-way.

## Verified on device (Galaxy S25 FE, Android 16, 2026-09-03)
Over `adb reverse tcp:7391` with `DOUBLETAKE_PUBLIC_URL=http://localhost:7391`:
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
after `✔ Sync finished`. `scripts/doctor.sh` checks for `java` and `adb`. iOS: Capacitor iOS
target plus a Share Extension is planned; untested until someone with an iPhone picks it up.
