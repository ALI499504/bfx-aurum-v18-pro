#!/bin/bash
# التحقق النهائي: القفل بالرمز السري + إصلاح تسريب JSON
set -u
cd /home/z/my-project

setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
code="000"
for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null); [ "$code" = "200" ] && break; sleep 2; done
echo "### SERVER: $code"

echo ""
echo "### 1) القفل: كل مسارات جارفس بلا جلسة يجب 401"
for u in "api/jarvis" "api/jarvis/tts?text=test" "api/jarvis/auth"; do
  m="GET"; [ "$u" = "api/jarvis" ] && m="GET"
  c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "http://localhost:3000/$u")
  echo "  $m /$u -> $c"
done
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/jarvis -H 'Content-Type: application/json' -d '{"text":"سلام"}' --max-time 20)
echo "  POST /api/jarvis (بلا جلسة) -> $c"

echo ""
echo "### 2) رمز خاطئ يجب 401"
c=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/jarvis/auth -H 'Content-Type: application/json' -d '{"code":"wrong"}' --max-time 20)
echo "  wrong-code -> $c"

echo ""
echo "### 3) الرمز الصحيح يجب 200 + كوكي"
curl -s -c /tmp/jarvis_cookies.txt -X POST http://localhost:3000/api/jarvis/auth -H 'Content-Type: application/json' -d '{"code":"ali12345"}' --max-time 20 -w "  [HTTP %{http_code}]\n"

echo ""
echo "### 4) بعد الفتح: كل المسارات يجب 200"
c1=$(curl -s -b /tmp/jarvis_cookies.txt -o /dev/null -w "%{http_code}" --max-time 20 "http://localhost:3000/api/jarvis")
c2=$(curl -s -b /tmp/jarvis_cookies.txt -o /dev/null -w "%{http_code}" --max-time 60 "http://localhost:3000/api/jarvis/tts?text=حاضر يا سيدي")
echo "  GET /api/jarvis -> $c1 | GET /api/jarvis/tts -> $c2"

echo ""
echo "### 5) إصلاح التسريب: 3x سؤال السعر — يجب رد نصي بلا JSON خام وخطوات منفذة"
python3 - <<'EOF'
import json, urllib.request, time, http.cookiejar

cj = http.cookiejar.MozillaCookieJar('/tmp/jarvis_cookies.txt')
cj.load(ignore_discard=True, ignore_expires=True)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

for i in range(3):
    req = urllib.request.Request('http://localhost:3000/api/jarvis',
        data=json.dumps({'text': 'كم سعر الذهب الآن؟'}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with opener.open(req, timeout=120) as r:
            steps = []
            for line in r:
                try: j = json.loads(line.strip())
                except Exception: continue
                if j.get('t') == 'step': steps.append(f"{j.get('label')}")
                if j.get('t') == 'reply':
                    rep = j.get('reply', '')
                    leak = rep.strip().startswith('{')
                    print(f"run{i+1}: steps={steps[:3]} leak={leak}")
                    print(f"   reply: {rep[:150]}")
    except Exception as e:
        print(f"run{i+1}: FAILED {e}")
    time.sleep(1)
EOF

echo ""
echo "### 6) باك تيست 2025 بعد الإصلاح (بجلسة صالحة)"
python3 - <<'EOF'
import json, urllib.request, http.cookiejar
cj = http.cookiejar.MozillaCookieJar('/tmp/jarvis_cookies.txt')
cj.load(ignore_discard=True, ignore_expires=True)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request('http://localhost:3000/api/jarvis',
    data=json.dumps({'text': 'اعمل باك تيست لسنة 2025'}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
with opener.open(req, timeout=180) as r:
    for line in r:
        try: j = json.loads(line.strip())
        except Exception: continue
        if j.get('t') == 'step': print(f"  STEP: {j.get('label')} ok={j.get('ok')}")
        if j.get('t') == 'reply':
            rep = j.get('reply', '')
            print(f"  leak={rep.strip().startswith('{')} | {rep[:200]}")
EOF
echo "### DONE"
