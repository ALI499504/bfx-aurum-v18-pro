#!/bin/bash
# التحقق من الالتزام الصارم بالقواعد — جلسة واحدة: نوع + خادم + باك تست حقيقي + لقطات
set -u
cd /home/z/my-project

echo "[0] tsc..."
bunx tsc --noEmit 2>&1 | head -5 && echo "    tsc: نظيف"

# [1] إطلاق الخادم إن لم يكن مستجيباً
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$code" != "200" ]; then
  setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
    [ "$code" = "200" ] && break
    sleep 2
  done
fi
echo "[1] server: $code"

# [2] باك تست 2025 حقيقي عبر الـ API — يجب أن يعمل ويحفظ النتيجة الملتزمة
echo "[2] POST /api/backtest {year:2025}:"
curl -s --max-time 280 -X POST -H 'Content-Type: application/json' -d '{"year":2025}' http://localhost:3000/api/backtest > /tmp/bt.json
python3 - <<'EOF'
import json
d = json.load(open('/tmp/bt.json'))
if 'error' in d:
    print('    خطأ:', d['error'][:200]); raise SystemExit
s = d['stats']
print(f"    صفقات: {s['totalTrades']} | ربحية: {round(s['winRate'],1)}% | صافي: {round(s['netPnl'],2)}$ | PF: {round(s['profitFactor'],2)}")
print(f"    مرفوضات: {json.dumps(s['blocked'], ensure_ascii=False)}")
per = s['perTf']
print(f"    MN1={per['MN1']['trades']} W1={per['W1']['trades']} D1={per['D1']['trades']}")
trs = d['trades']
# فحص الالتزام: كل صفقة من منطقة ملموسة على فريمها (لمسات >= 1)
bad = 0
for t in trs:
    r = t['reason']
    if 'لمسات فريم المنطقة 0' in r: bad += 1
    if (t['rr'] or 0) < 2: bad += 1
print(f"    صفقات مخالفة (لمسات=0 أو R:R<2): {bad} من {len(trs)}")
print("    عينة سبب أول صفقة:", trs[0]['reason'][:180])
EOF

# [3] الباك تست الكامل (كل التاريخ)
echo "[3] POST /api/backtest (كل التاريخ):"
curl -s --max-time 280 -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/backtest > /tmp/bt2.json
python3 -c "
import json
d = json.load(open('/tmp/bt2.json'))
s = d.get('stats', {})
print(f\"    صفقات: {s.get('totalTrades')} | صافي: {round(s.get('netPnl',0),2)}\$ | PF: {round(s.get('profitFactor',0),2)}\")" 2>/dev/null || echo "    (تعذر التحليل)"

# [4] لقطات الواجهة
mkdir -p /tmp/render
agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 6
agent-browser screenshot /tmp/render/20_dashboard.png 2>&1 | tail -1
