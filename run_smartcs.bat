@echo off
chcp 65001 >nul
title SmartCS Dashboard - Central Operations System
color 0b

echo =======================================================================
echo    🚀 SmartCS Dashboard - Central Operations & Maintenance Engine
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

:: 2. Auto-Update from GitHub (if Git is available)
where git >nul 2>nul
if %errorlevel% equ 0 (
    echo [*] Checking for updates from GitHub...
    git fetch --prune origin main >nul 2>nul
    for /f "tokens=*" %%a in ('git rev-parse HEAD') do set LOCAL_HASH=%%a
    for /f "tokens=*" %%b in ('git rev-parse origin/main') do set REMOTE_HASH=%%b

    if not "%LOCAL_HASH%"=="" if not "%REMOTE_HASH%"=="" (
        if not "%LOCAL_HASH%"=="%REMOTE_HASH%" (
            echo.
            echo [!] 🌟 New updates detected on GitHub!
            echo [*] Applying latest updates automatically...
            git reset --hard origin/main
            echo [*] Updating dependencies...
            call npm install --omit=dev --no-audit --no-fund
            echo [OK] System updated to latest version successfully!
            echo.
        ) else (
            echo [OK] System is up to date with GitHub (Commit: %LOCAL_HASH:~0,7%) ✅
        )
    )
) else (
    echo [*] Git not found in PATH, skipping GitHub update check.
)

:: 3. Launch Browser in Background
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

:: If the server exits (e.g. triggered by in-app auto-update), restart it automatically!
echo.
echo [!] Server process ended. Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto run_server
