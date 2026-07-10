@echo off
rem ===========================================================================
rem  build_wasm.bat - rebuild the WebAssembly version of Surge XT from scratch.
rem
rem  Compiles the headless engine (no JUCE/GUI, no LuaJIT) plus the embind
rem  binding into wasm\web\surge.js + surge.wasm, ready to serve with the demo
rem  page at wasm\web\index.html.
rem
rem  Requirements: Visual Studio 2022 (for its bundled CMake + Ninja) and the
rem  Emscripten SDK. Override its location with EMSDK; if none is found, Git is
rem  used to install it. Set EMSDK_AUTO_INSTALL=0 to disable auto-installation.
rem ===========================================================================
setlocal enableextensions enabledelayedexpansion

rem --- run from the repo root (this script's directory) ---
cd /d "%~dp0"

rem --- locate (and, if needed, install) the Emscripten SDK ---
call "scripts\win\setup-emsdk.bat"
if errorlevel 1 exit /b 1

rem --- put Visual Studio's CMake + Ninja on PATH (via vswhere) ---
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -property installationPath`) do set "VSINSTALL=%%i"
)
if defined VSINSTALL (
  set "PATH=!VSINSTALL!\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;!VSINSTALL!\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;!PATH!"
)

where cmake >nul 2>&1
if errorlevel 1 (
  echo ERROR: cmake not found on PATH. Install Visual Studio 2022 with the CMake
  echo        component, or add a CMake to PATH, and retry.
  exit /b 1
)

rem --- clean the build tree for a from-scratch build ---
if exist "build_wasm\" (
  echo Removing existing build_wasm\ ...
  rmdir /s /q "build_wasm"
)

rem --- configure ------------------------------------------------------------
rem  SKIP_JUCE_FOR_RACK : engine only (no JUCE, no plugin targets)
rem  SKIP_LUA           : LuaJIT cannot target wasm32
rem  BUILD_32BIT_LINUX  : wasm32 has 4-byte pointers (passes the bitness guard)
rem  SKIP_WERROR        : Emscripten is Clang; -Werror trips on new-platform warnings
rem  ZSTD_BUILD_SHARED  : as a cache var so zstd's option() honors it (avoids a
rem                       duplicate libzstd.a rule under Emscripten)
echo Configuring ...
call "%EMSDK_EMCMAKE%" cmake -G Ninja -B build_wasm ^
  -DCMAKE_BUILD_TYPE=Release ^
  -DSURGE_BUILD_WASM=TRUE ^
  -DSURGE_SKIP_JUCE_FOR_RACK=TRUE ^
  -DSURGE_SKIP_LUA=TRUE ^
  -DSURGE_SKIP_ODDSOUND_MTS=FALSE ^
  -DSURGE_BUILD_32BIT_LINUX=ON ^
  -DSURGE_SKIP_WERROR=TRUE ^
  -DENABLE_LTO=FALSE ^
  -DBUILD_TESTING=OFF ^
  -DSURGE_BUILD_TESTRUNNER=OFF ^
  -DZSTD_BUILD_SHARED=OFF ^
  -DZSTD_BUILD_STATIC=ON
if errorlevel 1 (
  echo.
  echo CONFIGURE FAILED.
  exit /b 1
)

rem --- build ----------------------------------------------------------------
echo Building surgewasm ...
cmake --build build_wasm --target surgewasm
if errorlevel 1 (
  echo.
  echo BUILD FAILED.
  exit /b 1
)

rem --- publish artifacts next to the demo page ------------------------------
copy /y "build_wasm\web\surge.js"   "wasm\web\surge.js"   >nul
copy /y "build_wasm\web\surge.wasm" "wasm\web\surge.wasm" >nul

echo.
echo === WASM build complete ===
echo   wasm\web\surge.js
echo   wasm\web\surge.wasm
echo.
echo To run the demo:  run_wasm.cmd
echo   ^(serves the repo root and opens /wasm/web/index.html^)
endlocal
