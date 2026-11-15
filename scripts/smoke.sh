#!/usr/bin/env bash
# Renders the downloaded site in headless Chromium and asserts the SPA + live data painted.
# Usage: ./scripts/smoke.sh [url]
set -uo pipefail
URL="${1:-http://localhost:4319/}"
DOM=$(chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
        --virtual-time-budget=25000 --dump-dom "$URL" 2>/dev/null)

LINES=$(printf '%s' "$DOM" | sed 's/<[^>]*>/\n/g' | grep -c .)
TABS=$(printf '%s' "$DOM" | grep -o 'لوحة القيادة\|الاستراتيجيات A–W\|القواعد العليا\|سجل الصفقات\|جدولة الجلسات' | sort -u | wc -l)
PRICE=$(printf '%s' "$DOM" | grep -o '[1-9][0-9][0-9][0-9]\.[0-9][0-9]' | head -1)
BOOT=$(printf '%s' "$DOM" | grep -c 'جارٍ تهيئة البوت')

echo "visible-lines=$LINES tabs-found=$TABS live-price=${PRICE:-none} still-bootstrapping=$BOOT"
if [ "$LINES" -gt 50 ] && [ "$TABS" -ge 4 ] && [ -n "$PRICE" ] && [ "$BOOT" -eq 0 ]; then
  echo "PASS"; exit 0
else
  echo "FAIL"; exit 1
fi
