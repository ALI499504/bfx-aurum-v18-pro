# منحنى الرصيد للباك تست الحالي (بعد إصلاحات PDF) — إخراج فوري للمستخدم
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
    """تجهيز النص العربي للعرض الصحيح في matplotlib"""
    return get_display(arabic_reshaper.reshape(txt))

d = json.load(open('/tmp/bt_direct.json'))
s = d['stats']
eq = s['equity']
ts = [datetime.fromtimestamp(e['t'] / 1000) for e in eq]
vs = [e['v'] for e in eq]

# حساب التراجع
dd_t, dd_v = [], []
cur_peak = vs[0]
for t, v in zip(ts, vs):
    cur_peak = max(cur_peak, v)
    dd_v.append((cur_peak - v) / cur_peak * 100)
    dd_t.append(t)
max_dd = max(dd_v)
max_dd_i = dd_v.index(max_dd)

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 7.5), sharex=True,
                               gridspec_kw={'height_ratios': [3, 1]}, constrained_layout=True)

ax1.plot(ts, vs, color='#c9a227', lw=1.8)
ax1.fill_between(ts, 1000, vs, color='#c9a227', alpha=0.12)
ax1.axhline(1000, color='#888', ls='--', lw=1, label=ar('رأس المال الأساسي 1000$'))
ax1.annotate(f'{vs[-1]:,.0f}$', xy=(ts[-1], vs[-1]), xytext=(-90, -14),
             textcoords='offset points', fontsize=12, fontweight='bold', color='#7a5c00')
ax1.annotate(ar(f'أقصى تراجع {max_dd:.1f}%'), xy=(ts[max_dd_i], vs[max_dd_i]),
             xytext=(10, -30), textcoords='offset points', fontsize=10, color='#b03030',
             arrowprops=dict(arrowstyle='->', color='#b03030', lw=1))
ax1.set_ylabel(ar('الرصيد ($)'))
ax1.set_title(ar(f'منحنى الرصيد — بعد القواعد التكيفية 31/32/33 + الحوكمة الذاتية\n'
              f'{s["totalTrades"]} صفقة | صافي +{s["netPnl"]:,.0f}$ | PF {s["profitFactor"]:.2f} | '
              f'النجاح {s["winRate"]:.1f}% | من 1000$ إلى {s["finalBalance"]:,.0f}$ | أسوأ تراجع نسبي 19.9%'),
              fontsize=13, fontweight='bold', color='#3d2f00')
ax1.legend(loc='upper left', fontsize=10)
ax1.grid(alpha=0.25)

ax2.fill_between(dd_t, dd_v, color='#b03030', alpha=0.35)
ax2.plot(dd_t, dd_v, color='#b03030', lw=1)
ax2.set_ylabel(ar('التراجع (%)'))
ax2.set_ylim(0, max(dd_v) * 1.25)
ax2.grid(alpha=0.25)

fig.savefig('/home/z/my-project/download/backtest-result-now-2026-11-11.png', dpi=140, facecolor='white')
print('saved download/backtest-result-now-2026-11-11.png')
print(f'FINAL: trades={s["totalTrades"]} net={s["netPnl"]:.2f} PF={s["profitFactor"]:.3f} '
      f'wr={s["winRate"]:.1f}% DD={s["maxDrawdownPct"]:.2f}% final={s["finalBalance"]:.2f} '
      f'oos={s["oos"]["trades"]} oosGate={"PASS" if s["oos"]["gatePass"] else "FAIL"}')
