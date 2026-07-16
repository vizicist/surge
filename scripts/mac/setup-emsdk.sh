# Locate an existing Emscripten SDK, or install one when none is available.
# This file is meant to be SOURCED (". scripts/mac/setup-emsdk.sh") so the
# activated environment (emcc/emcmake on PATH, EMSDK_EMCMAKE) survives.
#
# On success it sets:
#   EMSDK          - the emsdk checkout root
#   EMSDK_EMCMAKE  - absolute path to emcmake
# and returns 0. On failure it prints an error and returns 1.

# --- helper: fail without killing the caller's shell when sourced ---
_emsdk_fail() { echo "$@" >&2; return 1; }

EMSDK_EMCMAKE=""

# 1) Honor an explicit EMSDK if it points at a real checkout.
if [ -n "${EMSDK:-}" ] && [ -f "$EMSDK/emsdk_env.sh" ]; then
  :
elif [ -n "${EMSDK:-}" ]; then
  echo "WARNING: EMSDK points to an invalid checkout: \"$EMSDK\"" >&2
  EMSDK=""
fi

# 2) An activated SDK puts emcmake on PATH. Derive the checkout root from it.
if [ -z "${EMSDK:-}" ]; then
  _emcmake_on_path="$(command -v emcmake 2>/dev/null || true)"
  if [ -n "$_emcmake_on_path" ]; then
    # emcmake lives at <emsdk>/upstream/emscripten/emcmake
    _cand="$(cd "$(dirname "$_emcmake_on_path")/../.." 2>/dev/null && pwd)"
    if [ -n "$_cand" ] && [ -f "$_cand/emsdk_env.sh" ]; then
      EMSDK="$_cand"
    fi
  fi
fi

# 3) Check the locations used by emsdk's docs and this project's conventions.
if [ -z "${EMSDK:-}" ]; then
  for _i in \
    "$HOME/emsdk" \
    "$HOME/GitHub/emsdk" \
    "$HOME/Github/emsdk" \
    "$HOME/github/emsdk" \
    "$HOME/source/repos/emsdk" \
    "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd)/../emsdk"
  do
    if [ -z "${EMSDK:-}" ] && [ -f "$_i/emsdk_env.sh" ]; then
      EMSDK="$(cd "$_i" && pwd)"
    fi
  done
fi

# 4) Install it (unless disabled) when still not found.
if [ -z "${EMSDK:-}" ]; then
  if [ "${EMSDK_AUTO_INSTALL:-1}" = "0" ]; then
    echo "ERROR: Emscripten SDK was not found." >&2
    echo "       Set EMSDK, install emsdk, or remove EMSDK_AUTO_INSTALL=0 to allow" >&2
    echo "       this build to install it automatically." >&2
    return 1 2>/dev/null || exit 1
  fi
  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: Emscripten SDK was not found, and Git is required to install it." >&2
    echo "       Install Git or set EMSDK to an existing emsdk checkout." >&2
    return 1 2>/dev/null || exit 1
  fi
  EMSDK="$HOME/emsdk"
  echo "Emscripten SDK was not found. Installing it in \"$EMSDK\" ..."
  if ! git clone https://github.com/emscripten-core/emsdk.git "$EMSDK"; then
    echo "ERROR: Failed to clone the Emscripten SDK." >&2
    return 1 2>/dev/null || exit 1
  fi
fi

# 5) Install + activate a toolchain if this checkout has none yet.
if [ ! -x "$EMSDK/upstream/emscripten/emcmake" ]; then
  echo "Installing and activating the latest Emscripten toolchain in \"$EMSDK\" ..."
  ( "$EMSDK/emsdk" install latest ) || { echo "ERROR: emsdk install failed." >&2; return 1 2>/dev/null || exit 1; }
  ( "$EMSDK/emsdk" activate latest ) || { echo "ERROR: emsdk activate failed." >&2; return 1 2>/dev/null || exit 1; }
fi

# 6) Put emcc/emcmake on PATH for this process.
# shellcheck disable=SC1091
. "$EMSDK/emsdk_env.sh" >/dev/null 2>&1 || {
  echo "ERROR: Failed to activate the Emscripten SDK at \"$EMSDK\"." >&2
  return 1 2>/dev/null || exit 1
}

if [ -x "$EMSDK/upstream/emscripten/emcmake" ]; then
  EMSDK_EMCMAKE="$EMSDK/upstream/emscripten/emcmake"
else
  EMSDK_EMCMAKE="$(command -v emcmake 2>/dev/null || true)"
fi
if [ -z "$EMSDK_EMCMAKE" ]; then
  echo "ERROR: emcmake was not found after activating \"$EMSDK\"." >&2
  return 1 2>/dev/null || exit 1
fi

export EMSDK EMSDK_EMCMAKE
echo "Using Emscripten SDK at \"$EMSDK\"."
