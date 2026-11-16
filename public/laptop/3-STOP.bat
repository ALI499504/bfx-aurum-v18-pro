@echo off
chcp 65001 >nul
title BFX STOP
echo إيقاف كل نوافذ BFX AURUM (الخادم + الجسر + النفق)...
taskkill /fi "WINDOWTITLE eq BFX*" /f >nul 2>&1
taskkill /im node.exe /f >nul 2>&1
taskkill /im cloudflared.exe /f >nul 2>&1
taskkill /im ngrok.exe /f >nul 2>&1
echo تم الإيقاف. لتشغيل الناسخ مرة أخرى: دبل كليك على 2-START.bat
pause
