#!/bin/bash
# إثبات حي: استراتيجية جديدة R أُعطيت للبوت — هل فهمها وأتقن استخدامها؟
set -u
cd /home/z/my-project

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

# [2] جلسات R في الإعدادات المدموجة (قاعدة بيانات قديمة + افتراضي جديد)؟
curl -s --max-time 10 http://localhost:3000/api/settings | python3 -c "
import json,sys
s=json.load(sys.stdin)['settings']
print('[2] sessions.R =', s['sessions'].get('R'))"

# [3] تشغيل باك تيست كامل (2025 حقيقي) بالكود الجديد الذي يتضمن R
echo -n '[3] '
curl -s -X POST --max-time 240 http://localhost:3000/api/backtest -o /tmp/bt_post.json -w 'backtest POST: HTTP %{http_code} in %{time_total}s\n'

# [4] استخراج أرقام R من النتيجة الحقيقية
python3 - <<'EOF'
import json
j = json.load(open('/tmp/bt_post.json'))
if not j.get('stats'):
    print('[4] فشل:', j); raise SystemExit(1)
st = j['stats']; tr = j.get('trades', [])
print('[4] النتيجة الكاملة:', st['totalTrades'], 'صفقة | صافي', round(st['netPnl'],2), 'USD | ربحية', round(st['winRate'],1), '% | PF', round(st['profitFactor'],2), '| مدة التشغيل', st.get('runMs'), 'ms')
print('[strategies في النتيجة] =', sorted(set(t['strategy'] for t in tr)))
rt = [t for t in tr if t['strategy'] == 'R']
print('[R] صفقات الاستراتيجية الجديدة:', len(rt))
if rt:
    wins = sum(1 for t in rt if t['pnl'] > 0)
    net = sum(t['pnl'] for t in rt)
    print('[R] رابحة:', wins, '| خاسرة:', len(rt)-wins, '| نسبة الربح:', round(100*wins/len(rt),1), '% | صافي R:', round(net,2), 'USD')
    ses = {}
    for t in rt:
        ses.setdefault(t['session'], [0,0.0])
        ses[t['session']][0] += 1; ses[t['session']][1] += t['pnl']
    print('[R] بالجلسات:', {k: (v[0], round(v[1],1)) for k,v in ses.items()})
    t0 = rt[0]
    print('[R] نموذج صفقة:', {k: t0[k] for k in ('strategy','dir','entry','sl','tp','result','pnl','session','lot')})
    print('[R] مسبب الدخول:', t0['reason'][:100])
    print('[R] آخر صفقة R:', {k: rt[-1][k] for k in ('dir','entry','result','pnl')}, '| وقتها:', rt[-1]['entryT'])
m = st.get('matrix', {}).get('R')
print('[R] مصفوفة الجلسات:', m)
tots = st.get('strategyTotals', {}).get('R')
print('[R] إجماليها في strategyTotals:', tots)
rank = st.get('ranking', [])
print('[ترتيب الاستراتيجيات] =', [(r['strategy'], round(r['net'],1), r['trades']) for r in rank])
EOF
echo "=== done ==="
