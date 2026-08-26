@echo off
chcp 65001 >nul
title SmartCS Central Operations - Automated 1-Click Installer
color 0b

echo =======================================================================
echo    🚀 SmartCS Central Operations - Zero-Touch Automated Installer
echo =======================================================================
echo.
echo [*] Initializing automated setup for this machine...
echo.

:: Target Installation Directory (Default: C:\SmartCS)
set "TARGET_DIR=C:\SmartCS"
if not exist "C:\" set "TARGET_DIR=%USERPROFILE%\SmartCS"

echo [*] Target Installation Directory: %TARGET_DIR%
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%" 2>nul
)

:: -------------------------------------------------------------------------
:: 1. CHECK / INSTALL GIT (via winget or fallback)
:: -------------------------------------------------------------------------
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git is not found. Attempting automated installation via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Installing Git silently via winget...
        winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements --silent
        call RefreshEnv.cmd >nul 2>nul
    )
)

:: -------------------------------------------------------------------------
:: 2. CHECK / INSTALL NODE.JS (via winget or fallback)
:: -------------------------------------------------------------------------
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js is not found. Attempting automated installation via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Installing Node.js LTS silently via winget...
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements --silent
        call RefreshEnv.cmd >nul 2>nul
    ) else (
        echo [*] Downloading Node.js LTS standalone installer via PowerShell...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$msi = [System.IO.Path]::Combine($env:TEMP, 'node_setup.msi'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile $msi; Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn', '/norestart' -Wait"
    )
)

:: Refresh PATH in current cmd session
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"

:: -------------------------------------------------------------------------
:: 3. DOWNLOAD & DEPLOY APPLICATION CODE FROM GITHUB
:: -------------------------------------------------------------------------
echo.
echo [*] Downloading and preparing latest SmartCS files from GitHub...

where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist "%TARGET_DIR%\.git" (
        echo [*] Existing Git repository detected in %TARGET_DIR%. Fetching latest updates...
        cd /d "%TARGET_DIR%"
        git fetch --prune origin main
        git reset --hard origin/main
    ) else (
        echo [*] Cloning repository into %TARGET_DIR%...
        git clone https://github.com/mkamel30/CS_Acess_Dahsboard.git "%TARGET_DIR%"
        cd /d "%TARGET_DIR%"
    )
) else (
    echo [*] Git unavailable. Downloading repository zip archive via PowerShell...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$zip = [System.IO.Path]::Combine($env:TEMP, 'smartcs_latest.zip'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $env:TEMP\smartcs_extract -Force; Copy-Item -Path $env:TEMP\smartcs_extract\CS_Acess_Dahsboard-main\* -Destination '%TARGET_DIR%' -Recurse -Force; Remove-Item -Path $zip, $env:TEMP\smartcs_extract -Recurse -Force"
    cd /d "%TARGET_DIR%"
)

:: -------------------------------------------------------------------------
:: 4. CONFIGURE DATABASE & AUTO-SYNC ENVIRONMENT
:: -------------------------------------------------------------------------
echo.
echo [*] Setting up environment and database connections...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfgPath = Join-Path '%TARGET_DIR%' 'config.json'; $accessShare = '\\Share\d\gROCER SUPPORT\0 Gro.Support\DB\BRrelease\BE\Bread_Final_be.accdb'; $hasAccess = Test-Path $accessShare; $cfg = @{ port = 8970; syncSecret = 'smartcs-cloud-secret-2026'; accessDbPath = if ($hasAccess) { $accessShare } else { '' }; vpsSyncUrl = 'https://smartcs.m-kamel.workers.dev' }; $cfg | ConvertTo-Json -Depth 4 | Set-Content $cfgPath -Encoding UTF8; if ($hasAccess) { Write-Host '  [+] MS Access Network Share detected and connected!' -ForegroundColor Green } else { Write-Host '  [+] Cloud VPS Mode enabled (Direct synchronization with Oracle Cloud).' -ForegroundColor Cyan }"

:: -------------------------------------------------------------------------
:: 5. INSTALL NPM DEPENDENCIES
:: -------------------------------------------------------------------------
echo.
echo [*] Installing production application dependencies...
call npm install --omit=dev --no-audit --no-fund

:: -------------------------------------------------------------------------
:: 6. CREATE DESKTOP SHORTCUT WITH ICON
:: -------------------------------------------------------------------------
echo.
echo [*] Creating Desktop Shortcut (SmartCS Dashboard)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut([System.IO.Path]::Combine($desk, 'SmartCS Dashboard.lnk')); $s.TargetPath = '%TARGET_DIR%\run_smartcs.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

echo.
echo =======================================================================
echo    🎉 Installation Complete! Launching SmartCS Dashboard...
echo =======================================================================
echo.
timeout /t 2 >nul

start "" "%TARGET_DIR%\run_smartcs.bat"
exit /b 0
