# 0007 — One PWA; Capacitor Android with a custom share activity

- Status: accepted
- Date: 2026-09-03

## Context
Targets are Android (owner's phone), macOS and Linux desktops (owner's machines), with iOS
and Windows built but rarely tested. The share sheet must be tiny and fast; booting a WebView
just to post a URL feels slow.

## Decision
Build one React PWA served by the server. Wrap it with Capacitor for Android. Implement the
share target as a native translucent `ShareReceiverActivity` (plain AppCompatActivity, not
BridgeActivity) that shows a compact sheet, posts to `/api/ingest` with the device token, and
finishes without starting the WebView. Desktop uses the installed PWA over Tailscale. The PWA
manifest also declares a Web Share Target for Capacitor-less installs.

## Alternatives considered
- React Native / Flutter: second UI codebase for a one-owner project.
- `@capgo/capacitor-share-target` plugin: viable, but it routes through the WebView and is
  less controllable for the tiny-sheet requirement; kept as a documented fallback.
- Native Android app only: no desktop.

## Consequences
About 50–100 lines of Kotlin to maintain. iOS Share Extension is a separate native piece to
be written later. Capacitor pins us to its Android toolchain: at adoption time Capacitor 7 (JDK
17, SDK 35); M2 shipped on Capacitor 8 (Java 21, compileSdk 36, AGP 8.13), and future major
bumps will move these again.
