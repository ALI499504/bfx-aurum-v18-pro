@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title BFX AURUM SERVER
cd /d "%~dp0"
set "ROOT=%CD%"

if exist "%ROOT%\bfx-aurum\.next\standalone\server.js" goto srv_ok
if exist "%ROOT%\bfx-aurum\.next\standalone\bfx-aurum\server.js" goto srv_ok
echo لم يتم التثبيت بعد — شغّل 1-INSTALL.bat أولاً وانتظر رسالة النجاح.
pause
exit /b 1
:srv_ok

rem --- حارس التشغيل المزدوج: إن كان الخادم يعمل أصلاً لا تشغّله ثانية ---
netstat -ano 2>nul | findstr /C:":3000 " | findstr /C:"LISTENING" >nul 2>&1 && (
  echo الناسخ يعمل أصلاً على المنفذ 3000 — إن أردت إعادة تشغيله: دبل كليك 3-STOP.bat ثم أعد هذا الملف.
  pause
  exit /b 1
)

set "PATH=%ROOT%\runtime\node;%PATH%"
set "NODE_ENV=production"
set "PORT=3000"
set "DATABASE_URL=file:!ROOT:\=/!bfx-aurum/db/custom.db"
if exist "%ROOT%\password.txt" set /p SITE_PASSWORD=<"%ROOT%\password.txt"

echo تشغيل الجسر المحلي في نافذة منفصلة (يبث شموع MT5 للخادم)...
start "BFX BRIDGE" cmd /c "%ROOT%\START-BRIDGE-LOCAL.bat"
echo تشغيل النفق العام للرابط في نافذة منفصلة...
start "BFX TUNNEL" cmd /c "%ROOT%\START-TUNNEL.bat"
timeout /t 6 /nobreak >nul
start "" "http://localhost:3000"

cd /d "%ROOT%\bfx-aurum"
set "SRV=.next\standalone\server.js"
if exist ".next\standalone\bfx-aurum\server.js" set "SRV=.next\standalone\bfx-aurum\server.js"
:loop
echo [%date% %time%] خادم الناسخ يعمل على المنفذ 3000 — لا تغلق هذه النافذة ولا نوافذ BFX الأخرى
node %SRV%
echo [%date% %time%] الخادم توقف — إعادة تشغيل تلقائية بعد 10 ثوانٍ...
timeout /t 10 /nobreak >nul
goto loop
