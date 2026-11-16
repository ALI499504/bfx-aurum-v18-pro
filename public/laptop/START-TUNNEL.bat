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

rem ==================== النفق السريع المؤقت ====================
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
del /q "%ROOT%\tunnel.log" 2>nul
start "BFX TUNNEL CORE" /min cmd /c ""%ROOT%\cloudflared.exe" tunnel --url http://localhost:3000 --protocol http2 > "%ROOT%\tunnel.log" 2>&1"
echo.
echo في انتظار إنشاء الرابط — من 10 إلى 40 ثانية، لا تغلق هذه النافذة...
:wait_link
timeout /t 5 /nobreak >nul
if not exist "%ROOT%\tunnel.log" goto wait_link
set "URL="
for /f "usebackq tokens=1-6 delims=| " %%A in (`findstr /C:"trycloudflare.com" "%ROOT%\tunnel.log"`) do (
  for %%T in (%%A %%B %%C %%D %%E %%F) do (
    set "W=%%T"
    if "!W:~0,8!"=="https://" set "URL=!W!"
  )
)
if not defined URL goto wait_link
echo !URL!>"%ROOT%\THE-LINK.txt"
copy /y "%ROOT%\THE-LINK.txt" "%USERPROFILE%\Desktop\BFX-LINK.txt" >nul 2>&1
type "%ROOT%\THE-LINK.txt" | clip
:show_loop
cls
echo ============================================================
echo   رابط الناسخ لأصدقائك — نُسخ إلى الحافظة تلقائياً
echo   وملف BFX-LINK.txt وُضع على سطح المكتب:
echo.
echo   !URL!
echo.
echo   أرسل الرابط مع كلمة سر الموقع: black hat
echo   هذه النافذة يجب أن تبقى مفتوحة والرابط يتجدد عند إعادة التشغيل
echo ============================================================
timeout /t 20 /nobreak >nul
tasklist /fi "imagename eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul || goto cf_loop
goto show_loop

rem ==================== النفق الدائم الثابت ngrok ====================
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
set "URL=https://!NGROK_DOMAIN!"
echo !URL!>"%ROOT%\THE-LINK.txt"
copy /y "%ROOT%\THE-LINK.txt" "%USERPROFILE%\Desktop\BFX-LINK.txt" >nul 2>&1
type "%ROOT%\THE-LINK.txt" | clip
:ngrok_loop
cls
echo ============================================================
echo   الرابط الدائم الثابت لأصدقائك — نُسخ إلى الحافظة تلقائياً
echo   وملف BFX-LINK.txt وُضع على سطح المكتب:
echo.
echo   !URL!
echo.
echo   أرسله مع كلمة سر الموقع: black hat — لن يتغير أبداً
echo ============================================================
"%ROOT%\ngrok.exe" http --url=!NGROK_DOMAIN! 3000
echo النفق توقف — إعادة تشغيل بعد 15 ثانية (الرابط الثابت لا يتغير)...
timeout /t 15 /nobreak >nul
goto ngrok_loop
