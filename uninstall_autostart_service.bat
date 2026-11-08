@echo off
setlocal EnableDelayedExpansion
title SmartCS Host Server - Remove Startup Service
color 0c

:: Check admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo =======================================================================
echo    SmartCS Host Server - Remove Auto-Start Service
echo =======================================================================
echo.

set "TASK_NAME=SmartCS_Host_Service"
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Scheduled Task '%TASK_NAME%' removed successfully.
) else (
    echo [!] Scheduled Task '%TASK_NAME%' was not found.
)

:: Remove all-users startup shortcut
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$lnk = [System.IO.Path]::Combine($env:ProgramData, 'Microsoft\Windows\Start Menu\Programs\Startup', 'SmartCS Dashboard AutoStart.lnk');" ^
    "if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host '  [OK] All-Users Startup shortcut removed.' -ForegroundColor Green; }"

echo.
echo =======================================================================
echo    Auto-Start Service has been completely removed.
echo =======================================================================
pause
