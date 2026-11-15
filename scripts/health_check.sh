#!/bin/bash
# الفحص الصحي الشامل للبوت — جلسة واحدة حية
set -u
cd /home/z/my-project

setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
code="000"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "### SERVER: $code"
[ "$code" != "200" ] && { tail -15 /tmp/devsrv.log; exit 1; }

echo ""
echo "### GET API PROBES (code | ms | bytes)"
for ep in "api/mt5/status" "api/mt5/tick" "api/price" "api/signals" "api/settings" "api/backtest?meta=1" "api/news" "api/chart" "api/forecast" "api/decisions" "api/trainer" "api/system" "api/jarvis"; do
  r=$(curl -s -o /tmp/probe.json -w "%{http_code}|%{time_total}|%{size_download}" --max-time 25 "http://localhost:3000/$ep" 2>/dev/null)
  echo "  /$ep -> $r"
done

echo ""
echo "### MT5 INGEST AUTH (بدون توكن يجب 401)"
n=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/mt5/ingest -H 'Content-Type: application/json' -d '{"tick":{}}' --max-time 10)
echo "  no-token -> $n"

echo ""
python3 - <<'EOF'
import json, time, datetime, urllib.request

print("### MT5 DATA FRESHNESS & COVERAGE")
try:
    d = json.load(open('db/mt5-feed-snapshot.json'))
    saved = d.get('savedAt') or d.get('updatedAt')
    age_min = (time.time()*1000 - saved) / 60000
    print(f"  snapshot age: {age_min:.1f} min (savedAt={datetime.datetime.utcfromtimestamp(saved/1000)} UTC)")
    tick = d.get('tick') or {}
    tt = tick.get('t') or tick.get('time') or 0
    if tt:
        tage = (time.time()*1000 - tt)/60000
        print(f"  last tick: {datetime.datetime.utcfromtimestamp(tt/1000)} UTC ({tage:.1f} min ago), bid={tick.get('bid')}")
    print(f"  account: {d.get('broker')} #{d.get('account')}")
    tfs = d.get('tfs', {})
    now_ms = time.time()*1000
    for tf, arr in tfs.items():
        if isinstance(arr, list) and arr:
            last = arr[-1][0]; gap_h = (now_ms - last)/3600e3
            print(f"  {tf}: {len(arr):>6} candles, last candle {gap_h:5.1f}h ago")
except Exception as e:
    print(f"  ERROR: {e}")

print("")
print("### GUARDIAN LOG (آخر الحالة)")
try:
    g = json.load(open('db/guardian-log.json'))
    entries = g if isinstance(g, list) else g.get('entries', [])
    print(f"  entries: {len(entries)}")
    fails = [e for e in entries if isinstance(e, dict) and not e.get('ok', True)]
    print(f"  failed checks: {len(fails)}")
    for e in entries[-3:]:
        if isinstance(e, dict):
            print(f"  last: {datetime.datetime.utcfromtimestamp(e.get('t', 0)/1000)} ok={e.get('ok')} {str(e.get('summary') or e.get('msg') or '')[:100]}")
except Exception as e:
    print(f"  ERROR: {e}")

print("")
print("### NEWS CACHE (فلتر الأخبار)")
try:
    row = None
    import sqlite3
    con = sqlite3.connect('db/custom.db')
    cur = con.execute("SELECT json FROM BotSettings WHERE key='newsCache'")
    r = cur.fetchone()
    if r:
        j = json.loads(r[0])
        up = j.get('updatedAt', 0)
        ev = j.get('events', [])
        days = (time.time()*1000 - up)/86400e3
        print(f"  events: {len(ev)}, updated {days:.1f} days ago {'(STALE >7d — فلتر معطل)' if days > 7 else '(fresh)'}")
    else:
        print("  NO newsCache row — فلتر الأخبار بلا بيانات")
except Exception as e:
    print(f"  ERROR: {e}")

print("")
print("### DB ROW COUNTS")
try:
    con = sqlite3.connect('db/custom.db')
    for tbl in ['BotSettings','LiveSignal','BacktestRun','Decision','TrainerReport']:
        try:
            n = con.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
            print(f"  {tbl}: {n}")
        except Exception as ex:
            print(f"  {tbl}: (no table) {str(ex)[:60]}")
except Exception as e:
    print(f"  ERROR: {e}")
EOF

echo ""
echo "### JARVIS LIVE LOOP (سؤال سعر — يجب رد بأرقام حية بلا خطأ)"
python3 - <<'EOF'
import json, urllib.request, time
req = urllib.request.Request('http://localhost:3000/api/jarvis',
    data=json.dumps({'text': 'كم سعر الذهب الآن؟'}).encode(),
    headers={'Content-Type': 'application/json'}, method='POST')
t0 = time.time()
reply = ''
try:
    with urllib.request.urlopen(req, timeout=90) as r:
        for line in r:
            try: j = json.loads(line.strip())
            except Exception: continue
            if j.get('t') == 'reply': reply = j.get('reply', ''); print(f"  REPLY in {time.time()-t0:.0f}s: {reply[:200]}")
            if j.get('t') == 'error': print(f"  ERROR: {j.get('message')}")
except Exception as e:
    print(f"  FAILED: {e}")
EOF

echo ""
echo "### BACKTEST RUN (2025 عبر الواجهة المباشرة)"
curl -s -X POST http://localhost:3000/api/backtest -H 'Content-Type: application/json' -d '{"year":2025}' --max-time 120 -o /tmp/bt.json -w "  HTTP %{http_code} in %{time_total}s\n"
python3 - <<'EOF'
import json
try:
    j = json.load(open('/tmp/bt.json'))
    s = (j.get('stats') or j.get('data', {}).get('stats') or {})
    if s:
        print(f"  trades={s.get('totalTrades')} winRate={s.get('winRate')} net={s.get('netPnl')} pf={s.get('profitFactor')}")
    else:
        print(f"  keys: {list(j.keys())[:8]} | head: {json.dumps(j, ensure_ascii=False)[:200]}")
except Exception as e:
    print(f"  parse ERROR: {e}")
EOF
echo "### DONE"
