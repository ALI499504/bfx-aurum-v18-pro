#!/usr/bin/env python3
# ============================================================
# جولة التحسين الثانية: ترتيبات سلم الأولويات + فلتر EMA + تقليم صارم
# (كلها روافع واردة في الدليل: السلم قابل لإعادة الترتيب، وEMA 20/90 من نافذة المؤشرات)
# ============================================================
import sqlite3, json, urllib.request, time, itertools

API = 'http://localhost:3000'
SESSIONS = ['asia', 'london', 'londonNY', 'ny']
ALL_STRATS = [chr(x) for x in range(ord('A'), ord('R') + 1)]

def api_post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=290) as r:
        return json.load(r)

def save_settings(s):
    c = sqlite3.connect('db/custom.db')
    c.execute("INSERT OR REPLACE INTO BotSettings (key, json, updatedAt) VALUES ('main', ?, ?)",
              (json.dumps(s), int(time.time() * 1000)))
    c.commit(); c.close()

# خريطة الجلسات المقلمة (الجولة الأولى) — من مصفوفة أحدث نتيجة
c = sqlite3.connect('db/custom.db')
stats = json.loads(c.execute('SELECT statsJson FROM BacktestRun ORDER BY runAt DESC LIMIT 1').fetchone()[0])
c.close()
pruned = {s: {k: True for k in SESSIONS} for s in ALL_STRATS}
pruned['Z'] = {k: False for k in SESSIONS}
for strat, per in stats.get('matrix', {}).items():
    for sess, v in per.items():
        if v and v.get('trades', 0) >= 8 and v.get('net', 0) < -20:
            pruned[strat][sess] = False
# تقليم صارم إضافي: أي زوج صافيه سالب بعينة >= 10
strict = json.loads(json.dumps(pruned))
for strat, per in stats.get('matrix', {}).items():
    for sess, v in per.items():
        if v and v.get('trades', 0) >= 10 and v.get('net', 0) < 0:
            strict[strat][sess] = False

def variant(sessions, priority, ema):
    return {
        'sessions': sessions, 'tpRatio': 2, 'priority': priority,
        'indicators': {'sessionTiming': True, 'ema': ema, 'emaFast': 20, 'emaSlow': 90},
        'manualLevels': {'enabled': True, 'levels': []},
    }

PRIORITIES = [
    ['counter', 'close100', 'far100'],   # الافتراضي
    ['close100', 'counter', 'far100'],
    ['close100', 'far100', 'counter'],
    ['far100', 'close100', 'counter'],
    ['far100', 'counter', 'close100'],
    ['counter', 'far100', 'close100'],
]

results = []
def run(name, cfg):
    save_settings(cfg)
    d = api_post('/api/backtest', {})
    s = d.get('stats', {})
    if not s or 'error' in d:
        print(f'[{name}] ERROR:', d.get('error')); return
    months = (s['endT'] - s['startT']) / 86400e3 / 30.44
    monthly = s['netPnl'] / months
    results.append((name, s, months, monthly))
    print(f"[{name}] صفقات {s['totalTrades']} | نجاح {round(s['winRate'],1)}% | صافي {round(s['netPnl'],2)}$ | PF {round(s['profitFactor'],2)} | ** {round(monthly,2)}$/شهر **")

print('=== سلم الأولويات (على الجلسات المقلمة) ===')
for i, p in enumerate(PRIORITIES):
    run(f'P{i+1} أولوية {p[0]} أولاً', variant(pruned, p, False))

print('=== فلتر EMA 20/90 ===')
run('EMA مفعّل + الأولوية الافتراضية', variant(pruned, PRIORITIES[0], True))

print('=== التقليم الصارم (كل سالب بعينة >=10) ===')
run('تقليم صارم + أولوية افتراضية', variant(strict, PRIORITIES[0], False))

best = max(results, key=lambda r: r[3])
print()
print('=== الفائز:', best[0], '—', round(best[3], 2), '$/شهر ===')
