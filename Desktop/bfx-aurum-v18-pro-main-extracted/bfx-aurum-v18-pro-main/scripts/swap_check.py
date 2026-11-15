#!/usr/bin/env python3
# تقدير مصاريف التمويل (Swap) لاستراتيجيات الاتجاه طويلة الاحتفاظ — TSMOM كمثال
import importlib.util

spec = importlib.util.spec_from_file_location('ss', '/home/z/my-project/scripts/strategy_shootout.py')
ss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ss)

c1 = ss.load_tf('1h')
ss.A1 = ss.atr_series(c1, 14)
w0 = c1[-1].t - 365 * 86400e3

# سعر سواب الذهب التقريبي لدى JustMarkets: ~ -8.9$ للوت القياسي لكل ليلة (شراء)
# وبناءً عليه لكل 0.01 لوت: -0.089$/ليلة، والأربعاء ×3
SWAP_NIGHT = 0.089

sig, ex = ss.sig_tsmom(c1)
tr, eq = ss.run(c1, 800, sig, ex, w0t=w0)
total_held_h = sum(t['held'] for t in tr)
nights = total_held_h / 24.0
wednesdays = nights / 7.0  # تقريب: ليلة أربعاء واحدة أسبوعياً ×3
swap_cost = nights * SWAP_NIGHT + wednesdays * 2 * SWAP_NIGHT

print(f"TSMOM 365يوم: {len(tr)} صفقة | متوسط الاحتفاظ: {total_held_h/len(tr)/24:.1f} يوم")
print(f"إجمالي الليالي: {nights:.0f} → تقدير السواب ≈ -{swap_cost:.1f}$ على 0.01 لوت")
print(f"صافي بلا سواب: {sum(t['pnl'] for t in tr):.1f}$ | مع تقدير السواب: {sum(t['pnl'] for t in tr) - swap_cost:.1f}$")

sig2, ex2 = ss.sig_ogle(c1)
tr2, _ = ss.run(c1, 800, sig2, ex2, w0t=w0)
h2 = sum(t['held'] for t in tr2) / 24.0
sw2 = h2 * SWAP_NIGHT
print(f"\nSunrise Ogle 365يوم: {len(tr2)} صفقة | متوسط الاحتفاظ: {sum(t['held'] for t in tr2)/len(tr2)/24:.1f} يوم")
print(f"تقدير السواب ≈ -{sw2:.1f}$ | صافي مع السواب: {sum(t['pnl'] for t in tr2) - sw2:.1f}$")
