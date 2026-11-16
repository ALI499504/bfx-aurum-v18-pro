@echo off
chcp 65001 >nul
title BFX BRIDGE LOCAL
cd /d "%~dp0bfx-aurum\public"
:loop
echo [%date% %time%] الجسر يعمل ويبث شموع MT5 إلى الخادم المحلي localhost:3000
python mt5-bridge.py --url http://localhost:3000
echo [%date% %time%] الجسر توقف — إعادة تشغيل تلقائية بعد 15 ثانية...
timeout /t 15 /nobreak >nul
goto loop
