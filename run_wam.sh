#!/usr/bin/env bash
# ===========================================================================
#  run_wam.sh - serve Surge XT and open the Web Audio Module (WAM) synth host.
#               macOS / Linux counterpart of run_wam.cmd.
#
#  Thin wrapper over run_server.sh that always opens /wasm/wam/host.html.
#  Usage:  ./run_wam.sh [port]     (default port 8777)
# ===========================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$DIR/run_server.sh" "${1:-8777}" wam
