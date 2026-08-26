@echo off
chcp 65001 >nul
title SmartCS Central Operations - Automated Installer
color 0b

echo =======================================================================
echo    🚀 SmartCS Central Operations - Zero-Touch Automated Installer
echo =======================================================================
echo.

:: 1. SET CURRENT WORKING FOLDER CONTAINING THIS .BAT FILE
set "TARGET_DIR=%~dp0"
:: Strip trailing backslash
if "%TARGET_DIR:~-1%"=="\" set "TARGET_DIR=%TARGET_DIR:~0,-1%"

cd /d "%TARGET_DIR%"
echo [*] مسار تثبيت وتشغيل البرنامج:
echo     "%TARGET_DIR%"
echo.

:: -------------------------------------------------------------------------
:: 2. ASK USER FOR MS ACCESS DATABASE PATH INTERACTIVELY
:: -------------------------------------------------------------------------
set "DEFAULT_ACCESS=\\Share\d\gROCER SUPPORT\0 Gro.Support\DB\BRrelease\BE\Bread_Final_be.accdb"

echo -----------------------------------------------------------------------
echo  📁 إعداد مسار قاعدة بيانات الآكسيس (MS Access Database):
echo -----------------------------------------------------------------------
echo  المسار الافتراضي لشبكة الفرع:
echo  "%DEFAULT_ACCESS%"
echo.
echo  [تعليمات]:
echo  - اضغط [Enter] مباشرة للموافقة على المسار الافتراضي.
echo  - أو اكتب المسار، أو اسحب ملف الـ (.accdb/.mdb) وأفلته هنا:
echo.
set /p "USER_DB_INPUT= مسار ملف الآكسيس: "

if "%USER_DB_INPUT%"=="" (
    set "FINAL_DB_PATH=%DEFAULT_ACCESS%"
) else (
    :: Strip surrounding quotes if dragged and dropped
    set "FINAL_DB_PATH=%USER_DB_INPUT:"=%"
)

echo.
echo [*] تم اعتماد مسار قاعدة البيانات: "%FINAL_DB_PATH%"
echo.

:: -------------------------------------------------------------------------
:: 3. CHECK / INSTALL GIT (via winget or fallback)
:: -------------------------------------------------------------------------
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git is not found. Attempting automated installation via winget...
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
    echo [!] Node.js is not found. Attempting automated installation via winget...
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
:: 6. SAVE CONFIG.JSON WITH USER'S DATABASE PATH
:: -------------------------------------------------------------------------
echo.
echo [*] Configuring application settings and database path...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfgPath = Join-Path '%TARGET_DIR%' 'config.json'; $dbPath = '%FINAL_DB_PATH%'; $hasAccess = Test-Path $dbPath; $cfg = @{ port = 8970; syncSecret = 'smartcs-cloud-secret-2026'; accessDbPath = $dbPath; vpsSyncUrl = 'https://smartcs.m-kamel.workers.dev' }; $cfg | ConvertTo-Json -Depth 4 | Set-Content $cfgPath -Encoding UTF8; if ($hasAccess) { Write-Host '  [+] MS Access Database file detected and linked successfully!' -ForegroundColor Green } else { Write-Host '  [!] Notice: Database file not reachable at this moment. Cloud VPS mode will act as primary.' -ForegroundColor Yellow }"

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
node -e "
const sqlite3 = require('sqlite3');
const { initSyncDatabase } = require('./sync_engine');
const db = new sqlite3.Database('branch_database.db', (err) => {
    if (err) {
        console.error('  [!] Error opening SQLite DB:', err.message);
        process.exit(1);
    }
    db.run('PRAGMA journal_mode = WAL;');
    initSyncDatabase(db).then(() => {
        console.log('  [+] App Database (SQLite WAL) Schema Created & Ready! ✅');
        db.close();
    }).catch(e => {
        console.error('  [!] Schema init error:', e.message);
        db.close();
    });
});
"

:: -------------------------------------------------------------------------
:: 9. CREATE DESKTOP SHORTCUT & WINDOWS STARTUP AUTO-BOOT
:: -------------------------------------------------------------------------
echo.
echo [*] Creating Desktop Shortcut (SmartCS Dashboard)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut([System.IO.Path]::Combine($desk, 'SmartCS Dashboard.lnk')); $s.TargetPath = '%TARGET_DIR%\run_smartcs.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

echo [*] Enabling Automatic Launch on Windows Boot (Startup)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $auto = $ws.CreateShortcut([System.IO.Path]::Combine($startup, 'SmartCS AutoStart.lnk')); $auto.TargetPath = 'wscript.exe'; $auto.Arguments = '\"%TARGET_DIR%\start_background.vbs\"'; $auto.WorkingDirectory = '%TARGET_DIR%'; $auto.WindowStyle = 7; $auto.Description = 'SmartCS Automated Background Launch on Boot'; $auto.Save()"

echo [OK] Shortcuts and Auto-Boot configured successfully!

echo.
echo =======================================================================
echo    🎉 Installation Complete! Launching SmartCS Dashboard...
echo =======================================================================
echo.
timeout /t 2 >nul

start "" "%TARGET_DIR%\run_smartcs.bat"
exit /b 0
