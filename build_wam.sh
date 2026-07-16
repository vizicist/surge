#!/usr/bin/env bash
# ===========================================================================
#  build_wam.sh - build the WAM (Web Audio Module) flavor of Surge XT.
#                 macOS / Linux counterpart of build_wam.bat.
#
#  Compiles the same headless SurgeBridge binding as build_wasm.sh, but linked
#  for an AudioWorkletGlobalScope (ENVIRONMENT=web,worker) so Surge's DSP runs
#  inside the WAM's AudioWorkletProcessor. Emits surge-wam-dsp.js + .wasm under
#  build_wasm/wam, then copies them next to the hand-written WAM sources in
#  wasm/wam (which back both the synth and effects hosts).
#
#  Reuses the build_wasm/ CMake tree if it already exists, so surge-common is
#  not recompiled from scratch - run build_wasm.sh first for the fast path.
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

# --- configure the build tree if it isn't there yet (same flags as build_wasm) ---
if [ ! -f "build_wasm/build.ninja" ]; then
  echo "Configuring build_wasm/ ..."
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
else
  # tree already exists - reconfigure so the surgewam target is picked up
  echo "Reusing existing build_wasm/ tree (reconfiguring for the surgewam target) ..."
  cmake -B build_wasm >/dev/null
fi

# --- build the WAM DSP module ---------------------------------------------
echo "Building surgewam ..."
cmake --build build_wasm --target surgewam

# --- publish the DSP artifacts next to the WAM sources --------------------
cp -f "build_wasm/wam/surge-wam-dsp.js"   "wasm/wam/surge-wam-dsp.js"
cp -f "build_wasm/wam/surge-wam-dsp.wasm" "wasm/wam/surge-wam-dsp.wasm"

echo
echo "=== WAM build complete ==="
echo "  wasm/wam/surge-wam-dsp.js"
echo "  wasm/wam/surge-wam-dsp.wasm"
echo
echo "This DSP module backs both WAM hosts (synth + effects). To try them:"
echo "  ./run_wam.sh     (synth   -> /wasm/wam/host.html)"
echo "  ./run_wamfx.sh   (effects -> /wasm/wam-fx/host.html)"
