#!/usr/bin/env python3
# ============================================================
# جولة التحسين الثالثة (مصححة): مصفوفة الأساس = النتيجة الكاملة 2043 صفقة
# تقليم ثابت موثق + ترتيبات السلم + EMA — كلها على نفس الأساس الصحيح
# ============================================================
import sqlite3, json, urllib.request, time

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

# ---------- مصفوفة الأساس: القياس الكامل الموثق (كل الجلسات — 2043 صفقة، +2072.32$) ----------
# net بالدولار (عدد الصفقات) لكل استراتيجية × جلسة — من القياس الأول الكامل
BASE_MATRIX = {
    'A': {'asia': (-22.6, 2), 'londonNY': (-11.3, 1)},
    'B': {'london': (-10.3, 1)},
    'C': {'asia': (123.7, 28), 'london': (40.7, 17), 'londonNY': (-71.4, 12), 'ny': (-101.2, 17)},
    'D': {'asia': (81.6, 27), 'london': (-11.1, 6), 'londonNY': (-10.3, 1), 'ny': (18.9, 2)},
    'E': {'asia': (-87.8, 50), 'london': (-59.8, 11), 'londonNY': (7.1, 8), 'ny': (24.3, 6)},
    'F': {'asia': (136.2, 76), 'london': (33.2, 7), 'londonNY': (-1.8, 6), 'ny': (21.5, 10)},
    'G': {'asia': (13.4, 17), 'london': (-4.8, 5), 'londonNY': (8.5, 5), 'ny': (-21.6, 8)},
    'H': {'asia': (306.1, 53), 'london': (-12.1, 13), 'londonNY': (-69.3, 18), 'ny': (49.0, 17)},
    'I': {'asia': (57.6, 75), 'london': (-105.9, 42), 'londonNY': (26.7, 33), 'ny': (123.4, 21)},
    'J': {'asia': (132.7, 34), 'london': (18.2, 5), 'londonNY': (100.5, 12), 'ny': (75.7, 6)},
    'K': {'asia': (55.3, 559), 'london': (148.8, 146), 'londonNY': (-153.9, 102), 'ny': (284.8, 94)},
    'L': {'asia': (493.9, 122)},
    'M': {'asia': (-32.0, 87)},
    'N': {'asia': (11.9, 89)},
    'P': {'london': (-33.2, 30), 'londonNY': (75.0, 5), 'ny': (10.2, 1)},
    'Q': {'asia': (73.5, 40), 'london': (-106.0, 8), 'londonNY': (-26.0, 9), 'ny': (-10.7, 6)},
    'R': {'asia': (188.8, 57), 'london': (224.7, 20), 'londonNY': (55.8, 8), 'ny': (13.4, 8)},
}
matrix = BASE_MATRIX

pruned = {s: {k: True for k in SESSIONS} for s in ALL_STRATS}
pruned['Z'] = {k: False for k in SESSIONS}
cuts = []
for strat, per in matrix.items():
    for sess, (net, trades) in per.items():
        if trades >= 8 and net < -20:
            pruned[strat][sess] = False
            cuts.append(f"{strat}.{sess}:{net}$")
print('التقليم الأساسي:', cuts)

strict = json.loads(json.dumps(pruned))
cuts2 = []
for strat, per in matrix.items():
    for sess, (net, trades) in per.items():
        if trades >= 10 and net < 0 and strict[strat][sess]:
            strict[strat][sess] = False
            cuts2.append(f"{strat}.{sess}:{net}$")
print('التقليم الصارم الإضافي:', cuts2)
print()

def variant(sessions, priority, ema=False):
    return {
        'sessions': sessions, 'tpRatio': 2, 'priority': priority,
        'indicators': {'sessionTiming': True, 'ema': ema, 'emaFast': 20, 'emaSlow': 90},
        'manualLevels': {'enabled': True, 'levels': []},
    }

results = []
def run(name, cfg):
    save_settings(cfg)
    d = api_post('/api/backtest', {})
    s = d.get('stats', {})
    if not s or 'error' in d:
        print(f'[{name}] ERROR:', d.get('error')); return
    months = (s['endT'] - s['startT']) / 86400e3 / 30.44
    monthly = s['netPnl'] / months
    results.append((name, cfg, s, months, monthly))
    print(f"[{name}] صفقات {s['totalTrades']} | نجاح {round(s['winRate'],1)}% | صافي {round(s['netPnl'],2)}$ | PF {round(s['profitFactor'],2)} | ** {round(monthly,2)}$/شهر **")

run('V1 أساس مقلم + أولوية افتراضية', variant(pruned, ['counter', 'close100', 'far100']))
run('S1 تقليم صارم + أولوية افتراضية', variant(strict, ['counter', 'close100', 'far100']))
run('S2 تقليم صارم + close100 أولاً', variant(strict, ['close100', 'counter', 'far100']))
run('S3 تقليم صارم + far100 أولاً', variant(strict, ['far100', 'close100', 'counter']))
run('S4 تقليم صارم + EMA مفعّل', variant(strict, ['counter', 'close100', 'far100'], True))

best = max(results, key=lambda r: r[4])
print()
print('=== الفائز:', best[0], '—', round(best[4], 2), '$/شهر ===')
with open('/tmp/best_variant.json', 'w') as f:
    json.dump({'name': best[0], 'settings': best[1], 'monthly': best[4]}, f, ensure_ascii=False)
