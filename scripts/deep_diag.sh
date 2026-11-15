#!/bin/bash
# تشخيص معمّق: تسريب JSON في جارفس + بنية سجل الحارس + قاعدة البيانات
set -u
cd /home/z/my-project

setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
code="000"
for i in $(seq 1 30); do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null); [ "$code" = "200" ] && break; sleep 2; done
echo "### SERVER: $code"

echo ""
echo "### reproduce jarvis leak (3x نفس السؤال)"
python3 - <<'EOF'
import json, urllib.request, time
for i in range(3):
    req = urllib.request.Request('http://localhost:3000/api/jarvis',
        data=json.dumps({'text': 'كم سعر الذهب الآن؟'}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            steps = []
            for line in r:
                try: j = json.loads(line.strip())
                except Exception: continue
                if j.get('t') == 'step': steps.append(f"{j.get('label')}({j.get('ok')})")
                if j.get('t') == 'reply':
                    rep = j.get('reply', '')
                    leak = rep.strip().startswith('{')
                    print(f"run{i+1}: steps={steps}")
                    print(f"  reply_leak_json={leak} | reply: {rep[:180]}")
    except Exception as e:
        print(f"run{i+1}: FAILED {e}")
    time.sleep(1)
EOF

echo ""
echo "### guardian-log structure"
python3 - <<'EOF'
import json, datetime
g = json.load(open('db/guardian-log.json'))
print(f"type: {type(g).__name__}")
if isinstance(g, dict):
    print(f"keys: {list(g.keys())[:10]}")
    for k, v in list(g.items())[:3]:
        print(f"  {k}: {type(v).__name__} len={len(v) if hasattr(v,'__len__') else ''}")
        if isinstance(v, list) and v: print(f"    last: {str(v[-1])[:150]}")
elif isinstance(g, list):
    print(f"len: {len(g)}; last: {str(g[-1])[:200] if g else ''}")
EOF

echo ""
echo "### sqlite schema (الجداول الفعلية)"
python3 -c "
import sqlite3
con = sqlite3.connect('db/custom.db')
rows = con.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
print('tables:', [r[0] for r in rows])
"

echo ""
echo "### signals body (ماذا يعود فعلاً)"
curl -s http://localhost:3000/api/signals --max-time 10 | head -c 400; echo ""

echo ""
echo "### settings keys"
curl -s http://localhost:3000/api/settings --max-time 10 | python3 -c "
import json, sys
j = json.load(sys.stdin)
s = j.get('settings') or j
print('strategy keys:', list(s.keys())[:12] if isinstance(s, dict) else type(s).__name__)
"
echo "### DONE"
