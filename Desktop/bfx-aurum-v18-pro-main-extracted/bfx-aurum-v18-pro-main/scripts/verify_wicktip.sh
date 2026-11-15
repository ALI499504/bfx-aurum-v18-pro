#!/bin/bash
# التحقق الشامل من استراتيجية «مناطق الذيل» v1.0 — جلسة واحدة
# [1] خادم [2] بث اللقطة الحقيقية [3] باك تيست 2025 عبر API [4] الإشارات الحية [5] لقطات الواجهة
set -u
cd /home/z/my-project

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

# [2] إعادة بث اللقطة الحقيقية عبر مسار الجسر الرسمي (نفس البيانات 100% — لا محاكاة)
python3 - <<'PY'
import json
d = json.load(open('db/mt5-feed-snapshot.json'))
payload = {
    "symbol": d.get("symbol"), "broker": d.get("broker"), "account": d.get("account"),
    "v": d.get("bridgeV"), "tick": d.get("tick"), "positions": [], "deals": [],
    "tfs": {k: v for k, v in d.get("tfs", {}).items()},
}
open('/tmp/ingest.json', 'w').write(json.dumps(payload))
print('payload bytes:', len(json.dumps(payload)))
PY
echo "[2] ingest: $(curl -s -o /tmp/ing1.json -w '%{http_code}' --max-time 120 -X POST -H 'Content-Type: application/json' -H 'x-bfx-token: bfx-aurum-mt5-v1' --data-binary @/tmp/ingest.json http://localhost:3000/api/mt5/ingest) | $(head -c 200 /tmp/ing1.json)"

# [3] باك تيست 2025 عبر API الرسمي
echo "[3] backtest 2025:"
curl -s -o /tmp/bt.json -w 'http=%{http_code} time=%{time_total}s size=%{size_download}B\n' --max-time 300 -X POST -H 'Content-Type: application/json' -d '{"year": "2025"}' http://localhost:3000/api/backtest
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/bt.json'))
except Exception as e:
    print('parse err:', e, open('/tmp/bt.json').read()[:200]); raise SystemExit
if 'error' in d: print('ERROR:', d['error']); raise SystemExit
s = d['stats']
print('trades:', s['totalTrades'], '| winRate:', round(s['winRate'],1), '| net:', round(s['netPnl'],2), '| PF:', s['profitFactor'])
print('zones formed:', s['zones']['formed'], '| invalidated:', s['zones']['dead'], '| rejections:', s['zones']['strongRejections'])
print('signals:', s['signalsCount'], '| blocked:', s['fillsBlocked'], '| reasons:', json.dumps(s['blocked'], ensure_ascii=False))
print('perTf:', json.dumps({k: {'trades': v['trades'], 'net': round(v['net'],2)} for k,v in s['perTf'].items()}, ensure_ascii=False))
for t in d['trades'][-3:]:
    print(f"trade #{t['id']} {t['dir']} zone={t.get('zoneTf')}#{t.get('zoneId')} score={t.get('score')} dist={t.get('distance')} rr={t.get('rr')} confirm={t.get('confirmationType')}@{t.get('confirmTf')} result={t['result']} pnl={round(t['pnl'],2)}")
PY

# [4] الإشارات الحية (نفس محرك الباك تيست على آخر شمعة مغلقة)
echo "[4] signals:"
curl -s -o /tmp/sig.json -w 'http=%{http_code} time=%{time_total}s\n' --max-time 120 http://localhost:3000/api/signals
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/sig.json'))
except Exception as e:
    print('parse err:', e); raise SystemExit
if not d.get('ok'): print('ERROR:', d.get('error')); raise SystemExit
print('price:', d['price'], '| atrPct:', d['market']['atrPct'], '| spreadCents:', d['market']['spreadCents'])
print('strategy:', d['strategy']['name'])
print('zones قريبة:', len(d['zones']), '| pending:', len(d['pending']))
for z in d['zones'][:4]:
    print(f"  zone {z['tf']} {z['side']} tip={z['tip']} strength={z['strength']} (نفسي={z['roundNumber']} مؤكد={z['confirmedPivot']} ذيل={z['bigTail']} تقاطع={z['confluence']})")
for p in d['pending'][:3]:
    print(f"  pending {p['dir']} {p['confirmTf']} على {p['zoneTf']} tip={p['tip']} — {p['awaiting'][:80]}")
PY

# [5] لقطات الواجهة: لوحة القيادة + الإشارات الحية + الباك تيست
mkdir -p /tmp/render
agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 6
agent-browser screenshot /tmp/render/21_dashboard.png 2>&1 | tail -1
# فتح تبويب الإشارات الحية
agent-browser find text "الإشارات الحية" click 2>/dev/null || agent-browser click "text=الإشارات الحية" 2>/dev/null
sleep 7
agent-browser screenshot /tmp/render/22_signals.png 2>&1 | tail -1
# فتح تبويب الباك تيست
agent-browser find text "الباك تيست والتقارير" click 2>/dev/null || agent-browser click "text=الباك تيست والتقارير" 2>/dev/null
sleep 8
agent-browser screenshot /tmp/render/23_backtest.png 2>&1 | tail -1
echo "[5] screenshots done"
ls -la /tmp/render/