#!/usr/bin/env bash
# ===========================================================================
#  build_wasm.sh - rebuild the WebAssembly version of Surge XT from scratch.
#                  macOS / Linux counterpart of build_wasm.bat.
#
#  Compiles the headless engine (no JUCE/GUI, no LuaJIT) plus the embind
#  binding into wasm/web/surge.js + surge.wasm, ready to serve with the demo
#  page at wasm/web/index.html.
#
#  Requirements: CMake, Ninja, and the Emscripten SDK. Override the SDK's
#  location with EMSDK; if none is found, Git is used to install it. Set
#  EMSDK_AUTO_INSTALL=0 to disable auto-installation.
# ===========================================================================
set -euo pipefail

# --- run from the repo root (this script's directory) ---
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# --- locate (and, if needed, install) the Emscripten SDK ---
# shellcheck disable=SC1091
. "scripts/mac/setup-emsdk.sh"

if ! command -v cmake >/dev/null 2>&1; then
  echo "ERROR: cmake not found on PATH. Install CMake and retry." >&2
  exit 1
fi
if ! command -v ninja >/dev/null 2>&1; then
  echo "ERROR: ninja not found on PATH. Install Ninja (e.g. 'brew install ninja')" >&2
  echo "       and retry." >&2
  exit 1
fi

# --- clean the build tree for a from-scratch build ---
if [ -d "build_wasm" ]; then
  echo "Removing existing build_wasm/ ..."
  rm -rf "build_wasm"
fi

# --- configure ------------------------------------------------------------
#  SKIP_JUCE_FOR_RACK : engine only (no JUCE, no plugin targets)
#  SKIP_LUA           : LuaJIT cannot target wasm32
#  BUILD_32BIT_LINUX  : wasm32 has 4-byte pointers (passes the bitness guard)
#  SKIP_WERROR        : Emscripten is Clang; -Werror trips on new-platform warnings
#  ZSTD_BUILD_SHARED  : as a cache var so zstd's option() honors it (avoids a
#                       duplicate libzstd.a rule under Emscripten)
echo "Configuring ..."
"$EMSDK_EMCMAKE" cmake -G Ninja -B build_wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DSURGE_BUILD_WASM=TRUE \
  -DSURGE_SKIP_JUCE_FOR_RACK=TRUE \
  -DSURGE_SKIP_LUA=TRUE \
  -DSURGE_SKIP_ODDSOUND_MTS=FALSE \
  -DSURGE_BUILD_32BIT_LINUX=ON \
  -DSURGE_SKIP_WERROR=TRUE \
  -DENABLE_LTO=FALSE \
  -DBUILD_TESTING=OFF \
  -DSURGE_BUILD_TESTRUNNER=OFF \
  -DZSTD_BUILD_SHARED=OFF \
  -DZSTD_BUILD_STATIC=ON

# --- build ----------------------------------------------------------------
echo "Building surgewasm ..."
cmake --build build_wasm --target surgewasm

# --- publish artifacts next to the demo page ------------------------------
cp -f "build_wasm/web/surge.js"   "wasm/web/surge.js"
cp -f "build_wasm/web/surge.wasm" "wasm/web/surge.wasm"

echo
echo "=== WASM build complete ==="
echo "  wasm/web/surge.js"
echo "  wasm/web/surge.wasm"
echo
echo "To run the demo:  ./run_wasm.sh"
echo "  (serves the repo root and opens /wasm/web/index.html)"
