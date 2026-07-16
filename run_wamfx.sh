#!/usr/bin/env bash
# ===========================================================================
#  run_wamfx.sh - serve Surge XT and open the WAM effects host.
#                 macOS / Linux counterpart of run_wamfx.cmd.
#
#  Thin wrapper over run_server.sh that always opens /wasm/wam-fx/host.html.
#  Usage:  ./run_wamfx.sh [port]     (default port 8777)
# ===========================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$DIR/run_server.sh" "${1:-8777}" wamfx
