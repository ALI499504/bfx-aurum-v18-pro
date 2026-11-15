#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبار اعتماد الاستراتيجيات على نظام السوق: هل تخسر استراتيجيات الارتداد
في الأشهر ذات الاتجاه القوي؟ (ارتباط الربح الشهري بعائد الذهب الشهري)"""
import sys, datetime as dt
sys.path.insert(0, '/home/z/my-project/scripts')
import strategy_shootout as ss
from strategy_shootout import (load_tf, atr_series, sig_tsmom, sig_ewmac,
                               sig_donchian, sig_rsi2, sig_zfade, sig_bbrevert,
                               sig_squeeze, sig_orb, sig_ogle, sig_fvg,
                               sig_flip_h4, run)

ALL = [
    ('TSMOM-30d', sig_tsmom, '1h'), ('EWMAC 32/128', sig_ewmac, '1h'),
    ('Donchian 120/60', sig_donchian, '1h'), ('RSI(2)+EMA200', sig_rsi2, '1h'),
    ('Z-Score Fade', sig_zfade, '1h'), ('Bollinger Revert', sig_bbrevert, '1h'),
    ('Vol Squeeze', sig_squeeze, '1h'), ('ORB London/NY', sig_orb, '1h'),
    ('Sunrise Ogle', sig_ogle, '1h'), ('FVG Retrace', sig_fvg, '1h'),
    ('S/R Flip H4', sig_flip_h4, '4h'),
]

c1 = load_tf('1h')
last_t = c1[-1].t
w0 = last_t - 730 * 86400e3

# عائد الذهب الشهري (من إغلاق آخر شمعة الشهر لإغلاق آخر شمعة الشهر التالي)
closes_by_month = {}
for c in c1:
    if c.t >= w0:
        m = dt.datetime.fromtimestamp(c.t / 1000, dt.UTC).strftime('%Y-%m')
        closes_by_month.setdefault(m, []).append(c.c)
gold_ret = {m: v[-1] / v[0] - 1 for m, v in closes_by_month.items()}

def corr(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    vx = sum((a - mx) ** 2 for a in xs) ** 0.5
    vy = sum((b - my) ** 2 for b in ys) ** 0.5
    return cov / (vx * vy) if vx > 1e-12 and vy > 1e-12 else 0.0

print(f"{'الاستراتيجية':<20}{'ارتباط-مع-عائدالشهر':>20}"
      f"{'ربح$-أشهراتجاهقوي':>18}{'ربح$-أشهرهداءة':>16}")
print('-' * 78)
for name, maker, tf in ALL:
    cs = load_tf(tf)
    ss.A1 = atr_series(cs, 14)
    sig, ex = maker(cs)
    tr, _ = run(cs, 30 if tf == '4h' else 800, sig, ex, w0t=w0)
    mp = {}
    for t in tr:
        m = dt.datetime.fromtimestamp(t['entry_t'] / 1000, dt.UTC).strftime('%Y-%m')
        mp[m] = mp.get(m, 0.0) + t['pnl']
    ms = sorted(set(mp) & set(gold_ret))
    r = corr([gold_ret[m] for m in ms], [mp.get(m, 0.0) for m in ms])
    # ترتيب الأشهر حسب |عائد الذهب| وأخذ الثلث الأعلى (اتجاه قوي) والثلث الأدنى (هدوء)
    ranked = sorted(ms, key=lambda m: abs(gold_ret[m]))
    k = len(ranked) // 3
    quiet = [mp.get(m, 0.0) for m in ranked[:k]]
    trend = [mp.get(m, 0.0) for m in ranked[-k:]]
    print(f"{name:<20}{r:>20.2f}{sum(trend):>18.1f}{sum(quiet):>16.1f}")
