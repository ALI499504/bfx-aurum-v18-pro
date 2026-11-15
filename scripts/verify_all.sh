#!/bin/bash
# التحقق الشامل في جلسة واحدة: الخادم + صوت المذيع الجديد + الباك تيست 2025
set -u
cd /home/z/my-project

# 1) إطلاق الخادم (يموت تلقائياً مع نهاية الجلسة — سكربت التحقق فقط)
setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
SRV=$!
echo "[1] server launched (pid $SRV) — waiting for readiness..."

# 2) انتظار الجاهزية (حتى 90 ثانية)
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then echo "[2] server READY after ${i}x2s"; break; fi
  sleep 2
done
if [ "$code" != "200" ]; then echo "FAIL: server not ready"; tail -20 /tmp/devsrv.log; exit 1; fi

# 3) فحص الصوت الجديد (نقطة tts — المفروض ملف mp3 حقيقي من المذيع ليث)
T=$(python3 - <<'EOF'
import urllib.parse; print(urllib.parse.quote('حاضر يا سيدي، الصوت الجديد جاهز.'))
EOF
)
curl -s "http://localhost:3000/api/jarvis/tts?text=$T" -o /tmp/vnew.mp3 --max-time 60 \
  -w "[3] TTS: HTTP %{http_code} | %{content_type} | %{size_download}B | ttfb=%{time_starttransfer}s\n"
file /tmp/vnew.mp3 2>/dev/null | head -1

# 4) فحص الباك تيست 2025 عبر مسار جارفس الكامل (العقل → الأداة → الرد)
echo "[4] backtest via jarvis (may take up to 3 min)..."
python3 - <<'EOF'
import json, urllib.request, time

req = urllib.request.Request(
    'http://localhost:3000/api/jarvis',
    data=json.dumps({'text': 'اعمل باك تيست لسنة 2025 يا جارفس'}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=200) as r:
        for line in r:
            line = line.strip()
            if not line: continue
            try: j = json.loads(line)
            except Exception: continue
            t = j.get('t')
            if t == 'step':
                print(f"  STEP [{j.get('ok')}] {j.get('label')} ({j.get('ms')}ms): {str(j.get('detail'))[:110]}")
            elif t == 'say':
                print(f"  SAY: {str(j.get('text'))[:90]}")
            elif t == 'reply':
                print(f"  REPLY ({time.time()-t0:.0f}s): {str(j.get('reply'))[:600]}")
                d = j.get('data')
                if d: print(f"  DATA: {json.dumps(d, ensure_ascii=False)[:400]}")
            elif t == 'error':
                print(f"  ERROR: {j.get('message')}")
            elif t == 'done':
                print(f"  DONE turns={j.get('turns')} total={time.time()-t0:.0f}s")
except Exception as e:
    print(f"  REQUEST FAILED: {e}")
EOF

# 5) خلاصة
echo "[5] cache files: $(ls db/jarvis-tts 2>/dev/null | wc -l)"
echo "=== verification finished ==="
