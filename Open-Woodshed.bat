@echo off
setlocal enableextensions enabledelayedexpansion
title The Woodshed - launcher
rem ============================================================
rem  The Woodshed - one-click launcher.
rem  Double-click this (or its desktop shortcut) to turn the app on.
rem  It starts the local server if needed, then opens your browser.
rem ============================================================
cd /d "%~dp0"

set "URL=http://localhost:5173/tools/index.html"

rem --- already running? just open the browser, no duplicate server ---
netstat -an | findstr /r /c:"TCP.*:5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo The Woodshed is already running - opening it in your browser...
  start "" "%URL%"
  goto :eof
)

rem --- locate npm robustly (Explorer-launched cmd sometimes has a thin PATH) ---
set "NPM="
for %%N in (npm.cmd) do if exist "%%~$PATH:N" set "NPM=%%~$PATH:N"
if not defined NPM if exist "C:\Program Files\nodejs\npm.cmd" set "NPM=C:\Program Files\nodejs\npm.cmd"
if not defined NPM (
  echo.
  echo   Could not find npm / Node.js on this PC.
  echo   Install Node 20+ from https://nodejs.org  then run this again.
  echo.
  pause
  goto :eof
)

rem --- first run / fresh clone: install dependencies (also seeds your workspace) ---
if not exist "node_modules\vite\" (
  echo Installing dependencies - this only happens once, give it a minute...
  call "%NPM%" install
  if errorlevel 1 (
    echo.
    echo   Dependency install failed - see the messages above.
    pause
    goto :eof
  )
)

rem --- start the dev server in its own window (this window IS the server;
rem     close it to stop the app). /k keeps it open so any error stays visible. ---
echo Starting The Woodshed server...
start "The Woodshed server" cmd /k "title The Woodshed server  &&  cd /d "%~dp0"  &&  "%NPM%" run dev"

rem --- wait up to ~30s for the server to come up, then open the browser ---
set /a tries=0
:waitloop
timeout /t 1 /nobreak >nul
netstat -an | findstr /r /c:"TCP.*:5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! lss 30 goto waitloop
echo Server is taking a while - opening anyway; refresh the page if it isn't ready.

:ready
start "" "%URL%"
echo.
echo   The Woodshed is open in your browser.
echo   Leave the "The Woodshed server" window running while you use the app;
echo   close it when you're done to turn the app off.
timeout /t 4 /nobreak >nul
goto :eof
