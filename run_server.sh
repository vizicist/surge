#!/usr/bin/env bash
# ===========================================================================
#  run_server.sh - serve the Surge XT browser builds and open one in a browser.
#                  macOS / Linux counterpart of run_server.bat.
#
#  Serves the REPO ROOT so every front-end works (each fetches factory /
#  3rd-party patch .fxp files from resources/data/... on demand):
#     /wasm/web/index.html    - the WebAssembly (WASM) demo    (main-thread engine)
#     /wasm/wam/host.html     - the WAM synth host             (worklet engine)
#     /wasm/wam-fx/host.html  - the WAM effects host           (worklet engine)
#
#  Usage:  ./run_server.sh [port] [wasm|wam|wamfx]
#            port                  static-server port     (default 8777)
#            wasm | wam | wamfx    which page to open      (default wasm)
# ===========================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

PORT="${1:-8777}"
PAGE="${2:-wasm}"

case "$PAGE" in
  wam)   OPENPATH="/wasm/wam/host.html" ;;
  wamfx) OPENPATH="/wasm/wam-fx/host.html" ;;
  *)     OPENPATH="/wasm/web/index.html" ;;
esac

# --- warn if the relevant build artifact is missing ---
if [ "$PAGE" = "wasm" ]; then
  if [ ! -f "wasm/web/surge.wasm" ]; then
    echo "WARNING: wasm/web/surge.wasm not found - run ./build_wasm.sh first,"
    echo "         otherwise the demo will load but produce no sound."
    echo
  fi
else
  # both WAM hosts share the same DSP module under wasm/wam/
  if [ ! -f "wasm/wam/surge-wam-dsp.wasm" ]; then
    echo "WARNING: wasm/wam/surge-wam-dsp.wasm not found - run ./build_wam.sh first,"
    echo "         otherwise the WAM host will load but produce no sound."
    echo
  fi
fi

# --- find a Python to serve with (http.server sets the right wasm MIME type) ---
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"
elif command -v python >/dev/null 2>&1; then PY="python"
else
  echo "ERROR: no Python found. Install Python 3 and put it on PATH." >&2
  exit 1
fi

URL="http://localhost:${PORT}${OPENPATH}"

echo "Serving $(pwd) at http://localhost:${PORT}/"
echo "  WASM demo:    http://localhost:${PORT}/wasm/web/index.html"
echo "  WAM synth:    http://localhost:${PORT}/wasm/wam/host.html"
echo "  WAM effects:  http://localhost:${PORT}/wasm/wam-fx/host.html"
echo "Opening ${URL}"
echo "(Press Ctrl-C to stop the server.)"
echo

# --- open the chosen page once the server is up, then serve in the foreground ---
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" # Linux
  fi ) &

exec "$PY" -m http.server "$PORT" --directory "$(pwd)"
