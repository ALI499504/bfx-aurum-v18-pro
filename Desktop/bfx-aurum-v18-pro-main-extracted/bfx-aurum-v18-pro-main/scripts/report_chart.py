# -*- coding: utf-8 -*-
# منحنى الإيكويتي + الأداء الشهري — لوت ثابت 0.01 صارم وسقف احتفاظ 72 ساعة
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
import arabic_reshaper
from bidi.algorithm import get_display
from datetime import datetime, timezone, timedelta

def ar(s):
    return get_display(arabic_reshaper.reshape(s))

with open('/tmp/report_final.json', encoding='utf-8') as f:
    R = json.load(f)

GOLD = '#d9b45c'
GREEN = '#2ebd85'
RED = '#f6465d'
INK = '#1c1c1e'
GRID = '#e6e2d8'

plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11.5, 7.4), constrained_layout=True,
                               gridspec_kw={'height_ratios': [1.55, 1]})
fig.patch.set_facecolor('white')

# ---- اللوحة 1: منحنى الإيكويتي ----
SYRIA_MS = 3 * 3600e3
ts = [datetime.fromtimestamp(p['t'] / 1000 - SYRIA_MS / 1000, tz=timezone.utc) for p in R['eqSparse']]
vals = [p['v'] for p in R['eqSparse']]
ax1.plot(ts, vals, color=GOLD, lw=1.5, zorder=3)
ax1.fill_between(ts, 1000, vals, color=GOLD, alpha=0.14, zorder=2)
ax1.axhline(1000, color='#9a9a9a', lw=0.8, ls='--', zorder=1)
peak = max(vals)
ax1.annotate(ar(f"القمة {peak:,.0f}$"), xy=(ts[vals.index(peak)], peak), xytext=(-10, 8),
             textcoords='offset points', ha='right', fontsize=10, color=INK)
final = vals[-1]
ax1.annotate(ar(f"النهائي {final:,.0f}$"), xy=(ts[-1], final), xytext=(-8, -16),
             textcoords='offset points', ha='right', fontsize=10, color=INK, fontweight='bold')
ax1.set_title(ar('منحنى الإيكويتي — لوت ثابت 0.01 صارم، سقف احتفاظ 72 ساعة (أساس 1,000$)'),
              fontsize=13, color=INK, pad=10)
ax1.set_ylabel(ar('الرصيد ($)'), fontsize=11, color=INK)
ax1.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
ax1.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
ax1.tick_params(labelsize=9, colors=INK)
ax1.grid(True, color=GRID, lw=0.7, alpha=0.8)
for s in ['top', 'right']:
    ax1.spines[s].set_visible(False)
st = R['stats']
ax1.text(0.995, 0.04,
         ar(f"الصفقات {st['totalTrades']:,} | الربح +{st['netPnl']:,.0f}$ | معامل الربحية {st['profitFactor']:.2f} | أقصى تراجع {st['maxDrawdownPct']:.1f}% | كل الصفقات لوت 0.01"),
         transform=ax1.transAxes, ha='right', va='bottom', fontsize=9.5, color='#555555',
         bbox=dict(boxstyle='round,pad=0.4', fc='#fbf7ec', ec=GOLD, lw=0.8))

# ---- اللوحة 2: الأداء الشهري ----
months = [m['month'] for m in R['monthly']]
nets = [m['net'] for m in R['monthly']]
colors = [GREEN if n >= 0 else RED for n in nets]
x = range(len(months))
ax2.bar(x, nets, color=colors, width=0.62, zorder=3)
ax2.axhline(0, color='#9a9a9a', lw=0.8)
ax2.set_xticks(list(x))
ax2.set_xticklabels(months, rotation=45, ha='right', fontsize=8.5)
ax2.set_title(ar('صافي الربح الشهري ($)'), fontsize=12.5, color=INK, pad=8)
ax2.set_ylabel(ar('صافي ($)'), fontsize=11, color=INK)
ax2.tick_params(labelsize=9, colors=INK)
ax2.grid(True, axis='y', color=GRID, lw=0.7, alpha=0.8)
for s in ['top', 'right']:
    ax2.spines[s].set_visible(False)
for i, n in enumerate(nets):
    if abs(n) >= 400:
        ax2.annotate(f"{n:+,.0f}", xy=(i, n), xytext=(0, 4 if n >= 0 else -13),
                     textcoords='offset points', ha='center', fontsize=8.5,
                     color=GREEN if n >= 0 else RED)

fig.savefig('/home/z/my-project/download/timestop_fixed_lot_performance.png', dpi=160, facecolor='white')
print('chart saved')
print('months:', len(months), 'final equity:', final, 'peak:', peak)
