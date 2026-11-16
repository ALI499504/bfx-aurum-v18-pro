@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title BFX AURUM - INSTALL
cd /d "%~dp0"
set "ROOT=%CD%"

echo ============================================================
echo   BFX AURUM - تثبيت الناسخ على حاسوب المالك (مرة واحدة فقط)
echo ============================================================
echo.

rem --- المسار يجب أن يكون بلا فراغات ---
if not "!ROOT: =_!"=="!ROOT!" (
  echo [تنبيه] مسار المجلد يحتوي على فراغات وسيفشل التثبيت.
  echo         انقل المجلد إلى مسار بسيط مثل C:\BFX ثم أعد تشغيل هذا الملف.
  pause
  exit /b 1
)

rem --- 1) Node.js محمول داخل المجلد (بلا صلاحيات مدير ولا تعديل للنظام) ---
if exist "%ROOT%\runtime\node\node.exe" goto node_ok
echo [1/6] تنزيل Node.js المحمول (حوالي 30 ميغا، يبقى داخل هذا المجلد)...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile 'node.zip' -UseBasicParsing"
if errorlevel 1 goto err_node
powershell -NoProfile -Command "Expand-Archive -Path 'node.zip' -DestinationPath 'runtime' -Force"
if errorlevel 1 goto err_node
if exist "%ROOT%\runtime\node" rmdir /s /q "%ROOT%\runtime\node"
ren "runtime\node-v22.14.0-win-x64" node
del /q node.zip
:node_ok
set "PATH=%ROOT%\runtime\node;%PATH%"
echo       Node.js جاهز.

rem --- 2) نسخة المشروع من GitHub ---
if exist "%ROOT%\bfx-aurum\package.json" goto repo_ok
echo [2/6] تنزيل نسخة الناسخ من GitHub...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://github.com/ALI499504/bfx-aurum-v18-pro/archive/refs/heads/main.zip' -OutFile 'repo.zip' -UseBasicParsing"
if errorlevel 1 goto err_repo
powershell -NoProfile -Command "Expand-Archive -Path 'repo.zip' -DestinationPath '.' -Force"
if errorlevel 1 goto err_repo
if exist "%ROOT%\bfx-aurum" rmdir /s /q "%ROOT%\bfx-aurum"
ren "bfx-aurum-v18-pro-main" bfx-aurum
del /q repo.zip
:repo_ok
echo       نسخة الناسخ جاهزة.

rem --- 3) بايثون واعتمادات الجسر (موجودة أصلاً على جهازك) ---
echo [3/6] فحص بايثون واعتمادات الجسر...
python --version >nul 2>&1
if errorlevel 1 (
  echo       [تنبيه] بايثون غير موجودة في PATH — ثبّتها من python.org ثم أعد هذا الملف.
  pause
  exit /b 1
)
python -m pip install --quiet MetaTrader5 requests >nul 2>&1
echo       بايثون واعتمادات الجسر جاهزة.

rem --- 4) اعتمادات المشروع ---
echo [4/6] تثبيت اعتمادات المشروع — من 5 إلى 10 دقائق، لا تغلق النافذة...
call npm ci --no-audit --no-fund
if errorlevel 1 goto err_npm

rem --- 5) قاعدة بيانات محلية دائمة + بناء المشروع ---
echo [5/6] تجهيز قاعدة البيانات المحلية الدائمة ثم البناء — من 3 إلى 6 دقائق...
cd /d "%ROOT%\bfx-aurum"
if not exist "%ROOT%\bfx-aurum\db" mkdir "%ROOT%\bfx-aurum\db"
set "DATABASE_URL=file:!ROOT:\=/!bfx-aurum/db/custom.db"
call npx prisma db push
if errorlevel 1 goto err_db
call npm run build
if errorlevel 1 goto err_build

rem --- 6) منع نوم الجهاز عند التوصيل بالكهرباء ---
echo [6/6] تعطيل نوم الجهاز عند التوصيل بالكهرباء (ضروري للعمل الدائم)...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

echo.
echo ============================================================
echo   اكتمل التثبيت بنجاح
echo   من الآن فصاعداً: دبل كليك على 2-START.bat لتشغيل الناسخ
echo ============================================================
rem في الوضع التلقائي (أمر ONE-CLICK) لا ننتظر ضغطة زر — يكمل وحده
if not "%~1"=="auto" pause
exit /b 0

:err_node
echo [فشل] تعذر تنزيل Node.js — تحقق من الإنترنت وأعد تشغيل هذا الملف.
pause
exit /b 1
:err_repo
echo [فشل] تعذر تنزيل نسخة المشروع — تحقق من الإنترنت وأعد تشغيل هذا الملف.
pause
exit /b 1
:err_npm
echo [فشل] خطأ في تثبيت الاعتمادات — صوّر هذه النافذة وأرسلها لمساعدك الذكي.
pause
exit /b 1
:err_db
echo [فشل] خطأ في قاعدة البيانات — صوّر هذه النافذة وأرسلها لمساعدك الذكي.
pause
exit /b 1
:err_build
echo [فشل] خطأ في البناء — صوّر هذه النافذة وأرسلها لمساعدك الذكي.
pause
exit /b 1
