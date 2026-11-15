#!/bin/bash
# التحقق النهائي للصوت الجديد (ليلى اللبنانية) في جلسة واحدة
set -u
cd /home/z/my-project

setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
echo "[1] server launching..."
code="000"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "[2] server ready: $code"

# صوت ليلى — توليد حي عبر نقطة النهاية
T=$(python3 - <<'EOF'
import urllib.parse; print(urllib.parse.quote('حاضر يا سيدي، أنا ليلى، في خدمتك الآن.'))
EOF
)
curl -s "http://localhost:3000/api/jarvis/tts?text=$T" -o /tmp/v_new.mp3 --max-time 60 \
  -w "[3] TTS-Layla: HTTP %{http_code} | %{content_type} | %{size_download}B | ttfb=%{time_starttransfer}s\n"
file /tmp/v_new.mp3 2>/dev/null | head -1

# لقطة واجهة بالصوت الجديد
mkdir -p /tmp/render
agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 3
agent-browser screenshot /tmp/render/10_layla.png 2>&1 | tail -1
agent-browser get text "body" 2>/dev/null | grep -oE "ليلى[^،.]{0,25}|اللبناني[^،.]{0,25}" | head -3
echo "=== done: cache=$(ls db/jarvis-tts 2>/dev/null | wc -l) ==="
