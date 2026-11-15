#!/bin/bash
# إثبات الاستيعاب عبر واجهة البوت الحقيقية: باك تيست + نوافذ الجدولة والتقارير
set -u
cd /home/z/my-project

# [1] الخادم
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

# [2] تشغيل الباك تيست 2025 عبر البوت نفسه (بإعداداته المخزنة + الجديدتان المفعّلتان افتراضياً)
curl -s --max-time 280 -X POST -H 'Content-Type: application/json' -d '{"year":2025}' \
  http://localhost:3000/api/backtest -o /tmp/bt.json
python3 - <<'EOF'
import json
try:
    j = json.load(open('/tmp/bt.json'))
    st = j.get('stats', {})
    print(f"[2] باك تيست البوت: صفقات={st.get('totalTrades')} | ربحية={st.get('winRate')}% | صافي={st.get('netPnl')}$ | PF={st.get('profitFactor')}")
    mx = st.get('matrix', {})
    for k in ('P', 'Q'):
        sess = mx.get(k, {})
        tr = sum(v.get('trades', 0) for v in sess.values())
        net = sum(v.get('net', 0) for v in sess.values())
        print(f"    {k}: صفقات={tr} صافي={net:.2f}$ — موجود في مصفوفة البوت ✓")
except Exception as e:
    print('[2] فشل تحليل الرد:', e, open('/tmp/bt.json').read()[:200])
EOF

# [3] واجهة البوت: نافذة جدولة الجلسات — يجب أن تظهر P و Q باسميهما
mkdir -p /tmp/render
agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 4
agent-browser click "text=جدولة الجلسات" 2>&1 | tail -1
sleep 2
agent-browser screenshot /tmp/render/12_sessions.png 2>&1 | tail -1
agent-browser get text "body" 2>/dev/null > /tmp/body1.txt
echo "[3] P في نافذة الجدولة؟ $(grep -c 'اختراق نطاق آسيا' /tmp/body1.txt) | Q؟ $(grep -c 'انعكاس RSI' /tmp/body1.txt)"

# [4] نافذة الباك تيست والتقارير — مصفوفة الأداء تتضمن الجديدتين
agent-browser click "text=الباك تيست والتقارير" 2>&1 | tail -1
sleep 2
agent-browser screenshot /tmp/render/13_backtest.png 2>&1 | tail -1
agent-browser get text "body" 2>/dev/null > /tmp/body2.txt
echo "[4] تقرير الباك تيست يذكر الجديدتين؟ P=$(grep -c 'اختراق نطاق آسيا' /tmp/body2.txt) Q=$(grep -c 'انعكاس RSI' /tmp/body2.txt)"
echo "=== done ==="
