#!/usr/bin/env bash
# Runs the Doubletake server (tsx watch) and the web dev server (Vite, proxying /api) together.
# The media worker (M3) will be added here once it exists. See docs/DEPLOYMENT.md#development.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

export DOUBLETAKE_PORT="${DOUBLETAKE_PORT:-7391}"
export DOUBLETAKE_API="http://127.0.0.1:${DOUBLETAKE_PORT}"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; }; }
trap cleanup EXIT INT TERM

pnpm --filter @doubletake/server dev & pids+=($!)
pnpm --filter @doubletake/web dev & pids+=($!)

echo "server: ${DOUBLETAKE_API}   web (hot reload): http://127.0.0.1:5173"
wait -n "${pids[@]}" || true
