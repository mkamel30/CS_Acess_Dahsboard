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
    echo [!] Git is not installed. Automated updater will use cloud sync.
)

:: -------------------------------------------------------------------------
:: 4. CHECK / INSTALL NODE.JS
:: -------------------------------------------------------------------------
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js is not installed. Attempting automated installation...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo [*] Installing Node.js LTS silently via winget...
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements --silent
    ) else (
        echo [*] Downloading Node.js LTS installer via PowerShell...
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$msi = [System.IO.Path]::Combine($env:TEMP, 'node_setup.msi'); [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile $msi; Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn', '/norestart' -Wait"
    )
)

:: Refresh PATH
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"

:: -------------------------------------------------------------------------
:: 5. DOWNLOAD FRESH FILES FROM GITHUB (FORCE OVERWRITE)
:: -------------------------------------------------------------------------
echo.
echo [*] Downloading fresh application release from GitHub...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ext = Join-Path $env:TEMP 'smartcs_ext'; if (Test-Path $ext) { Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue }; $zip = Join-Path $env:TEMP 'smartcs_pkg.zip'; if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $ext -Force; Get-ChildItem -Path (Join-Path $ext 'CS_Acess_Dahsboard-main') | Copy-Item -Destination '%TARGET_DIR%' -Recurse -Force; Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue"
echo [OK] Files downloaded and updated to latest version!

:: -------------------------------------------------------------------------
:: 6. SAVE CONFIG.JSON WITH CHOSEN DATABASE PATH
:: -------------------------------------------------------------------------
echo.
echo [*] Configuring application settings and database path...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cfgPath = Join-Path '%TARGET_DIR%' 'config.json'; $dbPath = '%FINAL_DB_PATH%'; $hasAccess = Test-Path $dbPath; $cfg = [ordered]@{ port = 8970; syncSecret = 'smartcs-cloud-secret-2026'; accessDbPath = $dbPath; vpsSyncUrl = 'https://smartcs.m-kamel.workers.dev' }; $cfg | ConvertTo-Json -Depth 4 | Out-File -FilePath $cfgPath -Encoding utf8; if ($hasAccess) { Write-Host '  [+] MS Access Database file detected and linked successfully!' -ForegroundColor Green } else { Write-Host '  [!] Notice: Database file not reachable now. Cloud VPS mode enabled.' -ForegroundColor Yellow }"

:: -------------------------------------------------------------------------
:: 7. GENERATE ROCK-SOLID RUN_SMARTCS.BAT LOCALLY
:: -------------------------------------------------------------------------
echo.
echo [*] Generating clean daily launcher (run_smartcs.bat)...
(
echo @echo off
echo set "PATH=%%SystemRoot%%\System32;%%SystemRoot%%\System32\WindowsPowerShell\v1.0;%%ProgramFiles%%\nodejs;%%ProgramFiles%%\Git\cmd;%%PATH%%"
echo title SmartCS Dashboard - Central Operations System
echo color 0b
echo cd /d "%%~dp0"
echo where node >nul 2>nul
echo if %%errorlevel%% neq 0 (
echo     echo [ERROR] Node.js is not installed!
echo     pause
echo     exit /b 1
echo ^)
echo node updater.js update-silent 2>nul
echo start "" "http://localhost:8970"
echo :run_server
echo echo =======================================================================
echo echo  [+] Local Host Access   : http://localhost:8970
echo echo  [+] Press Ctrl+C to stop the server
echo echo =======================================================================
echo echo.
echo node server.js
echo echo [!] Server restarted.
echo timeout /t 2 /nobreak >nul
echo goto run_server
) > "%TARGET_DIR%\run_smartcs.bat"

:: -------------------------------------------------------------------------
:: 8. INSTALL NPM DEPENDENCIES
:: -------------------------------------------------------------------------
echo.
echo [*] Installing production application dependencies...
call npm install --omit=dev --no-audit --no-fund

:: -------------------------------------------------------------------------
:: 9. INITIALIZE INTERNAL DATABASE SCHEMA (branch_database.db)
:: -------------------------------------------------------------------------
echo.
echo [*] Initializing internal high-speed database schema (branch_database.db)...
node updater.js init-db

:: -------------------------------------------------------------------------
:: 10. CREATE DESKTOP SHORTCUT & WINDOWS STARTUP AUTO-BOOT
:: -------------------------------------------------------------------------
echo.
echo [*] Creating Desktop Shortcut (SmartCS Dashboard)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut([System.IO.Path]::Combine($desk, 'SmartCS Dashboard.lnk')); $s.TargetPath = '%TARGET_DIR%\run_smartcs.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.WindowStyle = 1; $s.Description = 'SmartCS Customer Support Operations Dashboard'; $s.Save()"

echo [*] Enabling Automatic Launch on Windows Boot (Startup)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $auto = $ws.CreateShortcut([System.IO.Path]::Combine($startup, 'SmartCS AutoStart.lnk')); $auto.TargetPath = 'wscript.exe'; $auto.Arguments = '\"%TARGET_DIR%\start_background.vbs\"'; $auto.WorkingDirectory = '%TARGET_DIR%'; $auto.WindowStyle = 7; $auto.Description = 'SmartCS Automated Background Launch on Boot'; $auto.Save()"

echo [OK] Shortcuts and Auto-Boot configured successfully!

echo.
echo =======================================================================
echo    Installation Completed Successfully!
echo =======================================================================
echo.
echo  [+] SmartCS Dashboard is starting in your browser...
echo  [+] Local URL: http://localhost:8970
echo.

start "" "http://localhost:8970"
call "%TARGET_DIR%\run_smartcs.bat"
