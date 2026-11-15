@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
cd /d "%~dp0"
title SmartCS DB Maintenance (VACUUM)
color 0b

echo ===================================================
echo     SmartCS DB Maintenance - Measure + VACUUM
echo ===================================================
echo.
echo [مهم] يجب إيقاف السيرفر أولاً عبر stop_smartcs.bat
echo.

netstat -ano | findstr ":8970" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [تحذير] السيرفر ما زال يعمل على المنفذ 8970!
echo         أوقفه عبر stop_smartcs.bat ثم أعد تشغيل هذا الملف.
    echo.
    pause
    exit /b 1
)

echo === الخطوة 1: قياس الأحجام (قراءة فقط، بدون تعديل) ===
node vacuum_maintenance.js
echo.
echo ===================================================
set /p GO="هل تريد تنفيذ VACUUM الآن؟ (Y/N): "
if /i "%GO%"=="Y" (
    echo.
    echo === الخطوة 2: تنفيذ VACUUM ===
    node vacuum_maintenance.js --run
) else (
    echo تم الإلغاء. لم يتم تعديل أي شيء.
)
echo.
pause