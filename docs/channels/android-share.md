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
  token replaces the previous one). Enable is refused with a clear message when the server
  reports no `fcm` kind. Tapping a notification navigates to `data.url` / `/chat/<chatId>`.
  On-device delivery has not been verified yet (no Firebase project in the dev setup). The server sends **notification** messages (title,
  body, `data.chatId`, `data.url`, Android channel `doubletake`, high priority, collapse key
  `chat-<id>`) so delivery works when the app is killed; tapping opens `/chat/<id>`.
- **Web Push**: the PWA's service worker subscribes with `push.vapidPublicKey` and posts the
  subscription as `{ kind: "webpush", endpoint, keys }`. Works on desktop Chrome/Edge/Firefox
  and on Android Chrome for the installed PWA. Keys are generated by the server on first boot;
  set `VAPID_*` only to bring your own.
- Subscriptions reported gone (404/410, `UNREGISTERED`) are deleted at once; eight consecutive
  failures also delete. Clients re-subscribe on open when their stored endpoint is missing.

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
