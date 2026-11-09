@echo off
title SmartCS Host Server - Remove Auto-Start Service
color 0c

net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo =======================================================================
echo    SmartCS Host Server - Remove Auto-Start Service
echo =======================================================================
echo.

schtasks /end /tn "SmartCS_Host_Service" >nul 2>&1
schtasks /delete /tn "SmartCS_Host_Service" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Scheduled Task 'SmartCS_Host_Service' removed.
) else (
    echo [!] Scheduled Task 'SmartCS_Host_Service' was not found.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$l = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup\SmartCS Dashboard AutoStart.lnk'; if (Test-Path $l) { Remove-Item $l -Force; Write-Host '[OK] All-Users startup shortcut removed.' }"

echo.
echo Auto-start removed. The server (if running) keeps running until stop_smartcs.bat or reboot.
pause
