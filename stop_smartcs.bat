@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS - Stop Server
color 0c

echo ===================================================
echo     STOPPING SMARTCS DASHBOARD ^& SYNC ENGINE
echo ===================================================
echo.

echo [*] Stopping SmartCS Dashboard window...
taskkill /F /FI "WINDOWTITLE eq SmartCS Dashboard*" /T >nul 2>nul

echo [*] Stopping isolated SmartCS Node processes...
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { .Name -eq 'node.exe' -and .CommandLine -like '*server.js*' } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo.
echo Server has been stopped successfully without affecting other apps!
echo You can safely close this window.
echo.
pause
