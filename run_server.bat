@echo off
rem ===========================================================================
rem  run_server.bat - serve the Surge XT browser builds and open one in a browser.
rem
rem  Serves the REPO ROOT so every front-end works (each fetches factory /
rem  3rd-party patch .fxp files from resources\data\... on demand):
rem     /wasm/web/index.html    - the WebAssembly (WASM) demo    (main-thread engine)
rem     /wasm/wam/host.html     - the WAM synth host             (worklet engine)
rem     /wasm/wam-fx/host.html  - the WAM effects host           (worklet engine)
rem  The server runs in its own window; close that window to stop it.
rem
rem  Usage:  run_server.bat [port] [wasm|wam|wamfx]
rem            port                  static-server port     (default 8777)
rem            wasm | wam | wamfx    which page to open      (default wasm)
rem  Override the emsdk location by setting EMSDK before running.
rem ===========================================================================
setlocal enableextensions

cd /d "%~dp0"

set "PORT=8777"
if not "%~1"=="" set "PORT=%~1"

rem --- pick which front-end to open (default: the WASM demo) ---
set "PAGE=wasm"
if /i "%~2"=="wam" set "PAGE=wam"
if /i "%~2"=="wamfx" set "PAGE=wamfx"
if /i "%PAGE%"=="wam" ( set "OPENPATH=/wasm/wam/host.html"
) else if /i "%PAGE%"=="wamfx" ( set "OPENPATH=/wasm/wam-fx/host.html"
) else ( set "OPENPATH=/wasm/web/index.html" )

rem --- warn if the relevant build artifact is missing ---
if /i "%PAGE%"=="wasm" (
  if not exist "wasm\web\surge.wasm" (
    echo WARNING: wasm\web\surge.wasm not found - run build_wasm.bat first,
    echo          otherwise the demo will load but produce no sound.
    echo.
  )
) else (
  rem both WAM hosts share the same DSP module under wasm\wam\
  if not exist "wasm\wam\surge-wam-dsp.wasm" (
    echo WARNING: wasm\wam\surge-wam-dsp.wasm not found - run build_wam.bat first,
    echo          otherwise the WAM host will load but produce no sound.
    echo.
  )
)

rem --- find a Python to serve with (http.server sets the right wasm MIME type) ---
if "%EMSDK%"=="" set "EMSDK=%USERPROFILE%\GitHub\emsdk"
set "PY="
if exist "%EMSDK%\python" (
  for /d %%d in ("%EMSDK%\python\*") do if exist "%%d\python.exe" set "PY=%%d\python.exe"
)
if not defined PY where py     >nul 2>&1 && set "PY=py"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo ERROR: no Python found. Set EMSDK to your emsdk checkout ^(it bundles Python^),
  echo        or install Python and put it on PATH.
  exit /b 1
)

set "URL=http://localhost:%PORT%%OPENPATH%"

echo Serving %CD% at http://localhost:%PORT%/
echo   WASM demo:    http://localhost:%PORT%/wasm/web/index.html
echo   WAM synth:    http://localhost:%PORT%/wasm/wam/host.html
echo   WAM effects:  http://localhost:%PORT%/wasm/wam-fx/host.html
echo Opening %URL%
echo (Close the "surge-server" window to stop the server.)
echo.

rem --- start the static server in its own window (serves the repo root) ---
start "surge-server" "%PY%" -m http.server %PORT% --directory "%~dp0."

rem --- give it a moment to bind, then open the chosen page in the default browser ---
ping -n 3 127.0.0.1 >nul
start "" "%URL%"

endlocal
