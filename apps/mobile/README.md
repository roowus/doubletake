# apps/mobile

Capacitor 8 Android project wrapping the `apps/web` build (`webDir: ../web/dist`,
`appId: com.roowus.doubletake`). Guide: [docs/channels/android-share.md](../../docs/channels/android-share.md).

Native pieces (`android/app/src/main/java/com/roowus/doubletake/`):

- `ShareReceiverActivity.kt` — the tiny translucent share sheet; posts to `/api/ingest` and
  never boots the WebView. Layout in `res/layout/activity_share.xml`.
- `Pairing.kt` — reads the server URL and device token the web app mirrors into Capacitor
  Preferences (`CapacitorStorage` group); stores a pending share when unpaired.
- `MainActivity.java` — plain `BridgeActivity`. Push registration and deep links live in the
  web layer (`apps/web/src/native.ts`).

## Build

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # JDK 21
export ANDROID_HOME=~/Library/Android/sdk
pnpm --filter @doubletake/mobile apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm --filter @doubletake/mobile sync` = web build + `cap sync android`; `open` starts Android
Studio. For FCM put `google-services.json` (git-ignored) in `android/app/`; the build applies
the Google Services plugin only when it is present.

Generated and ignored: `android/app/src/main/assets/public`, `android/app/src/main/res/xml/config.xml`,
`android/capacitor-cordova-android-plugins`, `android/app/capacitor.build.gradle` is regenerated
by `cap sync`. iOS target: not yet.
