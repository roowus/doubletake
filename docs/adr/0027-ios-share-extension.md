# 0027 — iOS share extension on the Capacitor app

## Status
accepted (builds and launches in the iOS 26.3.1 simulator, App Group mirror verified; Share
Extension flow and real device still **unverified**)

## Date
2026-09-04

## Context
ADR 0007 chose one PWA wrapped by Capacitor, with Android first and "iOS Share Extension is a
separate native piece to be written later". Every other item on the roadmap's Later list is
done. The Android sheet's contract is settled and live-verified: a tiny native surface that
reads the pairing values the web layer mirrors into Capacitor Preferences, posts to
`/api/ingest` with the device token, and never boots the WebView; when unpaired it stashes the
share and opens the app.

iOS differs in three ways that shape the port. A Share Extension runs in its own process and
sandbox, so it cannot read the app's `UserDefaults.standard`, which is where
`@capacitor/preferences` stores its values (prefix `CapacitorStorage.`, no App Group support).
Extensions may not call `UIApplication.open`, only ask the responder chain to open a URL, so
the "unpaired → open the app" path needs a custom URL scheme. And there is no FCM on iOS: push
would mean APNs, an Apple developer account and a server-side APNs sender, none of which exist
here.

## Decision
- **Native `ShareExtension` target** in `apps/mobile/ios/App`, principal class
  `ShareViewController` (Swift, no storyboard): card with the detected URL or text, note field,
  mode chips, Send. Activation rule: one web URL or page, plain text, one image or one movie.
  It posts `{ url | text, note?, modeHint, channel: "ios_share" }` to `POST /api/ingest`
  with `Authorization: Bearer <device token>` and completes the request. Media-only shares send
  the note as text and say that files are not uploaded from the sheet, as on Android.
- **App Group bridge, not a plugin.** Both targets carry the
  `group.com.roowus.doubletake` application group. `SceneDelegate` copies
  `CapacitorStorage.doubletake.serverUrl` and `.token` from the standard defaults into the group
  suite on every activate/resign, and the extension reads them from there. While unpaired the
  extension writes `doubletake.pendingShare` `{url,text,title}` into the group and opens
  `doubletake://share`; `SceneDelegate` moves that value into Capacitor Preferences on the next
  launch or URL open so the existing `takePendingShare()` replay in `App.tsx` handles it. No
  new Capacitor plugin, no change to the web pairing flow.
- **New channel value `ios_share`** in `packages/shared`, recorded on the item like
  `android_share`; `pendingShareToPath` picks the channel from the Capacitor platform.
- **No push on iOS in v1.** Settings shows the limitation and points at the owner-level
  channels (ntfy, Telegram, ADR 0019), which reach any phone without APNs. APNs stays a
  roadmap item behind an Apple developer account.
- **Scaffold committed, not generated on the fly.** `apps/mobile/ios/` is Capacitor's SPM
  template with the app id and name applied, `Package.swift` in the exact form `cap sync ios`
  writes for the three plugins, and the extension target added to the pbxproj by script
  (`xcodeproj` gem). `cap sync ios` regenerates only `Package.swift`, `public/` and
  `capacitor.config.json`, all git-ignored or byte-identical, so the checked-in project survives
  syncs. Xcode's automatic signing needs the owner's team once, in Xcode.

## Alternatives considered
- `@capgo/capacitor-share-target` or a Capacitor plugin with an App Group: routes the share
  through the WebView (slow boot, the thing ADR 0007 rejected) or still needs the App Group
  bridge, so it adds a plugin without removing any native code.
- Keychain access group instead of App Group defaults: the token would be better protected at
  rest, but the URL and pending share are not secrets and one mechanism is simpler; revisit if
  the token moves to the Keychain on both platforms.
- Sharing the token by putting it in the extension's own defaults at pairing time from the web
  layer: impossible, JavaScript cannot reach the group suite without native code.
- APNs now: needs a paid Apple developer account and a server-side APNs client (token-based
  auth, HTTP/2); declined until someone with an iPhone and an account can test it.
- Wait for `cap add ios` to run on this machine: the CLI refuses when `ios/` exists and needs
  an active Xcode developer directory the owner has to select with `sudo`; committing the
  template avoids the dependency and keeps the extension target in git.

## Consequences
Roughly 330 lines of Swift next to the Kotlin. Two `Pairing` implementations (Kotlin, Swift)
share key names with `apps/web/src/native.ts` by convention; a key rename touches three files.
The `channel` enum grows by one value everywhere it is listed. The app and extension build with Xcode 26.2 and
the app runs in the simulator with the App Group mirror working; the extension's share flow
and any real device are still marked **unverified**. The first person with an iPhone should
follow `docs/channels/ios-share.md` §Verify and remove the markers in the same commit.
