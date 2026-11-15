@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0;%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
cd /d "%~dp0"
title SmartCS Dead-Queue Purge (outbox/DLQ)
color 0c

echo ===================================================
echo     SmartCS Dead-Queue Purge + VACUUM
echo ===================================================
echo.
echo [مهم] يجب إيقاف السيرفر أولاً عبر stop_smartcs.bat
echo [مهم] يجب تشغيل reseed (مصالحة VPS) قبل الحذف — السكربت يتحقق تلقائياً
echo       ويرفض الحذف إذا كان الـVPS ما زال ينقصه صفوف.
echo.

netstat -ano | findstr ":8970" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [تحذير] السيرفر ما زال يعمل على المنفذ 8970!
    echo         أوقفه عبر stop_smartcs.bat ثم أعد تشغيل هذا الملف.
    echo.
    pause
    exit /b 1
)

echo === معاينة + بوابة الأمان + تأكيد Y/N + حذف بـIDs + VACUUM ===
node purge_dead_queues.js --run
echo.
pause