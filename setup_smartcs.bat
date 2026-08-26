@echo off
title Setup SmartCS Operations on New Machine
color 0a

echo =======================================================================
echo    SmartCS Operations - Automated Setup and Environment Config
echo =======================================================================
echo.

cd /d "%~dp0"

:: -------------------------------------------------------------------------
:: 1. PROMPT USER FOR MS ACCESS DATABASE PATH
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
:: 2. VERIFY NODE.JS
:: -------------------------------------------------------------------------
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

:: -------------------------------------------------------------------------
:: 3. VERIFY GIT
:: -------------------------------------------------------------------------
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

:: -------------------------------------------------------------------------
:: 4. SAVE CONFIG.JSON WITH CHOSEN DATABASE PATH
:: -------------------------------------------------------------------------
echo [*] Writing configuration to config.json...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfgPath = Join-Path '%~dp0' 'config.json'; $dbPath = '%FINAL_DB_PATH%'; $hasAccess = Test-Path $dbPath; $cfg = @{ port = 8970; syncSecret = 'smartcs-cloud-secret-2026'; accessDbPath = $dbPath; vpsSyncUrl = 'https://smartcs.m-kamel.workers.dev' }; $cfg | ConvertTo-Json -Depth 4 | Set-Content $cfgPath -Encoding UTF8; if ($hasAccess) { Write-Host '  [+] MS Access Database file linked successfully!' -ForegroundColor Green } else { Write-Host '  [!] Notice: Access file not reachable now, Cloud VPS will act as fallback.' -ForegroundColor Yellow }"

:: -------------------------------------------------------------------------
:: 5. INSTALL NPM DEPENDENCIES
:: -------------------------------------------------------------------------
echo [*] Installing required application dependencies...
call npm install --omit=dev --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install npm dependencies.
    pause
    exit /b 1
)
echo [OK] Dependencies installed successfully.
echo.

:: -------------------------------------------------------------------------
:: 6. INITIALIZE INTERNAL APPLICATION DATABASE SCHEMA (branch_database.db)
:: -------------------------------------------------------------------------
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
        console.log('  [+] App Database (SQLite WAL) Schema Created and Ready!');
        db.close();
    }).catch(e => {
        console.error('  [!] Schema init error:', e.message);
        db.close();
    });
});
"

:: -------------------------------------------------------------------------
:: 7. CREATE DESKTOP SHORTCUT & ENABLE WINDOWS STARTUP AUTO-BOOT
:: -------------------------------------------------------------------------
echo [*] Creating Desktop Shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'SmartCS Dashboard.lnk')); $s.TargetPath = '%~dp0run_smartcs.bat'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

echo [*] Enabling Automatic Launch on Windows Boot (Startup)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $auto = $ws.CreateShortcut([System.IO.Path]::Combine($startup, 'SmartCS AutoStart.lnk')); $auto.TargetPath = 'wscript.exe'; $auto.Arguments = '\"%~dp0start_background.vbs\"'; $auto.WorkingDirectory = '%~dp0'; $auto.WindowStyle = 7; $auto.Description = 'SmartCS Automated Background Launch on Boot'; $auto.Save()"

if %errorlevel% equ 0 (
    echo [OK] Shortcuts and Auto-Boot configured successfully!
) else (
    echo [!] Could not create shortcuts automatically.
)
echo.

echo =======================================================================
echo    Setup Completed Successfully! Starting SmartCS Dashboard...
echo =======================================================================
echo.
timeout /t 2 >nul

call "%~dp0run_smartcs.bat"
