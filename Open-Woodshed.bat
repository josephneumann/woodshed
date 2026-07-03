@echo off
setlocal enableextensions
rem Launch Joe's Guitar Hub. Make a desktop shortcut to this file for one-click access.
rem If the dev server is already running it just opens the browser - no duplicate servers.
cd /d "%~dp0"

rem First run (or fresh clone): install dependencies.
if not exist "node_modules\vite\" (
  echo Installing dependencies, one moment...
  call npm install
)

rem Already running? (something is LISTENING on port 5173) -> just open the browser.
netstat -an | findstr "LISTENING" | findstr /c:":5173 " >nul
if not errorlevel 1 (
  echo Joe's Guitar Hub is already running - opening it in your browser.
  start "" "http://localhost:5173/tools/index.html"
  goto :eof
)

rem Otherwise start the Vite dev server in its own minimized window.
rem Closing that "Guitar Hub server" window is how you stop the app.
start "Guitar Hub server" /min cmd /c "npm run dev"

rem Wait (up to ~30s) for the server to come up before opening the browser.
set /a tries=0
:waitloop
timeout /t 1 /nobreak >nul
netstat -an | findstr "LISTENING" | findstr /c:":5173 " >nul
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% lss 30 goto waitloop
echo Server is taking a while - opening anyway; refresh the page if it is not ready.

:ready
start "" "http://localhost:5173/tools/index.html"
goto :eof
