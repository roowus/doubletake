# Deployment

Target: the laptop you already use, running 24/7 as a user service.

## Install
```sh
git clone https://github.com/roowus/doubletake ~/projects/doubletake && cd ~/projects/doubletake
scripts/doctor.sh                 # node 22, pnpm 10, uv, ffmpeg (+ optional tailscale, gh, java, adb)
cp .env.example .env              # at minimum: brain credentials
pnpm install && (cd workers/media && uv sync)
pnpm dev                          # first run creates ~/.doubletake and asks for the owner password
```

## Development
`pnpm dev` (= `scripts/dev.sh`) loads `.env`, starts the server with `tsx watch` on
`DOUBLETAKE_PORT` (default 7391) and the Vite dev server on 5173 with `/api` (including the
WebSocket) proxied to the server. Open http://127.0.0.1:5173 for hot reload, or build the PWA
with `pnpm --filter @doubletake/web build` and open the server port directly: the server serves
`apps/web/dist` at `/` whenever that folder exists (`DOUBLETAKE_WEB_DIST` overrides the path).

Server environment (all optional, see `.env.example`): `DOUBLETAKE_DATA_DIR`,
`DOUBLETAKE_NOTES_DIR`, `DOUBLETAKE_READ_ROOTS`, `DOUBLETAKE_READ_DENY`, `DOUBLETAKE_BIND`,
`DOUBLETAKE_PORT`, `DOUBLETAKE_PUBLIC_URL`, `DOUBLETAKE_WEB_DIST`, `DOUBLETAKE_LOG_LEVEL`,
`DOUBLETAKE_BRAIN`, `DOUBLETAKE_BRAIN_MODEL`, `DOUBLETAKE_DAILY_CAP_USD`.

## Run as a service
`scripts/install-service.sh` (M1) writes:

- **macOS**: `~/Library/LaunchAgents/com.roowus.doubletake.plist` with `KeepAlive`, `RunAtLoad`,
  logs to `~/.doubletake/logs/`. The absolute node path is resolved at install time; never rely
  on `process.execPath` from inside the plist because version managers shim it.
- **Linux**: `~/.config/systemd/user/doubletake.service` with `Restart=always`, plus
  `loginctl enable-linger $USER` so it runs without a login session.

## Keep the machine awake
- macOS: the server calls `caffeinate -i` (via a child process, not a brain tool) for the
  duration of a run; for always-on set `sudo pmset -a sleep 0` or use Amphetamine. Lid-closed
  operation needs power connected.
- Linux: `systemd-inhibit` around runs; disable suspend in the power settings for always-on.
The queue is in SQLite, so a sleep in the middle of a run only delays it; the run resumes on wake.

## Network

### Clients (default: Tailscale)
```sh
tailscale serve --bg --https=443 http://127.0.0.1:7391
```
Gives `https://<machine>.<tailnet>.ts.net` with a valid certificate. Set that as
`DOUBLETAKE_PUBLIC_URL` (used in QR pairing and push deep links). Install Tailscale on the
phone and desktop.

### Push notifications
- **Web Push** works out of the box: the server generates a VAPID key pair on first boot and
  keeps it in the database ([ADR 0016](adr/0016-push-keys-and-fcm-http-v1.md)). Set
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` only if you want to bring your own pair (for example
  when restoring onto a new machine and keeping browser subscriptions alive). Browsers require
  HTTPS for push, which `tailscale serve` provides. Enable it per browser in Settings →
  Notifications, then **Send test**.
- **FCM (Android app)**: create a Firebase project, add an Android app with the Capacitor
  `appId`, put `google-services.json` in `apps/mobile/android/app/` (git-ignored), generate a
  service-account key (Project settings → Service accounts) and point
  `FCM_SERVICE_ACCOUNT_PATH` at the JSON. The boot log prints `push: webpush+fcm` when both
  are active; `FCM disabled: …` explains a missing or malformed file.
- **FCM from the CLI** (what the dev setup used; no Firebase console needed):
  ```sh
  npm i -g firebase-tools && firebase login          # non-TTY shells fall back to a paste-the-code flow
  firebase projects:create <project-id> --display-name Doubletake --non-interactive
  firebase apps:create ANDROID Doubletake --package-name com.roowus.doubletake --project <project-id> --non-interactive
  firebase apps:sdkconfig ANDROID --project <project-id> --out apps/mobile/android/app/google-services.json
  gcloud auth login
  gcloud iam service-accounts keys create ~/.doubletake/fcm-service-account.json \
    --iam-account firebase-adminsdk-fbsvc@<project-id>.iam.gserviceaccount.com --project <project-id>
  chmod 600 ~/.doubletake/fcm-service-account.json
  ```
  Firebase creates the `firebase-adminsdk-fbsvc@…` service account itself; the key is a
  secret, keep it out of the repo (`~/.doubletake` is not a read root for the brain either).
  Rebuild the APK after `google-services.json` lands. Gotcha on macOS: the Homebrew
  `gcloud-cli` cask failed here (missing `virtualenv`, then a broken `pyexpat` in
  `python@3.14`); the tarball install to `~/google-cloud-sdk` works with
  `CLOUDSDK_PYTHON` pointed at a Python 3.10–3.13 (system Python 3.9 is unsupported).
  `gcloud auth login --no-launch-browser` cannot take the code from a non-TTY shell; run the
  browser flow from a real terminal.
- Subscriptions that the push service reports as gone, or that fail 8 times in a row, are
  removed automatically; the client re-subscribes on next open.
- **Quiet hours** ([ADR 0020](adr/0020-quiet-hours-digest.md)): Settings → Notifications →
  Quiet hours. Inside the window nothing is sent (devices and owner channels alike); when it
  ends, one digest ("3 answers ready") arrives within a minute. **Send now** pushes the digest
  early. The window is stored server-side with an explicit time zone, so set it to the phone's.
- **ntfy** ([ADR 0019](adr/0019-owner-notification-channels.md)): set `NTFY_TOPIC` (and
  `NTFY_URL` for a self-hosted server, `NTFY_TOKEN` for a protected topic) and subscribe to the
  topic in the ntfy app. Every finished/failed/capped run publishes a message whose **Click**
  action opens the chat (needs `DOUBLETAKE_PUBLIC_URL`). Pick a long random topic name: on
  ntfy.sh anyone who guesses it can read it. Settings → Notifications → **Send test to
  channels** exercises it.
- **Telegram** (**unverified** against the live Bot API; covered by tests with a fake `fetch`):
  create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN`, send the bot one message, read your
  chat id from `https://api.telegram.org/bot<token>/getUpdates` (`message.chat.id`) and set
  `TELEGRAM_CHAT_ID`. Messages carry an inline **Open chat** button when the server has a
  public URL. Both channels are owner-level: no device subscription, no toggle in the UI,
  failures are logged (`… notification failed: …`) and never disable the channel.

### Map view geocoder
The map ([ADR 0022](adr/0022-map-view-place-geocoding.md)) locates saved places with the public
OpenStreetMap Nominatim service by default (one request per new place, 1 s apart, results
cached in the database). Set `GEOCODER_EMAIL` to a contact address as Nominatim's usage
policy asks, point `GEOCODER_URL` at a self-hosted Nominatim or Photon-compatible instance to
keep place names off the public service, or set `GEOCODER=off` to send nothing (the map then
shows only places the brain located). Map tiles are fetched by the browser from
`tile.openstreetmap.org`; the server never proxies them. After upgrading, open **Map** and
press **Locate N more** once to geocode places saved earlier.

### Instagram webhook (public, one path)
Pick one:
- **Cloudflare Tunnel**: `cloudflared tunnel create doubletake`, route a hostname, config
  `ingress: - hostname: hook.example.com path: ^/webhooks/instagram service: http://127.0.0.1:7391`
  then `- service: http_status:404`. Set `DOUBLETAKE_WEBHOOK_PUBLIC_HOST=hook.example.com`.
- **Tailscale Funnel**: `tailscale funnel --bg --set-path=/webhooks/instagram http://127.0.0.1:7391/webhooks/instagram`
  and set `DOUBLETAKE_WEBHOOK_PUBLIC_HOST=<machine>.<tailnet>.ts.net`.

The server rejects any non-webhook route whose `Host` equals `DOUBLETAKE_WEBHOOK_PUBLIC_HOST`.

## Backups
Copy `~/.doubletake` (stop the service first or use `sqlite3 .backup`) and `~/Doubletake`.
Restore = copy back. Secrets need the same owner password.

## Upgrades
`git pull && pnpm install && (cd workers/media && uv sync) && pnpm build`, restart the service.
Migrations run on start. Breaking changes are listed in `CHANGELOG.md` (from M1). The
server registers the web bundle's hashed files at boot, so rebuilding `apps/web` without a
restart leaves the new `index.html` pointing at files the running server does not know; they
answer 404 (never `index.html`) until you restart.

## Windows
Runs under WSL2 with the Linux instructions; native Windows is untested.
