@echo off
rem Double-click to play +1 Speed Go Kart Escape locally: installs what's missing, builds the client,
rem starts the game server on http://localhost:2597 and opens the browser once the server answers.
rem Close this window to stop the server.
setlocal
title +1 Speed Go Kart Escape - local server
cd /d "%~dp0"
set PORT=2597

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed. Install Node 20 or newer from https://nodejs.org and try again.
    goto :fail
)

netstat -ano | findstr /c:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
    echo Port %PORT% is already in use - opening http://localhost:%PORT% ...
    start "" http://localhost:%PORT%
    goto :end
)

if not exist "server\node_modules" call npm --prefix server install || goto :fail
if not exist "client\node_modules" call npm --prefix client install || goto :fail
echo Building the game...
call npm run build || goto :fail

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:%PORT%/health | Out-Null; Start-Process 'http://localhost:%PORT%'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo Starting the server on http://localhost:%PORT% ...
call npm start
echo.
echo The server stopped.
goto :end

:fail
echo.
echo Could not start the game. See the messages above.
:end
pause
