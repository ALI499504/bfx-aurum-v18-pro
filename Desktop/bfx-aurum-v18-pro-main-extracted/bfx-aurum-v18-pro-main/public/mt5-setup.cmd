@echo off
setlocal EnableExtensions
chcp 65001 >nul
title BFX AURUM v21 - MT5 Bridge Auto Setup
set "SITE=https://preview-chat-78d758a3-2904-47bf-862f-8130a1a76742.space-z.ai"
set "BRDIR=%USERPROFILE%\BFX-Aurum"
set "DL=%TEMP%\bfx_dl"
set "PYURL=https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"

echo ============================================================
echo    BFX AURUM v21 - تثبيت وتشغيل جسر MT5 تلقائياً
echo    XAUUSD / لوت 0.01 ثابت / وقف 15$ / سقف 72 ساعة
echo ============================================================
echo.

if not exist "%BRDIR%" mkdir "%BRDIR%" 2>nul
cd /d "%BRDIR%" 2>nul || (echo [X] فشل إنشاء مجلد العمل & pause & exit /b 1)

rem ==================== 1/4: بايثون ====================
set "PYEXE="
call :find_python
if defined PYEXE goto :py_ok

echo [1/4] لم أجد بايثون على الجهاز — جاري التثبيت التلقائي (64 بت)...
where winget >nul 2>nul
if not errorlevel 1 (
    echo [i] التثبيت عبر winget — قد يأخذ دقيقتين، لا تغلق النافذة...
    winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements 2>nul || winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
) else (
    echo [i] winget غير متوفر — تنزيل مثبّت بايثون من python.org...
    if not exist "%DL%" mkdir "%DL%" 2>nul
    curl -fsSL -o "%DL%\py-setup.exe" "%PYURL%" 2>nul || powershell -NoProfile -Command "Invoke-WebRequest -Uri '%PYURL%' -OutFile '%DL%\py-setup.exe' -UseBasicParsing"
    if not exist "%DL%\py-setup.exe" (
        echo [X] فشل تنزيل بايثون — تحقق من اتصال الإنترنت
        pause & exit /b 1
    )
    echo [i] تثبيت صامت لبايثون 3.12 (64 بت) — قد يأخذ دقيقتين...
    "%DL%\py-setup.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
)
call :find_python
if not defined PYEXE (
    echo [X] فشل تثبيت بايثون تلقائياً.
    echo     الحل اليدوي: ثبّت بايثون من python.org ثم أعد لصق نفس الأمر.
    pause & exit /b 1
)

:py_ok
set "PYVER="
for /f "usebackq delims=" %%v in (`"%PYEXE%" -c "import sys;print(sys.version.split()[0])" 2^>nul`) do set "PYVER=%%v"
echo [1/4] بايثون جاهز %PYVER% ^|^| %PYEXE%
echo.

rem ==================== 2/4: مكتبة MetaTrader5 ====================
echo [2/4] تثبيت مكتبة MetaTrader5...
"%PYEXE%" -m pip install --upgrade --disable-pip-version-check MetaTrader5 2>nul
if errorlevel 1 (
    echo [i] محاولة ثانية...
    "%PYEXE%" -m pip install --upgrade MetaTrader5
)
"%PYEXE%" -c "import MetaTrader5" >nul 2>nul
if errorlevel 1 (
    echo [X] فشل تثبيت مكتبة MetaTrader5 — تحقق من الإنترنت ثم أعد الأمر
    pause & exit /b 1
)
echo [2/4] MetaTrader5 مثبتة بنجاح
echo.

rem ==================== 3/4: تنزيل الجسر ====================
echo [3/4] تنزيل أحدث جسر v21 من الموقع...
del "%BRDIR%\mt5-bridge.py.new" 2>nul
curl -fsSL -o "%BRDIR%\mt5-bridge.py.new" "%SITE%/mt5-bridge.py" 2>nul || powershell -NoProfile -Command "Invoke-WebRequest -Uri '%SITE%/mt5-bridge.py' -OutFile '%BRDIR%\mt5-bridge.py.new' -UseBasicParsing"
if exist "%BRDIR%\mt5-bridge.py.new" (
    del "%BRDIR%\mt5-bridge.py.bak" 2>nul
    if exist "%BRDIR%\mt5-bridge.py" ren "%BRDIR%\mt5-bridge.py" mt5-bridge.py.bak
    ren "%BRDIR%\mt5-bridge.py.new" mt5-bridge.py
    echo [3/4] تم تنزيل الجسر إلى: %BRDIR%
) else if exist "%BRDIR%\mt5-bridge.py" (
    echo [i] تعذر التنزيل — سأستخدم النسخة الموجودة مسبقاً
) else (
    echo [X] فشل تنزيل الجسر — تحقق من الإنترنت ثم أعد الأمر
    pause & exit /b 1
)

rem إنشاء ملفات مساعدة لإعادة التشغيل والتحديث لاحقاً
> "%BRDIR%\start-bridge.cmd" (
    echo @echo off
    echo chcp 65001 ^>nul
    echo title BFX AURUM v21 - MT5 Bridge
    echo cd /d "%%~dp0"
    echo "%PYEXE%" mt5-bridge.py
    echo echo.
    echo echo [i] توقف الجسر — أغلق النافذة أو أعد فتح start-bridge.cmd
    echo pause
)
> "%BRDIR%\update-bridge.cmd" (
    echo @echo off
    echo chcp 65001 ^>nul
    echo cd /d "%%~dp0"
    echo curl -fsSL -o mt5-bridge.py.new "%SITE%/mt5-bridge.py" 2^>nul
    echo if exist mt5-bridge.py.new ^(
    echo   if exist mt5-bridge.py del mt5-bridge.py.bak 2^>nul ^&^& ren mt5-bridge.py mt5-bridge.py.bak
    echo   ren mt5-bridge.py.new mt5-bridge.py
    echo   echo [OK] تم التحديث لأحدث نسخة من الجسر
    echo ^) else ^(
    echo   echo [X] فشل التنزيل — تحقق من الإنترنت
    echo ^)
    echo pause
)
echo [3/4] ملفات مساعدة: start-bridge.cmd و update-bridge.cmd في مجلد BFX-Aurum
echo.

rem ==================== 4/4: التشغيل ====================
echo [4/4] تشغيل الجسر الآن — اترك هذه النافذة مفتوحة أثناء العمل
echo ------------------------------------------------------------
echo  * تأكد أن طرفية JustMarkTimes مثبتة على هذا الجهاز
echo  * إن فشل الاتصال بالطرفية: أغلقها وافتحها كمسؤول بنفس طريقة CMD
echo  * لإيقاف التنفيذ الحي مؤقتاً استخدم مفتاح التشغيل من الموقع
echo ============================================================
"%PYEXE%" "%BRDIR%\mt5-bridge.py"
echo.
echo [i] توقف الجسر. لإعادة التشغيل مستقبلاً: %BRDIR%\start-bridge.cmd
pause
exit /b 0

rem ==================== الدوال ====================
:find_python
set "PYEXE="
for /f "usebackq delims=" %%i in (`py -3 -c "import sys;print(sys.executable)" 2^>nul`) do set "PYEXE=%%i"
call :verify_py && goto :eof
set "PYEXE="
for /f "usebackq delims=" %%i in (`python -c "import sys;print(sys.executable)" 2^>nul`) do set "PYEXE=%%i"
call :verify_py && goto :eof
set "PYEXE="
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
call :verify_py && goto :eof
set "PYEXE="
for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" set "PYEXE=%%D\python.exe"
call :verify_py && goto :eof
set "PYEXE="
exit /b 0

:verify_py
if not defined PYEXE exit /b 1
"%PYEXE%" -c "import sys" >nul 2>nul || (set "PYEXE=" & exit /b 1)
exit /b 0
