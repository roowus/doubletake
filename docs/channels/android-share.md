# Android share sheet and push

## Pairing
1. Open the Doubletake PWA on the laptop → Settings → Devices → **Pair new device**. A QR is
   shown containing `{ "url": "https://<host>.ts.net", "code": "<6-digit, 5-minute>" }`.
2. Install the Android app (debug APK from `apps/mobile`, later a release). First screen scans
   the QR (or you type URL + code). The app calls `POST /api/devices/pair` and stores the
   returned long-lived token and the URL in Capacitor Preferences.
3. The phone must reach the server: install Tailscale on the phone and join the same tailnet.

## Share sheet
`ShareReceiverActivity` (Kotlin, `apps/mobile/android/app/src/main/java/.../ShareReceiverActivity.kt`):

- Declared in the manifest with intent filters for `ACTION_SEND` with `text/plain`,
  `image/*`, `video/*` and `ACTION_SEND_MULTIPLE` for images. Theme is translucent so it
  floats over Instagram.
- Extracts the first URL from `EXTRA_TEXT` (Instagram shares reels as a `text/plain` URL;
  Reddit and YouTube likewise; Chrome sends the page URL and title).
- Renders a compact Material bottom sheet: detected URL or file name, a one-line note field,
  mode chips **Auto · Quick · Standard · Deep**, and **Send**.
- On Send: `POST {url}/api/ingest` with `Authorization: Bearer <device token>`, body
  `{ url?, text?, note, modeHint, channel: "android_share" }` (files are uploaded as
  multipart). Shows a toast and calls `finish()`. It never starts `MainActivity`/the WebView.
- If unpaired: opens the main app to the pairing screen with the share preserved.
- Failures are queued locally (Room table) and retried by a WorkManager job, so sharing works
  offline and drains when the tailnet is reachable.

Alternative documented in ADR 0007: `@capgo/capacitor-share-target` routes through the WebView
and is fine if native code is unwanted; Doubletake keeps the native activity for speed.

## Web Share Target (no Capacitor)
`apps/web` manifest declares
`"share_target": { "action": "/share", "method": "POST", "enctype": "multipart/form-data", "params": { "title": "title", "text": "text", "url": "url" } }`
so an installed PWA on Android Chrome or desktop Chrome/Edge can receive shares. The `/share`
route shows the same compact sheet in web form.

## Push
- **FCM**: create a Firebase project, add an Android app with the Capacitor `appId`, download
  `google-services.json` into `apps/mobile/android/app/` (git-ignored), and put the Firebase
  service-account JSON path in `FCM_SERVICE_ACCOUNT_PATH`. The app registers with
  `@capacitor/push-notifications` and posts the token to `POST /api/push/subscribe`
  (`kind: "fcm"`). The server sends **notification** messages (title, body, `data.chatId`) so
  delivery works when the app is killed; tapping opens `/chat/<id>`.
- **Web Push**: the PWA's service worker subscribes with the VAPID public key and posts the
  subscription (`kind: "webpush"`). Works on desktop Chrome/Edge/Firefox and on Android Chrome
  for the installed PWA. Generate keys once: `pnpm --filter @doubletake/server exec web-push generate-vapid-keys`.
- Payloads never contain answer text; only the item title and chat id.

## Build
JDK 17, Android SDK 35, Capacitor 7. `pnpm --filter @doubletake/web build && npx cap sync android && npx cap open android`.
iOS: Capacitor iOS target plus a Share Extension is planned; untested until someone with an
iPhone picks it up.
