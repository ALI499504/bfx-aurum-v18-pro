#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""منحنى الرصيد: قبل (بلا سقف) مقابل بعد (سقف 48 ساعة) — إخراج للمستخدم"""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from datetime import datetime
import arabic_reshaper
from bidi.algorithm import get_display

font_manager.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

def ar(txt: str) -> str:
    return get_display(arabic_reshaper.reshape(txt))

d = json.load(open('/tmp/bt_final_pair.json'))
before = d['variants']['before']
after = d['variants']['after48']
sb, sa = before['stats'], after['stats']

def curve(v):
    ts = [datetime.fromtimestamp(e['t'] / 1000) for e in v['equity']]
    vs = [e['v'] for e in v['equity']]
    return ts, vs

tb, vb = curve(before)
ta, va = curve(after)

def dd_series(vs):
    out, peak = [], vs[0]
    for v in vs:
        peak = max(peak, v)
        out.append((peak - v) / peak * 100)
    return out

ddb, dda = dd_series(vb), dd_series(va)

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 8), sharex=True,
                               gridspec_kw={'height_ratios': [3, 1]}, constrained_layout=True)

ax1.plot(tb, vb, color='#9aa3b2', lw=1.4, alpha=0.85,
         label=ar(f'قبل — بلا سقف: {sb["totalTrades"]} صفقة | +{sb["netPnl"]:,.0f}$ | PF {sb["profitFactor"]:.2f} | أطول صفقة 98 يوماً'))
ax1.plot(ta, va, color='#c9a227', lw=1.8,
         label=ar(f'بعد — سقف 48 ساعة: {sa["totalTrades"]} صفقة | +{sa["netPnl"]:,.0f}$ | PF {sa["profitFactor"]:.2f} | أطول صفقة يومان'))
ax1.axhline(1000, color='#888', ls='--', lw=1)
ax1.annotate(f'{va[-1]:,.0f}$', xy=(ta[-1], va[-1]), xytext=(-95, -16),
             textcoords='offset points', fontsize=12, fontweight='bold', color='#7a5c00')
ax1.annotate(f'{vb[-1]:,.0f}$', xy=(tb[-1], vb[-1]), xytext=(-95, 12),
             textcoords='offset points', fontsize=11, fontweight='bold', color='#5a6473')
ax1.set_ylabel(ar('الرصيد ($)'))
ax1.set_title(ar('سقف الاحتفاظ الزمني 48 ساعة (القاعدة 4) — قبل مقابل بعد\n'
                 'خروج وقائي على آخر شمعة ضمن السقف — لا صفقة تتجاوز يومين أبداً حتى عبر عطلة نهاية الأسبوع'),
              fontsize=13, fontweight='bold', color='#3d2f00')
ax1.legend(loc='upper left', fontsize=9.5)
ax1.grid(alpha=0.25)

ax2.fill_between(ta, dda, color='#c9a227', alpha=0.30)
ax2.plot(ta, dda, color='#c9a227', lw=1, label=ar(f'بعد: أقصى تراجع {sa["maxDrawdownPct"]:.1f}%'))
ax2.fill_between(tb, ddb, color='#9aa3b2', alpha=0.25)
ax2.plot(tb, ddb, color='#9aa3b2', lw=1, label=ar(f'قبل: أقصى تراجع {sb["maxDrawdownPct"]:.1f}%'))
ax2.set_ylabel(ar('التراجع (%)'))
ax2.set_ylim(0, max(max(dda), max(ddb)) * 1.2)
ax2.legend(loc='upper left', fontsize=9.5)
ax2.grid(alpha=0.25)

fig.savefig('/home/z/my-project/download/maxhold-before-after-2026-11-11.png', dpi=140, facecolor='white')
print('saved download/maxhold-before-after-2026-11-11.png')
