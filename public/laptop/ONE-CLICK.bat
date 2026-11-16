@echo off
chcp 65001 >nul
title BFX AURUM - ONE CLICK
set "ROOT=C:\BFX"
set "GH=https://raw.githubusercontent.com/ALI499504/bfx-aurum-v18-pro/main/public/laptop"
set "PS=powershell -NoProfile -Command"

echo ============================================================
echo   BFX AURUM - أمر واحد شامل تلقائي
echo   تثبيت إن لزم + تشغيل الخادم والجسر + إنشاء رابط لأصدقائك
echo ============================================================
echo.

if not exist "%ROOT%" mkdir "%ROOT%"
cd /d "%ROOT%"

rem --- تنزيل ملفات الحزمة من GitHub ---
for %%F in (1-INSTALL.bat 2-START.bat 5-UPDATE.bat 3-STOP.bat 4-AUTOSTART.bat START-BRIDGE-LOCAL.bat START-TUNNEL.bat README-LAPTOP.txt tunnel-config.example.txt) do (
  if not exist "%ROOT%\%%F" (
    echo تنزيل %%F ...
    %PS% "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '%GH%/%%F' -OutFile '%ROOT%\%%F' -UseBasicParsing" >nul 2>&1
    if not exist "%ROOT%\%%F" (
      echo [فشل] تعذر تنزيل %%F — تحقق من الإنترنت وأعد الأمر.
      pause
      exit /b 1
    )
  )
)
echo ملفات الحزمة جاهزة في C:\BFX

rem --- التثبيت التلقائي إن لم يكتمل سابقاً (بلا أي سؤال) ---
if exist "%ROOT%\bfx-aurum\.next\standalone\server.js" goto installed
if exist "%ROOT%\bfx-aurum\.next\standalone\bfx-aurum\server.js" goto installed
echo.
echo ============================================================
echo   التثبيت الأول — من 10 إلى 20 دقيقة
echo   لا تغلق هذه النافذة ولا تنسحب منها، سيكمل وحده حتى النهاية
echo ============================================================
call "%ROOT%\1-INSTALL.bat" auto
if errorlevel 1 exit /b 1

:installed
echo.
echo ============================================================
echo   التشغيل الآن: الخادم + الجسر + النفق
echo   الرابط سيُنسخ للحافظة تلقائياً وملف BFX-LINK.txt
echo   سيظهر على سطح المكتب — أرسله لأصدقائك مع كلمة السر
echo ============================================================
call "%ROOT%\2-START.bat"
