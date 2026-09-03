#!/usr/bin/env bash
# Checks that the local toolchain and data directories Doubletake expects are present.
# Prints a fix for anything missing. Exit code = number of missing required tools.
set -u
missing=0
need() { # name min-version-hint fix
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ✓ %-10s %s\n' "$1" "$($1 --version 2>&1 | head -1)"
  else
    printf '  ✗ %-10s MISSING — %s\n' "$1" "$3"; missing=$((missing+1))
  fi
}
opt() {
  if command -v "$1" >/dev/null 2>&1; then printf '  ✓ %-10s %s\n' "$1" "$($1 --version 2>&1 | head -1)"
  else printf '  · %-10s not found (optional) — %s\n' "$1" "$2"; fi
}
echo "Required:"
need node   ">=22" "install via fnm/nvm: https://nodejs.org"
need pnpm   ">=10" "npm i -g pnpm@10 (or corepack enable)"
need uv     ""     "brew install uv"
need ffmpeg ""     "brew install ffmpeg  /  apt install ffmpeg"
need git    ""     "brew install git"
echo "Optional (needed by specific milestones):"
opt gh        "brew install gh (repo automation)"
opt tailscale "brew install tailscale (default network path, DEPLOYMENT.md)"
opt cloudflared "brew install cloudflared (public webhook tunnel alternative)"
opt java      "JDK 21 for apps/mobile (Android Studio's JBR: export JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\")"
opt adb       "Android platform-tools (apps/mobile; export ANDROID_HOME=~/Library/Android/sdk)"
echo "Directories:"
for d in "${DOUBLETAKE_DATA_DIR:-$HOME/.doubletake}" "${DOUBLETAKE_NOTES_DIR:-$HOME/Doubletake}"; do
  if [ -d "$d" ]; then echo "  ✓ $d"; else echo "  · $d will be created on first run"; fi
done
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 22 ] || { echo "  ✗ node $major too old, need >=22"; missing=$((missing+1)); }
fi
echo
[ "$missing" -eq 0 ] && echo "All required tools present." || echo "$missing required tool(s) missing."
exit "$missing"
