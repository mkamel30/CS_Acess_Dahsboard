@echo off
TITLE SmartCS - Stop Server
echo ===================================================
echo     STOPPING SMARTCS DASHBOARD ^& SYNC ENGINE
echo ===================================================
echo.
echo Stopping all Node.js instances...
taskkill /F /IM node.exe /T
echo.
echo Server has been stopped successfully!
echo You can safely close this window.
echo.
pause
