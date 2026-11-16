@echo off
chcp 65001 >nul
title BFX AUTOSTART
echo تعطيل نوم الجهاز عند التوصيل بالكهرباء + تشغيل الناسخ تلقائياً مع كل إقلاع ويندوز...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
copy /y "%~dp02-START.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BFX-AURUM-START.bat" >nul
echo.
echo تم: من الآن مع كل إقلاع ويندوز يشتغل الناسخ تلقائياً في 3 نوافذ.
echo لإلغاء التشغيل التلقائي: احذف الملف BFX-AURUM-START.bat من مجلد
echo Startup في قائمة Start أو شغّل هذا الملف مرة أخرى لإعادة تفعيله.
pause
