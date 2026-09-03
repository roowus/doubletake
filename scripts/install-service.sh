#!/usr/bin/env bash
# Installs Doubletake as a user service (launchd on macOS, systemd --user on Linux).
# Placeholder: the real script lands with M1. Design notes live in docs/DEPLOYMENT.md.
# Rule carried over from other projects: resolve the absolute node path at install time —
# never trust process.execPath from inside a plist, it can point at a version manager shim.
set -euo pipefail
echo "install-service: not implemented yet (see docs/DEPLOYMENT.md)."
exit 1
