# ============================================================
#  BFX AURUM v23 — الإعداد التلقائي الشامل للجسر (أمر واحد)
#  ------------------------------------------------------------
#  • يغلق أي جسر/مراقب قديم متعارض
#  • يثبت Python + مكتبة MetaTrader5 إن لم تكن موجودة
#  • ينزّل أحدث نسخة من mt5-bridge.py من GitHub (تحديث ذاتي في كل تشغيل)
#  • ينشئ مراقباً يعيد تشغيل الجسر تلقائياً عند الانهيار أو انقطاع النت
#    (الجسر نفسه يحاول الدفع 5 مرات داخلياً قبل الاستسلام)
#  • يسجّل مهمة مجدولة: تشغيل تلقائي عند كل إقلاع/تسجيل دخول للويندوز
#  • يشغّل طرفية MT5 تلقائياً إن كانت مغلقة، ويعطّل سكون الحاسب
#  الاستخدام: powershell -ExecutionPolicy Bypass -File BRIDGE-AUTO.ps1 [الرابط]
# ============================================================
param([string]$Url = "https://bfx-aurum-v18-pro.onrender.com")

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Join-Path $env:ProgramData 'BFX-BRIDGE'
$Task = 'BFX-Bridge-Auto'
$WdPath = Join-Path $Root 'bridge-watchdog.cmd'

Write-Host ''
Write-Host '============================================================'
Write-Host '   BFX AURUM v23 — الإعداد التلقائي الشامل للجسر'
Write-Host "   سيصل الجسر إلى: $Url"
Write-Host '============================================================'

# ---------- [0/6] صلاحيات المدير ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '[تنبيه] النافذة ليست "تشغيل كمدير" — تعطيل السكون قد لا ينجح، والباقي يعمل عادي.'
}

# ---------- [1/6] إغلاق المتعارض ----------
Write-Host '[1/6] إغلاق أي جسر أو مراقب قديم متعارض...'
schtasks /end /tn $Task 2>$null | Out-Null
schtasks /delete /tn $Task /f 2>$null | Out-Null   # سيُعاد إنشاؤها نظيفة الآن
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -match 'bridge-watchdog' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2   # إعطاء وقت لأي مؤقت إعادة تشغيل في المراقب القديم ليموت مع نافذته
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'" |
    Where-Object { $_.CommandLine -match 'mt5-bridge' } |
    ForEach-Object { Write-Host ("    أُغلق جسر قديم PID " + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---------- [2/6] Python ----------
Write-Host '[2/6] التأكد من Python...'
$py = $null
foreach ($c in 'python', 'py') {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { $py = $c; break }  # تجاهل مَصنَف متجر Microsoft الفارغ
}
if (-not $py) {
    Write-Host '    تثبيت Python 3.12 (صامت، بلا أسئلة)...'
    $installed = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install -e --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements | Out-Null
        $installed = $?
    }
    if (-not $installed) {
        $inst = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
        Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile $inst -UseBasicParsing
        Start-Process $inst -ArgumentList '/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_test=0' -Wait
    }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    foreach ($c in 'python', 'py') { if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break } }
}
if (-not $py) { Write-Host '[فشل] تعذر تثبيت Python — تحقق من الإنترنت وأعد الأمر'; exit 1 }
Write-Host "    Python جاهز ($py)"

# ---------- [3/6] ملفات الجسر (أحدث نسخة دائماً) ----------
Write-Host '[3/6] تنزيل أحدث نسخة للجسر من GitHub...'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Invoke-WebRequest 'https://raw.githubusercontent.com/ALI499504/bfx-aurum-v18-pro/main/public/mt5-bridge.py' -OutFile (Join-Path $Root 'mt5-bridge.py') -UseBasicParsing
if (-not (Test-Path (Join-Path $Root 'mt5-bridge.py'))) { Write-Host '[فشل] تعذر تنزيل mt5-bridge.py — تحقق من الإنترنت'; exit 1 }

# ---------- [4/6] المكتبات ----------
Write-Host '[4/6] تثبيت المكتبات MetaTrader5 + requests...'
& $py -m pip install -q --disable-pip-version-check --upgrade MetaTrader5 requests 2>$null

# ---------- [5/6] المراقب + المهمة المجدولة ----------
Write-Host '[5/6] إنشاء المراقب الذكي + مهمة التشغيل التلقائي عند الإقلاع...'
$wd = @"
@echo off
chcp 65001 >nul
title BFX AURUM - Bridge Watchdog v23
cd /d "%~dp0"
:loop
rem تأكد أن طرفية MT5 تعمل — إن كانت مغلقة شغّلها تلقائياً
tasklist /fi "imagename eq terminal64.exe" 2>nul | find /i "terminal64.exe" >nul || (
    if exist "C:\Program Files\MetaTrader 5\terminal64.exe" start "" "C:\Program Files\MetaTrader 5\terminal64.exe"
    if exist "C:\Program Files (x86)\MetaTrader 5\terminal64.exe" start "" "C:\Program Files (x86)\MetaTrader 5\terminal64.exe"
)
echo [%date% %time%] تشغيل الجسر إلى $Url ...
python mt5-bridge.py --url "$Url"
echo [%date% %time%] توقف الجسر — إعادة تشغيل تلقائية بعد 20 ثانية (أغلق النافذة للإيقاف الكلي)
timeout /t 20 /nobreak >nul
goto loop
"@
[IO.File]::WriteAllText($WdPath, $wd)   # UTF-8 بلا BOM — ضروري لعمل batch سليم
schtasks /create /f /tn $Task /tr "$WdPath" /sc onlogon /rl highest | Out-Null
if ($LASTEXITCODE -ne 0) { schtasks /create /f /tn $Task /tr "$WdPath" /sc onlogon | Out-Null }  # بلا صلاحيات مدير
Write-Host '    المراقب جاهز — عند كل إقلاع للويندوز يعمل الجسر وحده'

# ---------- [6/6] منع السكون + التشغيل الآن ----------
Write-Host '[6/6] تعطيل سكون الحاسب + التشغيل الآن...'
powercfg /change standby-timeout-ac 0   2>$null | Out-Null   # لا نوم أبداً على الكهرباء
powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null   # لا إسبات
powercfg /change monitor-timeout-ac 10  2>$null | Out-Null   # الشاشة قد تنام — لا يضر
schtasks /run /tn $Task | Out-Null
Start-Sleep 3

Write-Host ''
Write-Host '============================================================'
Write-Host '   ✅ تم كل شيء — الجسر يعمل الآن ويعيد تشغيل نفسه دائماً'
Write-Host '   • نافذة المراقب تظهر الآن — صغّرها ولا تغلقها'
Write-Host '   • عند إقلاع الويندوز: يعمل تلقائياً (مهمة BFX-Bridge-Auto)'
Write-Host '   • عند انقطاع النت: يعيد المحاولة وحده حتى تعود الشبكة'
Write-Host "   • الهدف الحالي: $Url"
Write-Host '     لتغييره: عدّل سطر URL في bridge-watchdog.cmd داخل مجلد'
Write-Host '     BFX-BRIDGE في ProgramData، ثم أعد تشغيل المهمة'
Write-Host '============================================================'
