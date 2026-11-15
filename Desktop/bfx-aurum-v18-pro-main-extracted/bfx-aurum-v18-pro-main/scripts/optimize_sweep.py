#!/usr/bin/env python3
# ============================================================
# مصفوفة تحسين نظام TAMSA — مرحلة الوصول لهدف 400$/شهر
# القاعدة: تقليم أزواج (استراتيجية×جلسة) الخاسرة صافي < -20$ بعينة >= 8 صفقات
# + اختبار tp_ratio 1:2 و 1:3 (القاعدة 14 تسمح حتى 1:3) — اللوت ثابت 0.01 حرفياً
# ============================================================
import sqlite3, json, urllib.request, copy, sys

API = 'http://localhost:3000'

def api_post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=290) as r:
        return json.load(r)

def save_settings(s):
    c = sqlite3.connect('db/custom.db')
    c.execute("INSERT OR REPLACE INTO BotSettings (key, json, updatedAt) VALUES ('main', ?, ?)",
              (json.dumps(s), __import__('time').intents if False else int(__import__('time').time() * 1000)))
    c.commit(); c.close()

def latest_matrix():
    c = sqlite3.connect('db/custom.db')
    row = c.execute('SELECT statsJson FROM BacktestRun ORDER BY runAt DESC LIMIT 1').fetchone()
    c.close()
    return json.loads(row[0])

# ---------- 1) بناء خريطة الجلسات المقلمة من المصفوفة ----------
stats = latest_matrix()
matrix = stats.get('matrix', {})
SESSIONS = ['asia', 'london', 'londonNY', 'ny']
ALL_STRATS = [chr(x) for x in range(ord('A'), ord('R') + 1)]

def sessions_all(on=True):
    return {s: {k: on for k in SESSIONS} for s in ALL_STRATS} | {'Z': {k: False for k in SESSIONS}}

pruned = sessions_all()
cut_log = []
for strat, per in matrix.items():
    for sess, v in per.items():
        if v and v.get('trades', 0) >= 8 and v.get('net', 0) < -20:
            pruned[strat][sess] = False
            cut_log.append(f"{strat}.{sess}: {round(v['net'],1)}$ ({v['trades']} صفقة)")

print('=== التسليمات المقلمة (net<-20$ و >=8 صفقات) ===')
for l in cut_log: print('  ✂', l)
print()

# ---------- 2) التوليفات ----------
def base_settings(sessions, tp):
    return {
        'sessions': sessions,
        'tpRatio': tp,
        'priority': ['counter', 'close100', 'far100'],
        'indicators': {'sessionTiming': True, 'ema': False, 'emaFast': 20, 'emaSlow': 90},
        'manualLevels': {'enabled': True, 'levels': []},
    }

VARIANTS = [
    ('V0 أساس: الكل مفعّل + هدف 1:2 (الوضع الحالي)', sessions_all(), 2),
    ('V1 تقليم الجلسات الخاسرة + هدف 1:2', pruned, 2),
    ('V2 الكل مفعّل + هدف 1:3', sessions_all(), 3),
    ('V3 تقليم الجلسات الخاسرة + هدف 1:3', pruned, 3),
]

results = []
for name, sess, tp in VARIANTS:
    save_settings(base_settings(sess, tp))
    d = api_post('/api/backtest', {})
    if 'error' in d:
        print(f'[{name}] ERROR:', d['error']); sys.exit(1)
    s = d['stats']
    import datetime
    days = (s['endT'] - s['startT']) / 86400e3
    months = days / 30.44
    monthly = s['netPnl'] / months
    results.append((name, s, months, monthly))
    print(f"[{name}]")
    print(f"   صفقات: {s['totalTrades']} | نجاح: {round(s['winRate'],1)}% | صافي: {round(s['netPnl'],2)}$ | PF: {round(s['profitFactor'],2)} | تراجع: {round(s['maxDrawdownPct'],1)}%")
    print(f"   الفترة: {months:.1f} شهر | ** الشهر: {round(monthly,2)}$ **")
    print()

# ---------- 3) اختيار الأفضل ----------
best = max(results, key=lambda r: r[3])
print('=== الفائز:', best[0], '—', round(best[3], 2), '$/شهر ===')
