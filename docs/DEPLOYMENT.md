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
Migrations run on start. Breaking changes are listed in `CHANGELOG.md` (from M1).

## Windows
Runs under WSL2 with the Linux instructions; native Windows is untested.
