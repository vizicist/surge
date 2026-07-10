@echo off
rem Locate an existing Emscripten SDK, or install one when none is available.
rem This file is meant to be invoked with CALL so its environment survives.

set "EMSDK_EMCMAKE="
if defined EMSDK if exist "%EMSDK%\emsdk_env.bat" goto :found
if defined EMSDK echo WARNING: EMSDK points to an invalid checkout: "%EMSDK%"

rem An activated SDK puts emcmake on PATH. Derive the checkout root from it.
rem New emsdk releases provide an .exe; older ones used a .bat launcher.
for /f "delims=" %%i in ('where emcmake 2^>nul') do if not defined EMSDK_FOUND (
  for %%j in ("%%~dpi..\..") do set "EMSDK_FOUND=%%~fj"
)
if defined EMSDK_FOUND if exist "%EMSDK_FOUND%\emsdk_env.bat" (
  set "EMSDK=%EMSDK_FOUND%"
  goto :found
)

rem Check the locations used by emsdk's docs, Visual Studio users, and this
rem project's older build scripts.
for %%i in (
  "%USERPROFILE%\emsdk"
  "%USERPROFILE%\GitHub\emsdk"
  "%USERPROFILE%\Github\emsdk"
  "%USERPROFILE%\source\repos\emsdk"
  "%LOCALAPPDATA%\emsdk"
  "%~dp0..\..\..\emsdk"
) do if not defined EMSDK_FOUND if exist "%%~i\emsdk_env.bat" set "EMSDK_FOUND=%%~fi"

if defined EMSDK_FOUND (
  set "EMSDK=%EMSDK_FOUND%"
  goto :found
)

if /i "%EMSDK_AUTO_INSTALL%"=="0" goto :not_found
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Emscripten SDK was not found, and Git is required to install it.
  echo        Install Git or set EMSDK to an existing emsdk checkout.
  exit /b 1
)

set "EMSDK=%LOCALAPPDATA%\emsdk"
if not defined LOCALAPPDATA set "EMSDK=%USERPROFILE%\emsdk"
echo Emscripten SDK was not found. Installing it in "%EMSDK%" ...
git clone https://github.com/emscripten-core/emsdk.git "%EMSDK%"
if errorlevel 1 (
  echo ERROR: Failed to clone the Emscripten SDK.
  exit /b 1
)

:found
set "EMSDK_FOUND="
if exist "%EMSDK%\upstream\emscripten\emcmake.exe" set "EMSDK_EMCMAKE=%EMSDK%\upstream\emscripten\emcmake.exe"
if exist "%EMSDK%\upstream\emscripten\emcmake.bat" set "EMSDK_EMCMAKE=%EMSDK%\upstream\emscripten\emcmake.bat"
if not defined EMSDK_EMCMAKE (
  echo Installing and activating the latest Emscripten toolchain in "%EMSDK%" ...
  call "%EMSDK%\emsdk.bat" install latest
  if errorlevel 1 exit /b 1
  call "%EMSDK%\emsdk.bat" activate latest
  if errorlevel 1 exit /b 1
)

call "%EMSDK%\emsdk_env.bat" >nul 2>&1
if errorlevel 1 (
  echo ERROR: Failed to activate the Emscripten SDK at "%EMSDK%".
  exit /b 1
)
if exist "%EMSDK%\upstream\emscripten\emcmake.exe" set "EMSDK_EMCMAKE=%EMSDK%\upstream\emscripten\emcmake.exe"
if exist "%EMSDK%\upstream\emscripten\emcmake.bat" set "EMSDK_EMCMAKE=%EMSDK%\upstream\emscripten\emcmake.bat"
if not defined EMSDK_EMCMAKE (
  echo ERROR: emcmake was not found after activating "%EMSDK%".
  exit /b 1
)
echo Using Emscripten SDK at "%EMSDK%".
exit /b 0

:not_found
echo ERROR: Emscripten SDK was not found.
echo        Set EMSDK, install emsdk, or remove EMSDK_AUTO_INSTALL=0 to allow
echo        this build to install it automatically.
exit /b 1
