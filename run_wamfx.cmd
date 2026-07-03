@echo off
rem ===========================================================================
rem  run_wamfx.cmd - serve Surge XT and open the WAM effects host directly.
rem
rem  Thin wrapper over run_server.bat that always opens /wasm/wam-fx/host.html.
rem  Usage:  run_wamfx.cmd [port]     (default port 8777)
rem ===========================================================================
setlocal
set "PORT=8777"
if not "%~1"=="" set "PORT=%~1"
call "%~dp0run_server.bat" %PORT% wamfx
endlocal
