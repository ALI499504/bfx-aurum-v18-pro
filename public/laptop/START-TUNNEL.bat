@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title BFX TUNNEL
cd /d "%~dp0"
set "ROOT=%CD%"

rem --- قراءة إعداد الرابط الدائم إن وُجد ---
set "NGROK_TOKEN="
set "NGROK_DOMAIN="
if exist "%ROOT%\tunnel-config.txt" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%ROOT%\tunnel-config.txt") do (
    if /i "%%a"=="NGROK_AUTHTOKEN" set "NGROK_TOKEN=%%b"
    if /i "%%a"=="NGROK_DOMAIN" set "NGROK_DOMAIN=%%b"
  )
)

if defined NGROK_TOKEN if defined NGROK_DOMAIN goto ngrok

echo ============================================================
echo   وضع النفق السريع المؤقت — الرابط يتغير مع كل تشغيل
echo   للرابط الدائم الثابت: املأ tunnel-config.txt بحساب ngrok
echo   المجاني (الخطوات في README-LAPTOP.txt)
echo ============================================================
if not exist "%ROOT%\cloudflared.exe" (
  echo تنزيل أداة النفق cloudflared...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing"
)
if not exist "%ROOT%\cloudflared.exe" (
  echo [تنبيه] تعذر تنزيل cloudflared — تحقق من الإنترنت وأعد تشغيل هذا الملف.
  pause
  exit /b 1
)
:cf_loop
echo.
echo   سيظهر الرابط المؤقت بهذا الشكل:  https://xxxx-xxxx.trycloudflare.com
echo   انسخ السطر الذي يبدأ بـ https وينتهي بـ trycloudflare.com
echo   وأرسله لأصدقائك مع كلمة سر الموقع.
echo.
"%ROOT%\cloudflared.exe" tunnel --url http://localhost:3000 --protocol http2
echo النفق توقف — إعادة تشغيل بعد 15 ثانية (قد يتغير الرابط)...
timeout /t 15 /nobreak >nul
goto cf_loop

:ngrok
if not exist "%ROOT%\ngrok.exe" (
  echo تنزيل ngrok...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile 'ngrok.zip' -UseBasicParsing"
  if exist "%ROOT%\ngrok.zip" powershell -NoProfile -Command "Expand-Archive -Path 'ngrok.zip' -DestinationPath '.' -Force"
  if exist "%ROOT%\ngrok.zip" del /q ngrok.zip
)
if not exist "%ROOT%\ngrok.exe" (
  echo [تنبيه] تعذر تنزيل ngrok تلقائياً — ننقلك للنفق المؤقت.
  echo         لاحقاً: نزّل ngrok.exe يدوياً من موقع ngrok وضعِه في هذا المجلد.
  goto cf_loop
)
"%ROOT%\ngrok.exe" config add-authtoken !NGROK_TOKEN! >nul 2>&1
:ngrok_loop
echo.
echo   الرابط الدائم الثابت لأصدقائك:  https://!NGROK_DOMAIN!
echo   أرسله مع كلمة سر الموقع — لن يتغير أبداً.
echo.
"%ROOT%\ngrok.exe" http --url=!NGROK_DOMAIN! 3000
echo النفق توقف — إعادة تشغيل بعد 15 ثانية (الرابط الثابت لا يتغير)...
timeout /t 15 /nobreak >nul
goto ngrok_loop
