// ============================================================
// المقارنة النهائية العادلة قبل/بعد — نفس اللقطة، نفس العملية
//   قبل: I معطلة + U معطلة + عتبات D/Q الأصلية (حالة ما قبل نشر بقية الإصلاحات)
//   بعد: الحزمة المنشورة (I مفعلة + U معطلة + D/Q مخففة للتجربة الظلية)
// التشغيل: bun scripts/pdf_final_compare.ts
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const deployed = await loadBotSettings();
const realNews = await loadRealNews();

// قبل: استعادة حالة ما قبل النشر (تعطيل I + عتبات D/Q الأصلية)
const before = structuredClone(deployed) as Settings;
(before.strategyParams as Record<string, { enabled?: boolean } | undefined>).I!.enabled = false;
const bd = before.strategyParams as Record<string, Record<string, number>>;
const bq = before.strategyParams as Record<string, Record<string, number>>;
bd.D.gapMinPips = 12; bd.D.bodyBreakMin = 50; bd.D.totalMin = 100;
bq.Q.wickMinPips = 80; bq.Q.asiaOpenMinPips = 200; bq.Q.isolationPips = 120;

const run = (s: Settings, label: string) => {
  const t0 = Date.now();
  const r = runBacktestCached(null, s, realNews);
  if (!r.ok) throw new Error(r.reason);
  const st = r.stats;
  const agg = new Map<string, { n: number; net: number; wins: number; gw: number; gl: number }>();
  for (const t of r.trades as { strategy: string; pnl: number }[]) {
    const a = agg.get(t.strategy) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
    a.n++; a.net += t.pnl;
    if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
    agg.set(t.strategy, a);
  }
  console.log(`\n=== ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
  console.log(`صفقات=${st.totalTrades} | صافي=${st.netPnl.toFixed(2)}$ | PF=${st.profitFactor.toFixed(3)} | نجاح=${st.winRate.toFixed(1)}% | DD=${st.maxDrawdownPct.toFixed(1)}% | رصيد نهائي=${st.finalBalance.toFixed(2)}$`);
  console.log(`OOS: ${st.oos.trades} صفقة — نجاح ${st.oos.winRate.toFixed(1)}% — بوابة ${st.oos.gatePass ? 'ناجحة' : 'فاشلة'}`);
  const rows = [...agg.entries()].map(([c, a]) => ({ c, n: a.n, net: a.net, pf: a.gl > 0 ? a.gw / a.gl : (a.gw > 0 ? 99 : 0) })).sort((x, y) => y.net - x.net);
  for (const r2 of rows) console.log(`  ${r2.c.padStart(3)} | ${String(r2.n).padStart(5)} | ${r2.net.toFixed(2).padStart(9)}$ | PF ${r2.pf.toFixed(2)}`);
  return { stats: st, rows };
};

const b = run(before, 'قبل — الحالة السابقة للنشر');
const a = run(deployed, 'بعد — الحزمة المنشورة (I + تجربة D/Q الظلية)');

console.log('\n=== أثر الحزمة (نفس البيانات، نفس اللقطة) ===');
console.log(`الصافي: ${b.stats.netPnl.toFixed(2)}$ → ${a.stats.netPnl.toFixed(2)}$  (${(a.stats.netPnl - b.stats.netPnl >= 0 ? '+' : '')}${(a.stats.netPnl - b.stats.netPnl).toFixed(2)}$)`);
console.log(`PF: ${b.stats.profitFactor.toFixed(3)} → ${a.stats.profitFactor.toFixed(3)}`);
console.log(`DD: ${b.stats.maxDrawdownPct.toFixed(1)}% → ${a.stats.maxDrawdownPct.toFixed(1)}%`);
console.log(`النجاح: ${b.stats.winRate.toFixed(1)}% → ${a.stats.winRate.toFixed(1)}%`);
console.log(`الصفقات: ${b.stats.totalTrades} → ${a.stats.totalTrades}`);
