// التحقق الحرفي من زرع السلة: وحدة basket.ts مقابل أرقام الاعتماد (basket-1000-results.csv)
// المعيار: مطابقة سلة A على النافذتين (365يوم / 730يوم) ضمن هامش التقريب
import { buildBasketReport } from '../src/lib/engine/basket';

const APPROVED: Record<string, { n: number; net: number; pf: number; ddp: number }> = {
  'TSMOM-30d (خام — المعتمد)|365يوم': { n: 26, net: 2259.03, pf: 8.75, ddp: 9.5 },
  'Sunrise Ogle (دائماً)|365يوم': { n: 59, net: 908.00, pf: 2.15, ddp: 23.7 },
  'سلة A: TSMOM + Ogle (المعتمدة)|365يوم': { n: 85, net: 3167.03, pf: 3.92, ddp: 18.4 },
  'TSMOM-30d (خام — المعتمد)|730يوم': { n: 88, net: 2560.55, pf: 3.85, ddp: 47.6 },
  'Sunrise Ogle (دائماً)|730يوم': { n: 123, net: 1051.44, pf: 1.84, ddp: 23.7 },
  'سلة A: TSMOM + Ogle (المعتمدة)|730يوم': { n: 211, net: 3611.99, pf: 2.67, ddp: 45.2 },
};

const rep = await buildBasketReport();
console.log('ok:', rep.ok, '| شموع:', rep.candles, '| من:', rep.dataFrom ? new Date(rep.dataFrom).toISOString().slice(0, 10) : '-', '| إلى:', rep.dataTo ? new Date(rep.dataTo).toISOString().slice(0, 10) : '-');
console.log();
console.log('=== التحقق من الزرع (وحدة basket.ts على نفس اللقطة) ===');
console.log('الاسم | النافذة | صفقات | PF | صافي$ | DD% | (المعتمد) | الحكم');
let allOk = true;
for (const r of rep.validation) {
  const key = `${r.name}|${r.window}`;
  const a = APPROVED[key];
  if (!a) continue;
  const okN = Math.abs(r.m.n - a.n) <= 1;
  const okNet = Math.abs(r.m.net - a.net) <= Math.max(2, a.net * 0.01);
  const okPf = Math.abs(r.m.pf - a.pf) <= Math.max(0.1, a.pf * 0.05);
  const ok = okN && okNet && okPf;
  if (!ok) allOk = false;
  console.log(
    `${r.name} | ${r.window} | ${r.m.n} (=${a.n}) | ${r.m.pf} (=${a.pf}) | ${r.m.net} (=${a.net}) | ${r.m.ddp}% (=${a.ddp}%) | ${ok ? '✅ مطابق' : '❌ غير مطابق'}`,
  );
}
console.log();
if (rep.live) {
  console.log('=== المحفظة التشغيلية بالصمامات (السلة الحية على 1000$) ===');
  console.log('الإيكويتي الآن:', rep.live.equityNow, '| صافي:', rep.live.netNow, '| عائم:', rep.live.floatingNow, '| القمة:', rep.live.peakEquity);
  console.log('الصمامات:', JSON.stringify(rep.live.fuseTrips), '| الحالة:', JSON.stringify(rep.live.fuseState));
  console.log('مقاييس كاملة:', JSON.stringify(rep.live.metricsAll));
  console.log('مقاييس 365 يوماً:', JSON.stringify(rep.live.metrics365));
  console.log('مواقع مفتوحة:', JSON.stringify(rep.live.open.map(o => `${o.comp} ${o.dir} @${o.entry}`)));
  console.log('آخر 3 صفقات:', JSON.stringify(rep.live.lastTrades.slice(0, 3).map(t => `${t.comp} ${t.dir} ${t.pnl.toFixed(2)}$ ${t.why}`)));
  const months = rep.live.monthly.slice(-12);
  const avgMonth = months.length ? months.reduce((a, m) => a + m.net, 0) / months.length : 0;
  console.log('متوسط آخر 12 شهراً:', avgMonth.toFixed(1), '$/شهر');
}
console.log();
console.log(allOk ? '★★★ النتيجة: الوحدة مطابقة حرفياً للمحاكاة المعتمدة ★★★' : '⚠️ توجد فروقات — يلزم مراجعة النقل');
