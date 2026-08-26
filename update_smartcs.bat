@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
title SmartCS Dashboard - 1-Click Update
color 0b

echo =======================================================================
echo    SmartCS Operations - 1-Click GitHub Updater
echo =======================================================================
echo.

cd /d "%~dp0"
set "TARGET_DIR=%~dp0"
if "%TARGET_DIR:~-1%"=="\" set "TARGET_DIR=%TARGET_DIR:~0,-1%"

echo [*] Target Directory: "%TARGET_DIR%"
echo [*] Downloading latest release from GitHub...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ext = Join-Path $env:TEMP 'smartcs_upd'; if (Test-Path $ext) { Remove-Item $ext -Recurse -Force -ErrorAction SilentlyContinue }; $zip = Join-Path $env:TEMP 'smartcs_upd.zip'; if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/mkamel30/CS_Acess_Dahsboard/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $ext -Force; Get-ChildItem -Path (Join-Path $ext 'CS_Acess_Dahsboard-main') | Copy-Item -Destination '%TARGET_DIR%' -Recurse -Force; Remove-Item $zip, $ext -Recurse -Force -ErrorAction SilentlyContinue"

if %errorlevel% equ 0 (
    echo [OK] Latest files downloaded and updated successfully!
) else (
    echo [!] Warning: Direct download failed, checking Git...
    where git >nul 2>nul
    if %errorlevel% equ 0 (
        git fetch --prune origin main
        git reset --hard origin/main
    )
)

echo.
echo [*] Updating dependencies...
call npm install --omit=dev --no-audit --no-fund

echo.
echo =======================================================================
echo    Update Completed Successfully! Starting SmartCS Dashboard...
echo =======================================================================
echo.
timeout /t 2 /nobreak >nul

start "" "http://localhost:8970"
call "%TARGET_DIR%\run_smartcs.bat"
