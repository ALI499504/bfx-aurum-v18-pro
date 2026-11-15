#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تشخيص عميق للاستراتيجيات المرفوضة في المقارنة (strategy-shootout).

لكل استراتيجية مرفوضة نستخرج "شكل المشكلة":
  - نسبة العائد/الخسارة (payoff) والتوقع الرياضي
  - تكلفة السبريد كنسبة من الحركة الخام
  - أعلى سلسلة خسائر متتالية
  - اتساق شهري (كم شهر خرج رابحاً)
  - تركّز الخسائر (حصة أسوأ 5 صفقات من إجمالي الخسارة)
"""
import sys, math, datetime as dt
sys.path.insert(0, '/home/z/my-project/scripts')
import strategy_shootout as ss
from strategy_shootout import (load_tf, atr_series, sig_tsmom, sig_ewmac,
                               sig_donchian, sig_rsi2, sig_zfade, sig_bbrevert,
                               sig_squeeze, sig_orb, sig_ogle, sig_fvg,
                               sig_flip_h4, run, SPREAD)

REJECTED = [
    ('RSI(2)+EMA200',   sig_rsi2,     '1h'),
    ('Z-Score Fade',    sig_zfade,    '1h'),
    ('Bollinger Revert',sig_bbrevert, '1h'),
    ('Vol Squeeze',     sig_squeeze,  '1h'),
    ('ORB London/NY',   sig_orb,      '1h'),
    ('Sunrise Ogle',    sig_ogle,     '1h'),
    ('FVG Retrace',     sig_fvg,      '1h'),
    ('S/R Flip H4',     sig_flip_h4,  '4h'),
]
WINNERS = [
    ('TSMOM-30d',       sig_tsmom,    '1h'),
    ('EWMAC 32/128',    sig_ewmac,    '1h'),
    ('Donchian 120/60', sig_donchian, '1h'),
]


def diag(name, maker, tf, days=730):
    cs = load_tf(tf)
    A = atr_series(cs, 14)
    ss.A1 = A          # دوال الإشارات تقرأ A1 من namespace الوحدة
    sig, ex = maker(cs)
    w0 = cs[-1].t - days * 86400e3
    warm = 30 if tf == '4h' else 800
    tr, eq = run(cs, warm, sig, ex, w0t=w0)
    if not tr:
        return None
    wins = [t for t in tr if t['pnl'] > 0]
    losses = [t for t in tr if t['pnl'] <= 0]
    gw = sum(t['pnl'] for t in wins)
    gl = abs(sum(t['pnl'] for t in losses))
    aw = gw / len(wins) if wins else 0.0
    al = gl / len(losses) if losses else 0.0
    payoff = aw / al if al > 1e-9 else float('inf')
    net = gw - gl
    gross_raw = net + SPREAD * len(tr)          # الربح قبل خصم السبريد
    spread_share = SPREAD * len(tr) / abs(gross_raw) if abs(gross_raw) > 1e-9 else 0
    # أطول سلسلة خسائر
    streak = worst = 0
    for t in tr:
        streak = streak + 1 if t['pnl'] <= 0 else 0
        worst = max(worst, streak)
    # اتساق شهري
    months = {}
    for t in tr:
        m = dt.datetime.fromtimestamp(t['entry_t'] / 1000, dt.UTC).strftime('%Y-%m')
        months[m] = months.get(m, 0.0) + t['pnl']
    pos_m = sum(1 for v in months.values() if v > 0)
    # تركّز الخسائر: أسوأ 5 صفقات
    worst5 = sorted(t['pnl'] for t in tr)[:5]
    w5_share = -sum(worst5) / gl if gl > 1e-9 else 0
    return dict(n=len(tr), wr=100 * len(wins) / len(tr), aw=aw, al=al,
                payoff=payoff, exp=net / len(tr), net=net,
                spread_paid=SPREAD * len(tr), spread_share=100 * spread_share,
                streak=worst, pos_m=pos_m, tot_m=len(months), w5=100 * w5_share)


print(f"{'الاستراتيجية':<20}{'صفقات':>6}{'نجاح%':>7}{'ربحم.اوس$':>10}{'خسأوس$':>9}"
      f"{'payoff':>7}{'توقع$/صفقة':>11}{'سبريد$':>8}{'سبريد%منالحركة':>14}"
      f"{'أطولسلسلةخس':>11}{'شهوررابحة':>10}{'أسوأ5%منخس':>12}")
print('-' * 150)
rows = []
for name, maker, tf in WINNERS + REJECTED:
    d = diag(name, maker, tf)
    if d:
        rows.append((name, d))
        print(f"{name:<20}{d['n']:>6}{d['wr']:>7.1f}{d['aw']:>10.2f}{d['al']:>9.2f}"
              f"{d['payoff']:>7.2f}{d['exp']:>11.2f}{d['spread_paid']:>8.1f}"
              f"{d['spread_share']:>14.0f}{d['streak']:>11}{d['pos_m']:>6}/{d['tot_m']:<3}"
              f"{d['w5']:>12.0f}")
print()
print('المجموع على 730 يوم، لوت 0.01، سبريد 0.30$/صفقة، SL أولاً داخل الشمعة.')
