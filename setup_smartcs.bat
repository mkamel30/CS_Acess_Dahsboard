@echo off
chcp 65001 >nul
title Setup SmartCS Operations on New Machine
color 0a

echo =======================================================================
echo    📦 SmartCS Operations - New PC Automated Setup & Packaging
echo =======================================================================
echo.

cd /d "%~dp0"

:: 1. Verify Node.js
echo [*] Checking Node.js environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found!
    echo Please install Node.js (LTS version) from https://nodejs.org and re-run this setup.
    echo.
    pause
    exit /b 1
)
node -v
echo [OK] Node.js is ready.
echo.

:: 2. Verify Git
echo [*] Checking Git environment...
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Git is not installed or not in PATH.
    echo Note: Installing Git from https://git-scm.com will enable automated GitHub updates.
    echo.
) else (
    git --version
    echo [OK] Git is ready for automatic synchronization.
    echo.
)

:: 3. Install NPM Dependencies
echo [*] Installing required application dependencies...
call npm install --omit=dev --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install npm dependencies.
    pause
    exit /b 1
)
echo [OK] Dependencies installed successfully.
echo.

:: 4. Create Desktop Shortcut via PowerShell
echo [*] Creating Desktop Shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'SmartCS Dashboard.lnk')); $s.TargetPath = '%~dp0run_smartcs.bat'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

:: 5. Enable Automatic Launch on Windows Boot
echo [*] Enabling Automatic Launch on Windows Boot (Startup)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $auto = $ws.CreateShortcut([System.IO.Path]::Combine($startup, 'SmartCS AutoStart.lnk')); $auto.TargetPath = 'wscript.exe'; $auto.Arguments = '\"%~dp0start_background.vbs\"'; $auto.WorkingDirectory = '%~dp0'; $auto.WindowStyle = 7; $auto.Description = 'SmartCS Automated Background Launch on Boot'; $auto.Save()"

if %errorlevel% equ 0 (
    echo [OK] Shortcuts and Auto-Boot configured successfully!
) else (
    echo [!] Could not create shortcuts automatically.
)
echo.

echo =======================================================================
echo    🎉 Setup Completed Successfully! Starting SmartCS Dashboard...
echo =======================================================================
echo.
timeout /t 2 >nul

call "%~dp0run_smartcs.bat"
