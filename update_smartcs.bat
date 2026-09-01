@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS Dashboard - 1-Click Update
color 0b

echo =======================================================================
echo    SmartCS Operations - 1-Click GitHub Updater (Safe Mode)
echo =======================================================================
echo.

:: 1. إيقاف السيرفر الخاص بنا فقط بأمان تام
echo [*] Stopping SmartCS Dashboard specifically...
taskkill /F /FI "WINDOWTITLE eq SmartCS Dashboard*" /T >nul 2>nul
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { .Name -eq 'node.exe' -and .CommandLine -like '*server.js*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
echo.

cd /d "%~dp0"
set "TARGET_DIR=%~dp0"
if "%TARGET_DIR:~-1%"=="\" set "TARGET_DIR=%TARGET_DIR:~0,-1%"

echo [*] Target Directory: "%TARGET_DIR%"
echo [*] Downloading latest release package from GitHub...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " = Join-Path C:\Users\mkame\AppData\Local\Temp 'smartcs_upd'; if (Test-Path ) { Remove-Item  -Recurse -Force -ErrorAction SilentlyContinue };  = Join-Path C:\Users\mkame\AppData\Local\Temp 'smartcs_upd.zip'; if (Test-Path ) { Remove-Item  -Force -ErrorAction SilentlyContinue }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile ; Expand-Archive -Path  -DestinationPath  -Force"

echo [*] Overwriting existing files with latest version...
robocopy "%TEMP%\smartcs_upd\CS_Acess_Dahsboard-main" "%TARGET_DIR%" /E /IS /IT /NP /NJH /NJS /NFL /NDO >nul 2>nul
if %errorlevel% gtr 7 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Copy-Item -Path (Join-Path C:\Users\mkame\AppData\Local\Temp 'smartcs_upd\CS_Acess_Dahsboard-main\*') -Destination '%TARGET_DIR%' -Recurse -Force"
)

:: Forcefully rewrite run_smartcs.bat with clean launcher
(
echo @echo off
echo set "PATH=%%SystemRoot%%\System32;%%SystemRoot%%\System32\WindowsPowerShell\v1.0;%%ProgramFiles%%\nodejs;%%ProgramFiles%%\Git\cmd;%%PATH%%"
echo title SmartCS Dashboard - Central Operations System
echo color 0b
echo cd /d "%%~dp0"
echo start "" "http://localhost:8970"
echo :run_server
echo echo =======================================================================
echo echo  [+] Local Host Access   : http://localhost:8970
echo echo  [+] Press Ctrl+C to stop the server
echo echo =======================================================================
echo echo.
echo node server.js
echo echo [!] Server process ended. Restarting in 2 seconds...
echo timeout /t 2 /nobreak ^>nul
echo goto run_server
) > "%TARGET_DIR%\run_smartcs.bat"

echo.
echo [*] Updating dependencies...
call npm install --omit=dev --no-audit --no-fund

echo.
:: 2. تفريغ صندوق الصادر القديم لمنع التعارض مع السحابة
echo [*] Clearing old delta_outbox to prevent cloud sync conflicts...
node -e "const sqlite3 = require('sqlite3').verbose(); const db = new sqlite3.Database('branch_database.db'); db.run('DELETE FROM delta_outbox', (err) => console.log(err ? 'Error clearing outbox: ' + err : 'Outbox Cleared Successfully!'));"

echo.
echo =======================================================================
echo    Update Completed Successfully! 
echo    PLEASE WAIT FOR CLOUD RESEED TO FINISH BEFORE PRESSING ANY KEY...
echo =======================================================================
echo.

:: 3. التوقف المؤقت حتى أعطيك الإشارة
pause

start "" "http://localhost:8970"
call "%TARGET_DIR%\run_smartcs.bat"
