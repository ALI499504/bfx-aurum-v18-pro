@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title BFX AURUM - UPDATE
cd /d "%~dp0"
set "ROOT=%CD%"

if not exist "%ROOT%\bfx-aurum\package.json" (
  echo لم يُثبت الناسخ بعد — شغّل 1-INSTALL.bat أولاً.
  pause
  exit /b 1
)

echo ============================================================
echo   BFX AURUM - تحديث الناسخ لأحدث نسخة على GitHub
echo ============================================================
echo.

echo إيقاف الناسخ الحالي...
taskkill /fi "WINDOWTITLE eq BFX*" /f >nul 2>&1
taskkill /im node.exe /f >nul 2>&1

echo حفظ قاعدة البيانات المحلية (الإعدادات والسجلات)...
if exist "%ROOT%\bfx-aurum\db\custom.db" move /y "%ROOT%\bfx-aurum\db\custom.db" "%ROOT%\custom.db.bak" >nul

echo [1/4] تنزيل أحدث نسخة من GitHub...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://github.com/ALI499504/bfx-aurum-v18-pro/archive/refs/heads/main.zip' -OutFile 'repo.zip' -UseBasicParsing"
if errorlevel 1 goto err_dl
powershell -NoProfile -Command "Expand-Archive -Path 'repo.zip' -DestinationPath '.' -Force"
if errorlevel 1 goto err_dl
del /q repo.zip

echo [2/4] استبدال النسخة القديمة وإرجاع قاعدة البيانات...
if exist "%ROOT%\bfx-aurum" rmdir /s /q "%ROOT%\bfx-aurum"
ren "bfx-aurum-v18-pro-main" bfx-aurum
if exist "%ROOT%\custom.db.bak" (
  if not exist "%ROOT%\bfx-aurum\db" mkdir "%ROOT%\bfx-aurum\db"
  move /y "%ROOT%\custom.db.bak" "%ROOT%\bfx-aurum\db\custom.db" >nul
)

echo [3/4] تثبيت الاعتمادات وتحديث قاعدة البيانات...
set "PATH=%ROOT%\runtime\node;%PATH%"
set "DATABASE_URL=file:!ROOT:\=/!bfx-aurum/db/custom.db"
cd /d "%ROOT%\bfx-aurum"
call npm ci --no-audit --no-fund
if errorlevel 1 goto err
call npx prisma db push
if errorlevel 1 goto err

echo [4/4] بناء النسخة الجديدة — من 3 إلى 6 دقائق، لا تغلق النافذة...
call npm run build
if errorlevel 1 goto err

echo.
echo ============================================================
echo   اكتمل التحديث بنجاح — دبل كليك على 2-START.bat للتشغيل
echo ============================================================
pause
exit /b 0

:err_dl
echo [فشل] تعذر تنزيل النسخة — تحقق من الإنترنت وأعد تشغيل هذا الملف.
pause
exit /b 1
:err
echo [فشل التحديث] — صوّر هذه النافذة وأرسلها لمساعدك الذكي.
pause
exit /b 1
