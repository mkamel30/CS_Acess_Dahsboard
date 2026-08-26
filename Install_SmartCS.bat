@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS Central Operations - Automated Installer
color 0b

echo =======================================================================
echo    SmartCS Central Operations - Automated Installer
echo =======================================================================
echo.

:: 1. SET CURRENT WORKING FOLDER CONTAINING THIS .BAT FILE
set "TARGET_DIR=%~dp0"
if "%TARGET_DIR:~-1%"=="\" set "TARGET_DIR=%TARGET_DIR:~0,-1%"

cd /d "%TARGET_DIR%"
echo [*] Installation and working directory:
echo     "%TARGET_DIR%"
echo.

:: -------------------------------------------------------------------------
:: 2. PROMPT USER FOR MS ACCESS DATABASE PATH
:: -------------------------------------------------------------------------
set "DEFAULT_ACCESS=\\Share\d\gROCER SUPPORT\0 Gro.Support\DB\BRrelease\BE\Bread_Final_be.accdb"

echo -----------------------------------------------------------------------
echo  Database Configuration (MS Access Backend Path):
echo -----------------------------------------------------------------------
echo  Default Branch Network Path:
echo  "%DEFAULT_ACCESS%"
echo.
echo  Instructions:
echo  - Press [ENTER] to accept the default network path.
echo  - OR type / drag and drop your (.accdb / .mdb) database file here:
echo.
set /p "USER_DB_INPUT= Database Path: "

if "%USER_DB_INPUT%"=="" (
    set "FINAL_DB_PATH=%DEFAULT_ACCESS%"
) else (
    set "FINAL_DB_PATH=%USER_DB_INPUT:"=%"
)

echo.
echo [*] Configured Database Path: "%FINAL_DB_PATH%"
echo.

:: -------------------------------------------------------------------------
:: 3. CHECK / INSTALL GIT (via winget or fallback)
:: -------------------------------------------------------------------------
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git is not installed. Attempting automated installation via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Installing Git silently via winget...
        winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements --silent
    )
)

:: -------------------------------------------------------------------------
:: 4. CHECK / INSTALL NODE.JS (via winget or fallback)
:: -------------------------------------------------------------------------
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js is not installed. Attempting automated installation via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Installing Node.js LTS silently via winget...
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements --silent
    ) else (
        echo [*] Downloading Node.js LTS installer via PowerShell...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$msi = [System.IO.Path]::Combine($env:TEMP, 'node_setup.msi'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile $msi; Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn', '/norestart' -Wait"
    )
)

:: Refresh PATH in current cmd session
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"

:: -------------------------------------------------------------------------
:: 5. DOWNLOAD & DEPLOY FILES INTO CURRENT FOLDER
:: -------------------------------------------------------------------------
echo.
echo [*] Downloading and preparing SmartCS application files into current folder...

where git >nul 2>nul
if %errorlevel% equ 0 (
    if exist "%TARGET_DIR%\.git" (
        echo [*] Git repository detected. Fetching latest updates from GitHub...
        git fetch --prune origin main
        git reset --hard origin/main
    ) else (
        echo [*] Initializing Git repository in current folder...
        git init
        git remote add origin https://github.com/mkamel30/CS_Acess_Dahsboard.git
        git fetch --prune origin main
        git reset --hard origin/main
    )
) else (
    if not exist "%TARGET_DIR%\server.js" (
        echo [*] Git unavailable. Downloading repository zip archive via PowerShell...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$zip = [System.IO.Path]::Combine($env:TEMP, 'smartcs_latest.zip'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $env:TEMP\smartcs_extract -Force; Copy-Item -Path $env:TEMP\smartcs_extract\CS_Acess_Dahsboard-main\* -Destination '%TARGET_DIR%' -Recurse -Force; Remove-Item -Path $zip, $env:TEMP\smartcs_extract -Recurse -Force"
    ) else (
        echo [*] Application files already present in current folder.
    )
)

:: -------------------------------------------------------------------------
:: 6. SAVE CONFIG.JSON WITH CHOSEN DATABASE PATH
:: -------------------------------------------------------------------------
echo.
echo [*] Configuring application settings and database path...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cfgPath = Join-Path '%TARGET_DIR%' 'config.json'; $dbPath = '%FINAL_DB_PATH%'; $hasAccess = Test-Path $dbPath; $cfg = [ordered]@{ port = 8970; syncSecret = 'smartcs-cloud-secret-2026'; accessDbPath = $dbPath; vpsSyncUrl = 'https://smartcs.m-kamel.workers.dev' }; $cfg | ConvertTo-Json -Depth 4 | Out-File -FilePath $cfgPath -Encoding utf8; if ($hasAccess) { Write-Host '  [+] MS Access Database file detected and linked successfully!' -ForegroundColor Green } else { Write-Host '  [!] Notice: Database file not reachable now. Cloud VPS mode enabled.' -ForegroundColor Yellow }"

:: -------------------------------------------------------------------------
:: 7. INSTALL NPM DEPENDENCIES
:: -------------------------------------------------------------------------
echo.
echo [*] Installing production application dependencies...
call npm install --omit=dev --no-audit --no-fund

:: -------------------------------------------------------------------------
:: 8. INITIALIZE INTERNAL APPLICATION DATABASE SCHEMA (branch_database.db)
:: -------------------------------------------------------------------------
echo.
echo [*] Initializing internal high-speed database schema (branch_database.db)...
node updater.js init-db

:: -------------------------------------------------------------------------
:: 9. CREATE DESKTOP SHORTCUT & WINDOWS STARTUP AUTO-BOOT
:: -------------------------------------------------------------------------
echo.
echo [*] Creating Desktop Shortcut (SmartCS Dashboard)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut([System.IO.Path]::Combine($desk, 'SmartCS Dashboard.lnk')); $s.TargetPath = '%TARGET_DIR%\run_smartcs.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

echo [*] Enabling Automatic Launch on Windows Boot (Startup)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $auto = $ws.CreateShortcut([System.IO.Path]::Combine($startup, 'SmartCS AutoStart.lnk')); $auto.TargetPath = 'wscript.exe'; $auto.Arguments = '\"%TARGET_DIR%\start_background.vbs\"'; $auto.WorkingDirectory = '%TARGET_DIR%'; $auto.WindowStyle = 7; $auto.Description = 'SmartCS Automated Background Launch on Boot'; $auto.Save()"

echo [OK] Shortcuts and Auto-Boot configured successfully!

echo.
echo =======================================================================
echo    🎉 Installation Completed Successfully!
echo =======================================================================
echo.
echo  [+] SmartCS Dashboard is starting in your browser...
echo  [+] Local URL: http://localhost:8970
echo.

start "" "%TARGET_DIR%\run_smartcs.bat"

echo  Press any key to exit this installer...
pause >nul
exit /b 0
