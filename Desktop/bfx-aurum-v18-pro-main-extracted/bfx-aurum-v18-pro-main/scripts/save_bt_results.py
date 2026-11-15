#!/usr/bin/env python3
# حفظ نتائج باك تيست التحقق (بتاريخ اليوم) في download/ كـCSV رسمي
import json, csv, datetime

src = json.load(open('/tmp/bt_direct.json'))
st = src['stats']
rows = src['byStrategy']

out = '/home/z/my-project/download/backtest-verification-2026-11-11.csv'
with open(out, 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(['# باك تيست التحقق الكامل — محرك TAMSA الرسمي بالإعدادات المنشورة (بعد الإصلاحات)'])
    w.writerow(['# تاريخ التشغيل:', datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), '| مدة التشغيل:', src['runMs'], 'ms'])
    w.writerow(['# الإجمالي:', f"صفقات={st['totalTrades']}", f"صافي={round(st['netPnl'],2)}$",
                f"PF={round(st['profitFactor'],3)}", f"نجاح%={round(st['winRate'],1)}",
                f"أقصىDD%={round(st['maxDrawdownPct'],1)}"])
    w.writerow([])
    w.writerow(['الرمز', 'الصفقات', 'الصافي$', 'النجاح%', 'PF'])
    for r in rows:
        w.writerow([r['strategy'], r['trades'], r['net'], r['wr'], r['pf']])

print('saved:', out)
print('TOTAL:', st['totalTrades'], 'trades | net', round(st['netPnl'],2), '$ | PF', round(st['profitFactor'],3),
      '| wr', round(st['winRate'],1), '% | maxDD', round(st['maxDrawdownPct'],1), '%')
