# -*- coding: utf-8 -*-
# رسم مقارنة الضابط قبل/بعد — التحقق الخارجي على شموع حقيقية
import json
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
import arabic_reshaper
from bidi.algorithm import get_display

plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

def ar(t):
    return get_display(arabic_reshaper.reshape(t))

rep = json.load(open('/home/z/my-project/download/tuner-report.json'))['report']
b, a = rep['systemBefore'], rep['systemAfterOos']

fig, axes = plt.subplots(2, 2, figsize=(11, 7), constrained_layout=True)
fig.suptitle(ar('الضابط الذاتي — قبل وبعد على التحقق الخارجي (شموع XAUUSD.m حقيقية: 2026-06-01 → 2026-11-15)'),
             fontsize=13, fontweight='bold')

panels = [
    ('الصافي بالدولار', [b['net'], a['net']], ['$#,##0', None], '+$922 (+74.7%)'),
    ('معامل الربح PF', [b['pf'], a['pf']], None, '1.43 ← 1.47'),
    ('نسبة النجاح %', [b['winRate'], a['winRate']], None, 'الصفقات: 622 ← 874'),
    ('أقصى تراجع %', [b['dd'], a['dd']], None, 'تحت رقابة الدستور اليومي'),
]
colors = ['#2E7D32', '#1565C0']

for ax, (title, vals, _f, note) in zip(axes.flat, panels):
    bars = ax.bar(['قبل', 'بعد'], vals, color=colors, width=0.55)
    ax.set_title(ar(title), fontsize=12)
    ax.grid(axis='y', alpha=0.3)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height(), f'{v:g}',
                ha='center', va='bottom', fontsize=11, fontweight='bold')
    ax.text(0.5, 0.94, ar(note), transform=ax.transAxes, ha='center', fontsize=9.5, color='#555')

axes.flat[3].set_ylim(0, max(b['dd'], a['dd']) * 1.25)
out = '/home/z/my-project/download/tuner-before-after.png'
plt.savefig(out, dpi=130)
print('حُفظ:', out)
