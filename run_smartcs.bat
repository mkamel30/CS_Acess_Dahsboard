@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS Dashboard - Central Operations System
color 0a

cd /d "%~dp0"

echo =======================================================================
echo    SmartCS Dashboard - Central Operations and Maintenance Engine
echo =======================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js (v18+) from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Clear port 8970 if already occupied by a previous dead process
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8970" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)

:: Open browser
start "" "http://localhost:8970"

:loop
echo.
echo =======================================================================
echo  [+] Local Host Access   : http://localhost:8970
echo  [+] Server is ACTIVE. Keep this window OPEN.
echo  [+] Press Ctrl+C in this window to stop the server.
echo =======================================================================
echo.

node server.js

echo.
echo =======================================================================
echo [WARNING] Server process exited with code %errorlevel%!
echo Restarting server automatically in 3 seconds...
echo (If you want to close the server, close this window or press Ctrl+C)
echo =======================================================================
timeout /t 3 /nobreak >nul
goto loop
