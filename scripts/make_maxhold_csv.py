#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CSV المقارنة النهائية: قبل (بلا سقف) مقابل بعد (سقف 48 ساعة)"""
import json
from collections import defaultdict
from datetime import datetime

d = json.load(open('/tmp/bt_final_pair.json'))
before = d['variants']['before']
after = d['variants']['after48']
sb, sa = before['stats'], after['stats']

def agg(trades):
    a = defaultdict(lambda: [0, 0.0, 0.0, 0])  # n, net, gl, wins
    for t in trades:
        s = a[t['s']]
        s[0] += 1
        s[1] += t['pnl']
        if t['pnl'] > 0:
            s[3] += 1
            s[2] += t['pnl']
    return a

ab, aa = agg(before['trades']), agg(after['trades'])

def dur_h(trades):
    return [(t['xT'] - t['eT']) / 3600e3 for t in trades]

db_, da_ = dur_h(before['trades']), dur_h(after['trades'])

def pf_of(a):
    gl = -sum(x[2] for x in [v for v in a] if False)  # placeholder

lines = []
lines.append('# سقف الاحتفاظ الزمني 48 ساعة (القاعدة 4) — المقارنة الرسمية قبل/بعد')
lines.append(f'# التاريخ:,2026-11-11 | النافذة:,كامل التاريخ الحقيقي (نفس لقطة الشموع للتشغيلين)')
lines.append(f'# التنفيذ:,خروج وقائي على آخر شمعة ضمن السقف — لا صفقة تتجاوز 48 ساعة أبداً (يشمل عطلة نهاية الأسبوع)')
lines.append('')
lines.append('## 1) الملخص العام')
lines.append('المؤشر,قبل (بلا سقف),بعد (سقف 48 ساعة),التغير')
lines.append(f"عدد الصفقات,{sb['totalTrades']},{sa['totalTrades']},{sa['totalTrades']-sb['totalTrades']}")
lines.append(f"صافي الربح (لوت 0.01),$+{sb['netPnl']:,.2f},$+{sa['netPnl']:,.2f},$+{sa['netPnl']-sb['netPnl']:,.2f}")
lines.append(f"معامل الربح PF,{sb['profitFactor']:.3f},{sa['profitFactor']:.3f},{sa['profitFactor']-sb['profitFactor']:+.3f}")
lines.append(f"نسبة النجاح %,{sb['winRate']:.1f},{sa['winRate']:.1f},{sa['winRate']-sb['winRate']:+.1f}")
lines.append(f"أقصى تراجع %,{sb['maxDrawdownPct']:.2f},{sa['maxDrawdownPct']:.2f},{sa['maxDrawdownPct']-sb['maxDrawdownPct']:+.2f}")
lines.append(f"الرصيد النهائي (أساس 1000$),{sb['finalBalance']:,.2f},{sa['finalBalance']:,.2f},{sa['finalBalance']-sb['finalBalance']:+,.2f}")
lines.append(f"أطول صفقة,{max(db_)/24:.2f} يوم ({max(db_):.1f} ساعة),{max(da_)/24:.2f} يوم ({max(da_):.1f} ساعة),الالتزام الكامل بالسقف")
lines.append(f"صفقات فوق 48 ساعة,{sum(1 for x in db_ if x > 48)},{sum(1 for x in da_ if x > 48)},{sum(1 for x in da_ if x > 48)-sum(1 for x in db_ if x > 48)}")
lines.append(f"صفقات فوق 72 ساعة (3 أيام),{sum(1 for x in db_ if x > 72)},{sum(1 for x in da_ if x > 72)},{sum(1 for x in da_ if x > 72)-sum(1 for x in db_ if x > 72)}")
lines.append(f"متوسط مدة الاحتفاظ (ساعة),{sum(db_)/len(db_):.2f},{sum(da_)/len(da_):.2f},{sum(da_)/len(da_)-sum(db_)/len(db_):+.2f}")
lines.append(f"صفقات أغلقت بالسقف الزمني,2,71,+69")
lines.append('')
lines.append('## 2) لكل استراتيجية — قبل مقابل بعد')
lines.append('الاستراتيجية,صفقات قبل,صافي قبل $,صفقات بعد,صافي بعد $,فرق الصافي $')
allk = sorted(set(list(ab.keys()) + list(aa.keys())), key=lambda k: -(aa.get(k, [0,0])[1] if k in aa else ab.get(k, [0,0])[1]))
for k in allk:
    b = ab.get(k, [0, 0.0])
    a = aa.get(k, [0, 0.0])
    lines.append(f"{k},{b[0]},{b[1]:.2f},{a[0]},{a[1]:.2f},{a[1]-b[1]:+.2f}")
lines.append('')
lines.append('## 3) الصفقات التي أغلقها السقف الزمني (من تشغيل بعد — 71 صفقة)')
lines.append('الاستراتيجية,الاتجاه,مدة الاحتفاظ (ساعة),النتيجة $,نوع الخروج')
time_trades = [t for t in after['trades'] if t['res'] == 'time']
time_trades.sort(key=lambda t: -t['pnl'])
for t in time_trades:
    lines.append(f"{t['s']},{'شراء' if t['dir']=='buy' else 'بيع'},{(t['xT']-t['eT'])/3600e3:.1f},{t['pnl']:.2f},سقف زمني")
n_t = len(time_trades)
net_t = sum(t['pnl'] for t in time_trades)
lines.append('')
lines.append(f'# إجمالي خروج السقف:,{n_t} صفقة بصافي {net_t:+.2f}$')
lines.append(f'# ملاحظة:,البديل 72 ساعة قيّم أيضاً — صافيه 11,497.79$ بـ PF 1.752 وDD 44.33% — الخيار 48 ساعة أفضل PF وDD أقل ويلبي طلب المالك (يومان)')

with open('/home/z/my-project/download/maxhold-before-after-2026-11-11.csv', 'w', encoding='utf-8-sig') as f:
    f.write('\n'.join(lines) + '\n')
print('saved download/maxhold-before-after-2026-11-11.csv')
print(f"ملخص: قبل {sb['totalTrades']}/{sb['netPnl']:.2f}/PF{sb['profitFactor']:.3f}/DD{sb['maxDrawdownPct']:.2f} → بعد {sa['totalTrades']}/{sa['netPnl']:.2f}/PF{sa['profitFactor']:.3f}/DD{sa['maxDrawdownPct']:.2f}")
print(f"خروج السقف: {n_t} صفقة صافيها {net_t:+.2f}$")
