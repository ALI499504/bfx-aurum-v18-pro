@echo off
rem ============================================================
rem BFX AURUM v22 — مدرب تشغيل الجسر (Watchdog) للعمل 24/7
rem يبقي الجسر يعمل دائماً: إذا أُغلق أو انهار يعيد تشغيله بعد 30 ثانية.
rem الاستخدام: ضع هذا الملف في نفس مجلد mt5-bridge.py واضغط عليه مرتين.
rem لا تُغلق هذه النافذة أبداً — اتركها تعمل طوال الوقت.
rem ============================================================
chcp 65001 >nul
title BFX AURUM - Bridge Watchdog v22
cd /d "%~dp0"
:loop
echo.
echo [%date% %time%] === تشغيل الجسر BFX AURUM v22 ===
python mt5-bridge.py
echo.
echo [%date% %time%] === توقف الجسر — إعادة تشغيل تلقائية بعد 30 ثانية (Ctrl+C مرتين للإيقاف الكلي) ===
timeout /t 30 /nobreak >nul
goto loop
