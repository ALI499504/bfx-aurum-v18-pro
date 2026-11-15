#!/usr/bin/env python3
# اختبار إصلاح التسريب + الباك تيست بجلسة صالحة (مصادقة داخلية)
import json, urllib.request, urllib.parse, http.cookiejar, time

BASE = 'http://localhost:3000'
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

# 1) فتح القفل بالرمز الصحيح
req = urllib.request.Request(f'{BASE}/api/jarvis/auth',
    data=json.dumps({'code': 'ali12345'}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
with opener.open(req, timeout=30) as r:
    print(f"auth: {r.status} cookies={len(list(jar))}")

# 2) إصلاح التسريب — 3x سؤال السعر
for i in range(3):
    req = urllib.request.Request(f'{BASE}/api/jarvis',
        data=json.dumps({'text': 'كم سعر الذهب الآن؟'}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with opener.open(req, timeout=120) as r:
            steps = []
            for line in r:
                try: j = json.loads(line.strip())
                except Exception: continue
                if j.get('t') == 'step': steps.append(str(j.get('label')))
                if j.get('t') == 'reply':
                    rep = j.get('reply', '')
                    leak = rep.strip().startswith('{')
                    print(f"run{i+1}: steps={steps[:4]} leak={leak}")
                    print(f"   reply: {rep[:160]}")
    except Exception as e:
        print(f"run{i+1}: FAILED {e}")
    time.sleep(1)

# 3) باك تيست 2025 بعد الإصلاح
print("\nbacktest-2025:")
req = urllib.request.Request(f'{BASE}/api/jarvis',
    data=json.dumps({'text': 'اعمل باك تيست لسنة 2025'}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
with opener.open(req, timeout=180) as r:
    for line in r:
        try: j = json.loads(line.strip())
        except Exception: continue
        if j.get('t') == 'step': print(f"  STEP: {j.get('label')} ok={j.get('ok')}")
        if j.get('t') == 'reply':
            rep = j.get('reply', '')
            print(f"  leak={rep.strip().startswith('{')}")
            print(f"  reply: {rep[:260]}")

# 4) الصوت بجلسة صالحة
q = urllib.parse.quote('حاضر يا سيدي.')
req = urllib.request.Request(f'{BASE}/api/jarvis/tts?text={q}')
with opener.open(req, timeout=60) as r:
    body = r.read()
    print(f"\ntts: {r.status} {r.headers.get('Content-Type')} {len(body)}B")
