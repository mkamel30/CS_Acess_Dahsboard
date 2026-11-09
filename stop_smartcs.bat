@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS - Stop Server
color 0c

echo ===================================================
echo     STOPPING SMARTCS DASHBOARD ^& SYNC ENGINE
echo ===================================================
echo.

echo [*] Ending boot task (if installed)...
schtasks /end /tn "SmartCS_Host_Service" >nul 2>&1

echo [*] Stopping SmartCS launcher loop (run_smartcs.bat)...
taskkill /F /FI "WINDOWTITLE eq SmartCS Dashboard*" /T >nul 2>nul
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*run_smartcs.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [*] Stopping isolated SmartCS Node processes...
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo Server has been stopped without affecting other apps.
echo (If it was started by the boot task, run this file as Administrator.)
echo.
pause
