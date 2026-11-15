#!/bin/bash
# إنشاء نسختين من البوت: مصدرية خفيفة + كاملة ثقيلة
set -e
cd /home/z/my-project

# أسماء الملفات بتاريخ اليوم
DATE=$(date +%Y-%m-%d)
SRC="download/BFX-AURUM-source-${DATE}.zip"
FULL="download/BFX-AURUM-complete-${DATE}.zip"

echo "=== 1) نسخة المصدر الكامل (خفيفة) ==="
# كل الكود + الإعدادات + DB، بدون node_modules/.next/.git
zip -r -q "$SRC" . \
  -x "node_modules/*" \
  -x ".next/*" \
  -x ".git/*" \
  -x "download/*" \
  -x "server.log" \
  -x "dev.log" \
  -x "tool-results/*" \
  -x "tsconfig.tsbuildinfo" \
  -x "bun.lock" \
  -x ".DS_Store" \
  -x "*.pyc" \
  -x "__pycache__/*"
echo "OK: $SRC"
ls -lh "$SRC"

echo ""
echo "=== 2) نسخة كاملة (ثقيلة، جاهزة للتشغيل) ==="
zip -r -q "$FULL" . \
  -x ".git/*" \
  -x "download/*" \
  -x "server.log" \
  -x "dev.log" \
  -x "tool-results/*" \
  -x "tsconfig.tsbuildinfo" \
  -x ".DS_Store" \
  -x "*.pyc" \
  -x "__pycache__/*"
echo "OK: $FULL"
ls -lh "$FULL"

echo ""
echo "=== DONE ==="
