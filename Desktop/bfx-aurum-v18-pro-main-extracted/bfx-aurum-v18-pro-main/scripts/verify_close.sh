#!/bin/bash
# التحقق من غلق قسم «جارفس — القلب النابض» مع بقاء البوت كاملاً — جلسة واحدة
set -u
cd /home/z/my-project

# [1] إطلاق الخادم إن لم يكن مستجيباً
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$code" != "200" ]; then
  setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
    [ "$code" = "200" ] && break
    sleep 2
  done
fi
echo "[1] server: $code"

# [2] مسار جارفس الرئيسي POST — يجب 503 مغلق (بوابة الغلق تسبق فحص الجلسة)
echo "[2] /api/jarvis POST: $(curl -s -o /tmp/j1.json -w '%{http_code}' --max-time 10 -X POST -H 'Content-Type: application/json' -d '{"text":"مرحبا"}' http://localhost:3000/api/jarvis) | $(head -c 150 /tmp/j1.json)"

# [3] حالة القفل — closed:true
echo "[3] /api/jarvis/auth GET: $(curl -s --max-time 10 http://localhost:3000/api/jarvis/auth)"

# [4] TTS — يجب 503 مغلق
echo "[4] /api/jarvis/tts: $(curl -s -o /tmp/t1.json -w '%{http_code}' --max-time 10 'http://localhost:3000/api/jarvis/tts?text=test') | $(head -c 150 /tmp/t1.json)"

# [5][6][7] البوت حي: الصفحة + الإعدادات + آخر باك تيست
echo "[5] GET /: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/)"
echo "[6] /api/settings: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/api/settings)"
echo "[7] /api/backtest?meta=1: $(curl -s --max-time 20 'http://localhost:3000/api/backtest?meta=1' | head -c 200)"

# [8] لقطة واجهة — يجب فتح لوحة القيادة مباشرة بلا تبويب جارفس
mkdir -p /tmp/render
agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 5
agent-browser screenshot /tmp/render/11_closed.png 2>&1 | tail -1
TXT=$(agent-browser get text "body" 2>/dev/null)
echo "[8] 'القلب النابض' في الصفحة؟ (يجب 0): $(echo "$TXT" | grep -c 'القلب النابض' || true)"
echo "[9] 'لوحة القيادة' ظاهرة؟ (يجب ≥1): $(echo "$TXT" | grep -c 'لوحة القيادة' || true)"
echo "=== done ==="
