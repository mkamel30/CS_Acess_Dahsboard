@echo off
setlocal EnableDelayedExpansion
title SmartCS Host Server - Automated Startup Service Installer
color 0b

:: -------------------------------------------------------------------------
:: 1. CHECK FOR ADMINISTRATOR PRIVILEGES & AUTO-ELEVATE
:: -------------------------------------------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Administrator privileges required. Requesting elevation...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: -------------------------------------------------------------------------
:: 2. DETECT DIRECTORY & LOCAL DRIVE PATH
:: -------------------------------------------------------------------------
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

cd /d "%SCRIPT_DIR%"

echo =======================================================================
echo    SmartCS Host Server - Fail-Safe Auto-Start Installer
echo =======================================================================
echo.
echo [*] Target Directory: "%SCRIPT_DIR%"
echo.

if not exist "%SCRIPT_DIR%\start_background.vbs" (
    echo [ERROR] start_background.vbs not found in "%SCRIPT_DIR%"!
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%\run_smartcs.bat" (
    echo [ERROR] run_smartcs.bat not found in "%SCRIPT_DIR%"!
    pause
    exit /b 1
)

:: -------------------------------------------------------------------------
:: 3. REGISTER WINDOWS SCHEDULED TASK (RUN AT BOOT - BEFORE USER LOGON)
:: -------------------------------------------------------------------------
echo [*] Registering Windows Scheduled Task (Runs at system boot under SYSTEM)...
set "TASK_NAME=SmartCS_Host_Service"
set "LAUNCH_CMD=wscript.exe \"%SCRIPT_DIR%\start_background.vbs\""

:: Remove old task if exists
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create task with ONSTART trigger running as SYSTEM with HIGHEST privileges
schtasks /create /tn "%TASK_NAME%" /tr "%LAUNCH_CMD%" /sc onstart /ru "SYSTEM" /rl HIGHEST /f

if %errorlevel% equ 0 (
    echo [OK] Windows Scheduled Task '%TASK_NAME%' created successfully!
    echo      Trigger: System Boot (Starts automatically even if NO user logs in).
) else (
    echo [!] Failed to create scheduled task with SYSTEM account. Trying with current admin...
    schtasks /create /tn "%TASK_NAME%" /tr "%LAUNCH_CMD%" /sc onstart /rl HIGHEST /f
)

:: -------------------------------------------------------------------------
:: 4. FALLBACK: ALL-USERS STARTUP SHORTCUT (RUNS ON ANY USER LOGON)
:: -------------------------------------------------------------------------
echo.
echo [*] Adding All-Users Startup Shortcut (Secondary Fallback)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$allUsers = [System.IO.Path]::Combine($env:ProgramData, 'Microsoft\Windows\Start Menu\Programs\Startup');" ^
    "if (Test-Path $allUsers) {" ^
    "    $ws = New-Object -ComObject WScript.Shell;" ^
    "    $lnk = $ws.CreateShortcut([System.IO.Path]::Combine($allUsers, 'SmartCS Dashboard AutoStart.lnk'));" ^
    "    $lnk.TargetPath = 'wscript.exe';" ^
    "    $lnk.Arguments = '\"%SCRIPT_DIR%\start_background.vbs\"';" ^
    "    $lnk.WorkingDirectory = '%SCRIPT_DIR%';" ^
    "    $lnk.WindowStyle = 7;" ^
    "    $lnk.Description = 'SmartCS Server Auto-Start on Boot';" ^
    "    $lnk.Save();" ^
    "    Write-Host '  [OK] Startup shortcut installed for all users.' -ForegroundColor Green;" ^
    "}"

:: -------------------------------------------------------------------------
:: 5. OPTIONAL: TEST START THE TASK NOW
:: -------------------------------------------------------------------------
echo.
echo [*] Starting SmartCS Service now via Task Scheduler...
schtasks /run /tn "%TASK_NAME%" >nul 2>&1

echo.
echo =======================================================================
echo    Configuration Complete!
echo =======================================================================
echo  - The server will now start automatically whenever the machine boots up.
echo  - It does NOT require anyone to log in to Windows.
echo  - It will run quietly in the background on port 8970.
echo  - If it restarts every night/weekend, SmartCS will resume immediately.
echo =======================================================================
echo.
echo Press any key to exit...
pause >nul
