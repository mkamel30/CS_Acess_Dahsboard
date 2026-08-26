@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS Dashboard - Central Operations System
color 0b

echo =======================================================================
echo    SmartCS Dashboard - Central Operations and Maintenance Engine
echo =======================================================================
echo.

cd /d "%~dp0"

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js (v18+) from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Auto-Update from GitHub via Node updater
node updater.js update-silent 2>nul

:: 3. Launch Browser
start "" "http://localhost:8970"

:: 4. Start Server with Auto-Restart Resiliency Loop
:run_server
echo.
echo =======================================================================
echo  [+] Local Host Access   : http://localhost:8970
echo  [+] Press Ctrl+C to stop the server
echo =======================================================================
echo.

node server.js

echo.
echo [!] Server process ended. Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto run_server
