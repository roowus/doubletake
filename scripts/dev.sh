#!/usr/bin/env bash
# Runs the server, the web dev server, and the media worker together.
# Placeholder until M1 adds the first runnable package; documented in docs/DEPLOYMENT.md.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Doubletake dev: nothing runnable yet (docs-before-code phase)."
echo "M1 will make this start: pnpm --filter @doubletake/server dev  |  pnpm --filter @doubletake/web dev"
