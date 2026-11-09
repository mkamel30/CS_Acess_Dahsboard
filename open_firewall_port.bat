@echo off
title Open Windows Firewall for SmartCS (Port 8970)
color 0b

:: Check for Administrator Privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Administrator privileges required. Elevating...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo =======================================================================
echo    SmartCS LAN Sharing - Windows Firewall Port Unlocker
echo =======================================================================
echo.

echo [*] Removing any old firewall rules for port 8970...
netsh advfirewall firewall delete rule name="SmartCS Dashboard Server (Port 8970)" >nul 2>&1

echo [*] Adding Inbound Allow Rule for TCP Port 8970 on all network profiles...
netsh advfirewall firewall add rule name="SmartCS Dashboard Server (Port 8970)" dir=in action=allow protocol=TCP localport=8970 profile=any

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Port 8970 is now OPEN in Windows Defender Firewall!
    echo           Other computers on the office network can now open the dashboard.
) else (
    echo.
    echo [ERROR] Failed to add firewall rule.
)

echo.
echo -----------------------------------------------------------------------
echo  Links to open the dashboard from any device on the network:
echo -----------------------------------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host '  [+] http://' + $_.IPAddress + ':8970' -ForegroundColor Green }"
echo -----------------------------------------------------------------------
echo.
pause
