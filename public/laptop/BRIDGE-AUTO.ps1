﻿# ============================================================
#  BFX AURUM v24 — الإعداد التلقائي الشامل للجسر (أمر واحد)
#  ------------------------------------------------------------
#  الهدف الافتراضي: البوت المحلي على جهازك http://localhost:3000
#  • يغلق أي جسر/مراقب قديم بأمان (لا يقتل نفسه أبداً)
#  • يثبت Python + MetaTrader5 + requests إن لم تكن موجودة
#  • يجلب mt5-bridge.py: ملف موجود محلياً أولاً، ثم موقعك على Render،
#    ثم حزمة ZIP من github.com — raw.githubusercontent لا يُعتمد عليه
#    (محجوب على بعض الشبكات)
#  • حلقة مراقبة تعيد تشغيل الجسر تلقائياً عند الانهيار أو انقطاع النت
#    (الجسر v22 نفسه يعيد المحاولة داخلياً 5 مرات قبل الاستسلام)
#  • تشغيل تلقائي عند إقلاع الويندوز عبر مجلد Startup — بلا صلاحيات مدير
#  • يشغّل منصة MT5 إن كانت مغلقة، ويعطّل سكون الحاسب على الكهرباء
#  الاستخدام: powershell -ExecutionPolicy Bypass -File BRIDGE-AUTO.ps1 [الرابط]
# ============================================================
param([string]$Url = "http://localhost:3000")

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$Root   = Join-Path $env:USERPROFILE 'BFX-AURUM'
$Pub    = Join-Path $Root 'public'
$Loop   = Join-Path $Root 'BRIDGE-LOOP.cmd'
$Bridge = Join-Path $Pub 'mt5-bridge.py'

Write-Host ''
Write-Host '============================================================'
Write-Host '   BFX AURUM v24 — الإعداد التلقائي الشامل للجسر'
Write-Host "   سيصل الجسر إلى: $Url"
Write-Host '============================================================'

# ---------- [1/7] إغلاق المتعارض بأمان (استثناء نفسه وأبيه) ----------
Write-Host '[1/7] إغلاق أي جسر أو مراقب قديم...'
$self = $PID
Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $self -and $_.ParentProcessId -ne $self -and
    $_.CommandLine -match 'mt5-bridge\.py|bridge-watchdog|BRIDGE-GUARD|BRIDGE-LOOP'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
foreach ($t in 'BFX-Bridge-Auto', 'BFX-AURUM-Guard', 'BFX-Bridge-Loop') {
    schtasks /Delete /TN $t /F 2>$null | Out-Null
}

# ---------- [2/7] Python ----------
Write-Host '[2/7] التأكد من Python...'
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

# ---------- [3/7] ملف الجسر: محلي أولاً ثم الشبكة ----------
Write-Host '[3/7] فحص ملف الجسر mt5-bridge.py...'
New-Item -ItemType Directory -Force -Path $Pub | Out-Null
$src = @($Bridge, 'C:\BFX\bfx-aurum\public\mt5-bridge.py') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($src) {
    Write-Host "    موجود محلياً: $src"
    if ($src -ne $Bridge) { Copy-Item $src $Bridge -Force }
}
if (-not $src) {
    Write-Host '    غير موجود على الجهاز — التنزيل من الشبكة...'
    $dl = $false
    foreach ($u in @(
        'https://bfx-aurum-v18-pro.onrender.com/mt5-bridge.py',
        'https://github.com/ALI499504/bfx-aurum-v18-pro/raw/main/public/mt5-bridge.py'
    )) {
        try {
            Invoke-WebRequest $u -OutFile $Bridge -UseBasicParsing -TimeoutSec 120
            $head = (Get-Content $Bridge -TotalCount 3) -join ' '
            if ($head -match 'python|MetaTrader|import') { $dl = $true; Write-Host "    نُزّل من: $u"; break }
            Remove-Item $Bridge -Force -ErrorAction SilentlyContinue   # صفحة تحويل/خطأ وليست السكربت — احذفها وجرّب التالي
        } catch { Remove-Item $Bridge -Force -ErrorAction SilentlyContinue }
    }
    if (-not $dl) {
        Write-Host '    عبر حزمة ZIP من github.com (المصدر المضمون)...'
        $z = Join-Path $env:TEMP 'bfx-run.zip'
        $x = Join-Path $env:TEMP 'bfx-run'
        Invoke-WebRequest 'https://github.com/ALI499504/bfx-aurum-v18-pro/archive/refs/heads/main.zip' -OutFile $z -UseBasicParsing -TimeoutSec 300
        if (Test-Path $x) { Remove-Item $x -Recurse -Force }
        Expand-Archive $z $x -Force
        Copy-Item (Join-Path $x 'bfx-aurum-v18-pro-main\public\mt5-bridge.py') $Bridge -Force
        Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host '    نُزّل عبر ZIP'
    }
}
if (-not (Test-Path $Bridge)) { Write-Host '[فشل] تعذر توفير mt5-bridge.py — تحقق من الإنترنت وأعد الأمر'; exit 1 }
Write-Host ("    الجسر جاهز: {0} ({1:N0} KB)" -f $Bridge, ((Get-Item $Bridge).Length / 1KB))

# ---------- [4/7] المكتبات ----------
Write-Host '[4/7] تثبيت المكتبات MetaTrader5 + requests والتحقق منها...'
& $py -m pip install -q --disable-pip-version-check --upgrade MetaTrader5 requests 2>$null
$chk = Join-Path $Root 'chk.py'
Set-Content -Path $chk -Value 'import MetaTrader5, requests' -Encoding ascii
$o = (& $py $chk 2>&1 | Out-String)
if ($o.Trim().Length -gt 0) { Write-Host 'BFX-WARN: المكتبات لم تثبت صح — ثبّت Python من python.org وأعد الأمر' }
Remove-Item $chk -ErrorAction SilentlyContinue

# ---------- [5/7] حلقة المراقبة ----------
# مهم: ملف batch يجب أن يكون ASCII صرفاً — أي حرف غير لاتيني (مثل عربي)
# يكسر تحليل cmd، وعلامة > داخل echo تُفسَّر كتحويل مخرجات وتفشل.
# لذا: بلا chcp، بلا نص عربي، ومسارات مطلقة + مسار مطلق لسكربت بايثون.
Write-Host '[5/7] إنشاء حلقة المراقبة (إعادة تشغيل تلقائية كل 15 ثانية)...'
$wd = @"
@echo off
title BFX-BRIDGE $Url
cd /d "$Pub"
:loop
tasklist /fi "imagename eq terminal64.exe" 2>nul | find /i "terminal64.exe" >nul || (
if exist "C:\Program Files\MetaTrader 5\terminal64.exe" start "" "C:\Program Files\MetaTrader 5\terminal64.exe"
if exist "C:\Program Files (x86)\MetaTrader 5\terminal64.exe" start "" "C:\Program Files (x86)\MetaTrader 5\terminal64.exe"
)
echo [%date% %time%] bridge to $Url
python "$Bridge" --url "$Url"
echo [%date% %time%] bridge stopped - auto restart in 15s (close this window to stop all)
timeout /t 15 /nobreak >nul
goto loop
"@
Set-Content -Path $Loop -Value $wd -Encoding ascii

# ---------- [6/7] التشغيل التلقائي عند الإقلاع (Startup بلا مدير) ----------
Write-Host '[6/7] التشغيل التلقائي عند إقلاع الويندوز + تعطيل السكون...'
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\BFX-BRIDGE.lnk'))
$lnk.TargetPath = $Loop
$lnk.WorkingDirectory = $Root
$lnk.WindowStyle = 7   # مصغّرة
$lnk.Save()
powercfg /change standby-timeout-ac 0   2>$null | Out-Null   # لا نوم على الكهرباء
powercfg /change hibernate-timeout-ac 0 2>$null | Out-Null   # لا إسبات
powercfg /change monitor-timeout-ac 10  2>$null | Out-Null   # الشاشة قد تنام — لا يضر

# ---------- [7/7] التشغيل الآن + الفحص ----------
Write-Host '[7/7] تشغيل الجسر الآن...'
Start-Process $Loop -WindowStyle Minimized
Start-Sleep 10
$bridgeUp = ((Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mt5-bridge\.py' } | Measure-Object).Count -gt 0)
$bot3000  = Test-NetConnection localhost -Port 3000 -WarningAction SilentlyContinue -InformationLevel Quiet
$mt5      = ((Get-Process terminal64 -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
Write-Host ''
Write-Host '============================================================'
Write-Host '   الحالة النهائية:'
Write-Host ('   • الجسر يعمل: ' + $(if ($bridgeUp) { 'نعم' } else { 'لا — افتح نافذة BFX-BRIDGE لرؤية السبب' }))
Write-Host ('   • البوت على 3000: ' + $(if ($bot3000) { 'يعمل' } else { 'غير شغّال الآن — شغّل البوت المحلي، والجسر سيتصل وحده عند جاهزيته' }))
Write-Host ('   • منصة MT5: ' + $(if ($mt5) { 'تعمل' } else { 'مغلقة — الحلقة ستشغلها تلقائياً (سجّل دخول حسابك فيها)' }))
Write-Host '   • نافذة المراقب تعمل مصغّرة الآن — لا تغلقها نهائياً'
Write-Host '   • عند إقلاع الويندوز تعمل وحدها (اختصار BFX-BRIDGE في Startup)'
Write-Host '   • عند انقطاع النت تعيد المحاولة وحدها حتى تعود الشبكة'
Write-Host '   • الإيقاف الكلي: أغلق نافذة BFX-BRIDGE واحذف BFX-BRIDGE.lnk من مجلد Startup'
Write-Host '============================================================'
