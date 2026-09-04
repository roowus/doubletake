> **Partly verified (2026-09-04).** Both targets build with Xcode 26.2 and the app runs in the
> iOS 26.3.1 simulator (iPhone 17 Pro): the WebView loads the pairing screen, and
> `SceneDelegate` mirrors the Capacitor Preferences pairing values into the App Group
> (checked with `simctl spawn <udid> defaults read group.com.roowus.doubletake`). Not yet
> exercised: the Share Extension end to end, the unpaired `doubletake://share` path, and any
> real device. If you have an iPhone, follow §Verify and update this note in the same commit.
> Decision record: [ADR 0027](../adr/0027-ios-share-extension.md).

The iOS app is the same Capacitor wrapper of `apps/web` as Android
([android-share.md](android-share.md)) plus a native **Share Extension** that appears in the
system share sheet as "Doubletake". It mirrors the Android sheet: read the pairing, post to
`/api/ingest`, close. It never boots the WebView.

## Pairing
Same as Android. Open the app, scan the QR from Settings → **Pair a device** or type URL + code;
the web layer stores `doubletake.serverUrl` and `doubletake.token` in Capacitor Preferences
(`UserDefaults.standard`, prefix `CapacitorStorage.`). Because a Share Extension runs in its own
sandbox, `SceneDelegate` copies those two keys into the App Group suite
`group.com.roowus.doubletake` every time the app becomes active or resigns
(`App/App/Pairing.swift` → `mirrorFromCapacitor()`); revoking or re-pairing propagates the same
way. Both targets declare the group in their `.entitlements`.

## Share sheet
`App/ShareExtension/ShareViewController.swift`:

- Activation rule (`ShareExtension/Info.plist`): one web URL or web page, plain text, one image
  or one movie. Instagram, Reddit, YouTube and Safari all share as a URL or as text containing
  one.
- Card over a dimmed background: detected URL or text preview, one-line note field, mode chips
  **Auto · Quick · Standard · Deep**, Cancel, Send (return in the note field also sends).
- On Send: `POST {serverUrl}/api/ingest` with `Authorization: Bearer <device token>` and body
  `{ url?, text?, note?, modeHint, channel: "ios_share" }`, 15 s timeout. The server's
  `error` field is shown in red on failure and the sheet stays open; on success it shows
  "Sent" and completes the request.
- Media-only shares (a photo or video with no URL or text) are accepted by the activation rule
  but the file is **not uploaded** from the sheet in v1, as on Android; the note is sent as the
  text and the card says so.
- **Unpaired**: the extension writes `doubletake.pendingShare` `{url,text,title}` into the App
  Group and asks the responder chain to open `doubletake://share` (the app registers that URL
  scheme in its `Info.plist`). On launch, `SceneDelegate.adoptPendingShare()` moves the value
  into Capacitor Preferences and the web app's existing pending-share replay opens `/share`
  pre-filled with `channel=ios_share` after pairing.

## Push
None on iOS in v1: FCM does not exist there and APNs needs an Apple developer account plus a
server-side sender. Settings → Notifications says so on iOS and points at the owner-level
channels in `.env` (ntfy or Telegram, [ADR 0019](../adr/0019-owner-notification-channels.md)), which
reach any phone. Web Push in iOS Safari for the installed PWA is a separate, untested path.

## Build
Prerequisites on the Mac: Xcode 26 with the iOS platform, Node 22 + pnpm, an Apple ID with a
development team (a free account is enough for a device build; App Groups need a real
provisioning profile, which Xcode creates automatically once a team is set).

The Capacitor CLI needs Xcode, not the Command Line Tools, as the active developer directory:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
cd apps/mobile
pnpm sync:ios          # builds apps/web, copies it to ios/App/App/public, rewrites CapApp-SPM/Package.swift
pnpm open:ios          # opens ios/App/App.xcodeproj in Xcode
```

In Xcode, for **both** the `App` and `ShareExtension` targets: Signing & Capabilities → pick
your team, keep "Automatically manage signing", and confirm the App Group
`group.com.roowus.doubletake` shows as enabled (the entitlements files already list it; Xcode
registers the group on your team the first time). Then build and run on the phone.

`cap add ios` is **not** needed and refuses to run while `ios/` exists: the project is committed
(Capacitor's SPM template with the extension target added). `cap sync ios` only regenerates
`CapApp-SPM/Package.swift`, `App/App/public/` and `capacitor.config.json`. `scripts/doctor.sh`
reports whether `xcodebuild` is available. The committed `Package.swift` is the file
`cap sync ios` writes (pnpm store paths under `node_modules/.pnpm`), so a sync leaves git clean.

## Verify
Simulator shortcut without pairing through the UI: redeem a code with `curl`, then
`xcrun simctl spawn <udid> defaults write com.roowus.doubletake CapacitorStorage.doubletake.serverUrl -string <url>`
(and `.token`), relaunch the app once so the mirror runs, and share from Safari.

1. Pair the app (QR or URL + code), then background it once so the App Group mirror runs.
2. From Instagram, share a reel to **Doubletake**: the card shows the URL; add a note, pick a
   mode, Send. Within a second the item appears in the app's chat list with channel
   `ios_share` (Settings → Devices shows the phone's last-seen time updating).
3. Share plain text from Notes: the text preview shows and the item is created as text.
4. Unpair (Settings → Devices → revoke, then clear the app's data or reinstall), share again:
   the app opens on the pairing screen; after pairing, the compose sheet appears pre-filled.
5. Share a photo alone: the orange notice appears and only the note is sent.
6. Remove the **unverified** markers here, in ADR 0027, `Pairing.swift` and
   `ShareViewController.swift`, and note the iOS version tested.
