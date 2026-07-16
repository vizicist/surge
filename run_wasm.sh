#!/usr/bin/env bash
# ===========================================================================
#  run_wasm.sh - serve Surge XT and open the WebAssembly (WASM) demo page.
#                macOS / Linux counterpart of run_wasm.cmd.
#
#  Thin wrapper over run_server.sh that always opens /wasm/web/index.html.
#  Usage:  ./run_wasm.sh [port]     (default port 8777)
# ===========================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$DIR/run_server.sh" "${1:-8777}" wasm
