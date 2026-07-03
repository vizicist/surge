@echo off
rem ===========================================================================
rem  run_wasm.cmd - serve Surge XT and open the WebAssembly (WASM) demo directly.
rem
rem  Thin wrapper over run_server.bat that always opens /wasm/web/index.html.
rem  Usage:  run_wasm.cmd [port]     (default port 8777)
rem ===========================================================================
setlocal
set "PORT=8777"
if not "%~1"=="" set "PORT=%~1"
call "%~dp0run_server.bat" %PORT% wasm
endlocal
