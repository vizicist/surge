@echo off
rem ===========================================================================
rem  build_wam.bat - build the WAM (Web Audio Module) flavor of Surge XT.
rem
rem  Compiles the same headless SurgeBridge binding as build_wasm.bat, but linked
rem  for an AudioWorkletGlobalScope (ENVIRONMENT=web,worker) so Surge's DSP runs
rem  inside the WAM's AudioWorkletProcessor. Emits surge-wam-dsp.js + .wasm next
rem  to the hand-written WAM sources under wasm\web (which get copied into
rem  wasm\wam for serving).
rem
rem  Reuses the build_wasm\ CMake tree if it already exists, so surge-common is
rem  not recompiled from scratch - run build_wasm.bat first for the fast path.
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

rem --- configure the build tree if it isn't there yet (same flags as build_wasm) ---
if not exist "build_wasm\build.ninja" (
  echo Configuring build_wasm\ ...
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
) else (
  rem tree already exists - reconfigure so the surgewam target is picked up
  echo Reusing existing build_wasm\ tree ^(reconfiguring for the surgewam target^) ...
  cmake -B build_wasm >nul
  if errorlevel 1 (
    echo.
    echo RECONFIGURE FAILED.
    exit /b 1
  )
)

rem --- build the WAM DSP module ---------------------------------------------
echo Building surgewam ...
cmake --build build_wasm --target surgewam
if errorlevel 1 (
  echo.
  echo BUILD FAILED.
  exit /b 1
)

rem --- publish the DSP artifacts next to the WAM sources --------------------
copy /y "build_wasm\wam\surge-wam-dsp.js"   "wasm\wam\surge-wam-dsp.js"   >nul
copy /y "build_wasm\wam\surge-wam-dsp.wasm" "wasm\wam\surge-wam-dsp.wasm" >nul

echo.
echo === WAM build complete ===
echo   wasm\wam\surge-wam-dsp.js
echo   wasm\wam\surge-wam-dsp.wasm
echo.
echo This DSP module backs both WAM hosts (synth + effects). To try them:
echo   run_wam.cmd     ^(synth  -^> /wasm/wam/host.html^)
echo   run_wamfx.cmd   ^(effects -^> /wasm/wam-fx/host.html^)
endlocal
