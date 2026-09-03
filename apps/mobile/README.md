# apps/mobile

Capacitor Android project wrapping the `apps/web` build. Created in **M2** with
`npx cap add android`; until then this folder only holds this note so the layout
in `docs/ARCHITECTURE.md` matches the tree.

Native pieces planned here (see `docs/channels/android-share.md`):

- `ShareReceiverActivity` (Kotlin, translucent, ~50 lines) — the tiny share sheet
- `@capacitor/push-notifications` wiring for FCM
- iOS target scaffolded later, untested until someone with an iPhone picks it up
