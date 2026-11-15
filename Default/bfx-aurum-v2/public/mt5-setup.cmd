@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title BFX AURUM Setup
REM إغلاق أي نافذة جسر قديمة لا تزال تعمل — كي لا يبث جسران في نفس الوقت
taskkill /F /T /FI "WINDOWTITLE eq BFX AURUM - MT5 Live Bridge*" >nul 2>&1

set "BOT_URL=https://preview-chat-f4eeb93f-2da4-4577-85d4-0d92f62a07c1.space-z.ai"
set "BRIDGE=%USERPROFILE%\bfx-mt5-bridge.py"

echo.
echo  ============================================================
echo    BFX AURUM v20  -  ربط MetaTrader 5 بالبوت — بيانات حقيقية 100%
echo    MT5 Live Bridge - auto installer and launcher
echo  ============================================================
echo.

REM ---------- [0/4] فحص موقع البوت ----------
echo  [0/4] التحقق من أن موقع البوت يعمل ...
curl -fsS -o "%TEMP%\bfx-probe.json" "%BOT_URL%/api/mt5/status" >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%BOT_URL%/api/mt5/status' -TimeoutSec 15 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
)
if errorlevel 1 (
  echo.
  echo  [X] موقع البوت لا يستجيب الآن على العنوان:
  echo      %BOT_URL%
  echo.
  echo  الحل السريع:
  echo   1. افتح رابط البوت في المتصفح أولاً وانتظر حتى تظهر الواجهة
  echo   2. ثم أعد تنفيذ هذا الأمر من جديد
  echo.
  if exist "%TEMP%\bfx-probe.json" del "%TEMP%\bfx-probe.json" >nul 2>&1
  pause
  exit /b 1
)
if exist "%TEMP%\bfx-probe.json" del "%TEMP%\bfx-probe.json" >nul 2>&1
echo  [0/4] الموقع يعمل — ممتاز.
echo.

REM ---------- [1/4] Python ----------
call :detect_python
if defined PYEXE goto :py_ok
echo  [1/4] لم أجد Python على جهازك — جارٍ التثبيت التلقائي عبر winget ...
winget --version >nul 2>&1
if not errorlevel 1 (
  winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
)
call :detect_python
if defined PYEXE goto :py_ok
echo  [1/4] جارٍ تحميل مثبّت Python الرسمي من python.org ...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile '%TEMP%\bfx-py-setup.exe'" >nul 2>&1
if exist "%TEMP%\bfx-py-setup.exe" (
  echo        تثبيت صامت — قد يستغرق دقيقتين، لا تغلق النافذة ...
  "%TEMP%\bfx-py-setup.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_pip=1 /norestart
  del "%TEMP%\bfx-py-setup.exe" >nul 2>&1
)
call :detect_python
if not defined PYEXE (
  echo.
  echo  [X] تعذر تثبيت Python تلقائياً.
  echo      ثبّته يدوياً من https://www.python.org/downloads واختر إصدار 64-bit
  echo      ثم أعد تنفيذ هذا الأمر.
  echo.
  pause
  exit /b 1
)
:py_ok
echo  [1/4] Python جاهز: "%PYEXE%"
echo.

REM ---------- [2/4] تحضير الجسر — دائماً أحدث إصدار ----------
echo  [2/4] تحضير جسر MT5 — جلب أحدث إصدار ...
set "BRIDGE_LOCAL=%~dp0bfx-mt5-bridge.py"
curl -fsSL -o "%BRIDGE%.new" "%BOT_URL%/mt5-bridge.py" >nul 2>&1
if exist "%BRIDGE%.new" for %%A in ("%BRIDGE%.new") do if %%~zA GTR 3000 (
  move /y "%BRIDGE%.new" "%BRIDGE%" >nul 2>&1
)
if exist "%BRIDGE%.new" del "%BRIDGE%.new" >nul 2>&1
if exist "%BRIDGE%" (
  echo        الجسر جاهز بأحدث إصدار
  goto :bridge_ok
)
if exist "%BRIDGE_LOCAL%" (
  copy /y "%BRIDGE_LOCAL%" "%BRIDGE%" >nul 2>&1
  echo        فشل التحميل — استخدام النسخة المرفقة بجانب الملف
  goto :bridge_ok
)
echo  [X] فشل تحميل الجسر — افتح رابط البوت في المتصفح ثم أعد الأمر.
echo.
pause
exit /b 1
:bridge_ok
echo  [2/4] الجسر جاهز في: %BRIDGE%
echo.

REM ---------- [3/4] مكتبة MetaTrader5 ----------
echo  [3/4] التحقق من مكتبة MetaTrader5 ...
"%PYEXE%" -c "import MetaTrader5" >nul 2>&1
if errorlevel 1 (
  echo        أول مرة فقط — جارٍ تثبيت المكتبة، لحظات ...
  "%PYEXE%" -m pip install --upgrade MetaTrader5
  if errorlevel 1 (
    echo.
    echo  [X] فشل تثبيت مكتبة MetaTrader5 — تحقق من الإنترنت ثم أعد الأمر.
    echo      إن ظهر خطأ DLL فثبّت إصدار بايثون 64-bit من python.org
    echo.
    pause
    exit /b 1
  )
)
echo  [3/4] المكتبة جاهزة.
echo.

REM ---------- [4/4] التشغيل ----------
echo  [4/4] تشغيل الجسر — شموع كل ثانيتين + نبضة سعر كل نصف ثانية: حسابك + صفقاتك
echo  ------------------------------------------------------------
echo  مهم جداً:
echo   1. اترك هذه النافذة مفتوحة أثناء استخدام البوت
echo   2. سجّل الدخول في ميتاتريدر 5 مرة واحدة — حساب تجريبي Demo يكفي
echo   3. للإيقاف: أغلق هذه النافذة أو اضغط Ctrl+C
echo   4. لتطبيق أي تحديث مستقبلي: أعد تنفيذ أمر التثبيت نفسه
echo  ------------------------------------------------------------
echo.
title BFX AURUM - MT5 Live Bridge
"%PYEXE%" "%BRIDGE%" --url "%BOT_URL%"
echo.
echo  توقف الجسر. أعد تنفيذ الأمر لتشغيله من جديد.
pause
exit /b 0

REM ============================================================
REM  كشف Python وإرجاع مسار كامل لـ python.exe في PYEXE
REM ============================================================
:detect_python
set "PYEXE="
py -3 --version >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%I in (`py -3 -c "import sys; print(sys.executable)" 2^>nul`) do set "PYEXE=%%I"
)
if defined PYEXE goto :eof
python --version >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%I in (`python -c "import sys; print(sys.executable)" 2^>nul`) do set "PYEXE=%%I"
)
if defined PYEXE goto :eof
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" "C:\Program Files\Python313\python.exe" "C:\Program Files\Python312\python.exe" "C:\Program Files\Python311\python.exe" "C:\Program Files\Python\313\python.exe" "C:\Program Files\Python\312\python.exe" "C:\Python313\python.exe" "C:\Python312\python.exe") do (
  if exist "%%~P" if not defined PYEXE set "PYEXE=%%~P"
)
goto :eof
