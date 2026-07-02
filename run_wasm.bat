@echo off
rem ===========================================================================
rem  run_wasm.bat - serve the Surge XT WebAssembly demo and open it in a browser.
rem
rem  Serves the REPO ROOT (not just wasm\web) because the demo page fetches the
rem  factory / 3rd-party patch .fxp files from resources\data\... on demand.
rem  The server runs in its own window; close that window to stop it.
rem
rem  Usage:  run_wasm.bat [port]     (default port 8777)
rem  Override the emsdk location by setting EMSDK before running.
rem ===========================================================================
setlocal enableextensions

cd /d "%~dp0"

set "PORT=8777"
if not "%~1"=="" set "PORT=%~1"

rem --- make sure the demo has actually been built ---
if not exist "wasm\web\surge.wasm" (
  echo WARNING: wasm\web\surge.wasm not found - run build_wasm.bat first,
  echo          otherwise the page will load but produce no sound.
  echo.
)

rem --- find a Python to serve with (http.server sets the right wasm MIME type) ---
if "%EMSDK%"=="" set "EMSDK=C:\Users\tjt\GitHub\emsdk"
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

set "URL=http://localhost:%PORT%/wasm/web/index.html"

echo Serving %CD% at http://localhost:%PORT%/
echo Opening %URL%
echo (Close the "surge-wasm-server" window to stop the server.)
echo.

rem --- start the static server in its own window (serves the repo root) ---
start "surge-wasm-server" "%PY%" -m http.server %PORT% --directory "%~dp0."

rem --- give it a moment to bind, then open the demo in the default browser ---
ping -n 3 127.0.0.1 >nul
start "" "%URL%"

endlocal
