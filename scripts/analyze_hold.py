#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليل مدد الاحتفاظ بالصفقات من /tmp/bt_trades.json"""
import json, statistics
from collections import defaultdict

with open('/tmp/bt_trades.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

trades = data['trades']
st = data['stats']
print(f"=== إحصائيات التشغيل الحالي (بعد البوابات 31/32/33) ===")
print(f"trades={st.get('totalTrades')} net={st.get('netPnl'):.2f} PF={st.get('profitFactor'):.3f} "
      f"wr={st.get('winRate'):.1f}% DD={st.get('maxDrawdownPct'):.2f}%")
ag = st.get('adaptiveGates')
if ag: print(f"adaptiveGates: sideGuard={ag.get('sideGuard')} decayGuard={ag.get('decayGuard')} boosted={ag.get('boostedFills')}")

H = 3600e3
durs = [(t['xT'] - t['eT']) / H for t in trades]  # ساعات
print(f"\n=== توزيع مدد الاحتفاظ (ساعات) — {len(trades)} صفقة ===")
buckets = [(1, 'أقل من ساعة'), (4, '1-4 س'), (8, '4-8 س'), (24, '8-24 س'), (48, '24-48 س'),
           (72, '48-72 س'), (120, '72-120 س (2-5 أيام)'), (10**9, 'فوق 120 س (>5 أيام)')]
prev = 0
for lim, label in buckets:
    grp = [(d, t) for d, t in zip(durs, trades) if prev <= d < lim]
    net = sum(t['pnl'] for _, t in grp)
    n = len(grp)
    print(f"{label:22s} | n={n:5d} ({n/len(trades)*100:5.1f}%) | net={net:9.2f}$ | متوسط={net/n if n else 0:7.3f}$")
    prev = lim

mx = max(durs)
print(f"\nأطول صفقة: {mx/24:.1f} يوم")
over48 = [(d, t) for d, t in zip(durs, trades) if d > 48]
over72 = [(d, t) for d, t in zip(durs, trades) if d > 72]
print(f"صفقات > 48 ساعة: {len(over48)} | صافيها الحالي: {sum(t['pnl'] for _, t in over48):.2f}$")
print(f"صفقات > 72 ساعة: {len(over72)} | صافيها الحالي: {sum(t['pnl'] for _, t in over72):.2f}$")

print("\n=== الاستراتيجيات ذات الصفقات > 48 ساعة ===")
agg = defaultdict(lambda: [0, 0.0])
for d, t in over48:
    agg[t['s']][0] += 1
    agg[t['s']][1] += t['pnl']
for s, (n, net) in sorted(agg.items(), key=lambda kv: -kv[1][1]):
    all_t = [t for t in trades if t['s'] == s]
    anet = sum(t['pnl'] for t in all_t)
    print(f"{s:3s} | >48س: {n:3d} | صافيها {net:9.2f}$ | إجمالي الاستراتيجية {anet:9.2f}$ على {len(all_t)} صفقة")

# النتائج حسب نوع الخروج
print("\n=== نوع الخروج ===")
res_agg = defaultdict(lambda: [0, 0.0])
for t in trades:
    res_agg[t['res']][0] += 1
    res_agg[t['res']][1] += t['pnl']
for r, (n, net) in sorted(res_agg.items(), key=lambda kv: -kv[1][1]):
    print(f"{r:8s} | n={n:5d} | net={net:9.2f}$")

# الصفقات القديمة (نتيجة نهائية) vs لو أُغلقت عند 48 س — تقريب: لو الصفقة بائت >48 وربحت، عند 48س قد تكون رابحة أو خاسرة
# نحتاج مسار السعر — لا يمكن تقديره هنا بدقة؛ الاعتماد على إعادة تشغيل الباك تست بالسقف الجديد
print("\n(التقدير الدقيق لأثر السقف يتطلب إعادة تشغيل الباك تست بالسقف — يتم لاحقاً)")
