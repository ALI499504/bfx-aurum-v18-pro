// ============================================================
// قياس أداء الباك تيست الحقيقي + تقرير أرقام المالك
// التشغيل: bun scripts/bench-backtest.ts
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';
import { runBacktestCached } from '../src/lib/server/backtestCache';
import type { Settings } from '../src/lib/engine/rules';
import { DISCIPLINE } from '../src/lib/engine/discipline';

const settings: Settings = { lot: 0.01, spreadCents: 30 };

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function main() {
  const s = mt5Feed();
  const c5 = (s.tfs['5m'] ?? []) as { t: number }[];
  console.log(`=== بيانات حقيقية: ${c5.length} شمعة 5m (${new Date(c5[0]?.t ?? 0).toISOString().slice(0, 10)} → ${new Date(c5[c5.length - 1]?.t ?? 0).toISOString().slice(0, 10)}) ===`);

  let t0 = Date.now();
  let r = runBacktestCached(null, settings);
  const coldFull = r.ok ? Date.now() - t0 : -1;
  console.log(`\n[1] التاريخ الكامل (بناء بارد): ${r.ok ? fmtMs(coldFull) : 'فشل: ' + r.reason}`);
  if (r.ok) {
    const st = r.stats;
    console.log(`    صفقات: ${st.totalTrades} — نجاح ${st.winRate.toFixed(1)}% — صافي ${st.netPnl.toFixed(2)}$ — PF ${st.profitFactor.toFixed(2)} — أقصى تراجع ${st.maxDrawdownPct.toFixed(1)}%`);
    console.log(`    الانضباط: أيام ${st.discipline.summary.days} — أيام ≥10 صفقات: ${st.discipline.summary.minTradesDays} — أيام هدف محقق: ${st.discipline.summary.targetHitDays} — أيام قاطع 10%: ${st.discipline.summary.cappedDays} — مؤمَّنة: ${st.discipline.summary.insuredTrades}`);
    const withTrades = st.daily.filter(d => d.trades > 0);
    const avgPerActiveDay = withTrades.length ? (st.daily.reduce((a, d) => a + d.trades, 0) / withTrades.length) : 0;
    console.log(`    متوسط الصفقات/يوم نشط: ${avgPerActiveDay.toFixed(1)} — أسباب الرفض: ${JSON.stringify(st.blocked)}`);
    const pos = st.daily.filter(d => d.trades >= DISCIPLINE.MIN_TRADES_PER_DAY).length;
    console.log(`    يوموفية: أيام بلا صفقات: ${st.daily.length - withTrades.length} — أعلى يوم صفقات: ${Math.max(...st.daily.map(d => d.trades))}`);
    void pos;
  }

  t0 = Date.now();
  r = runBacktestCached(null, settings);
  console.log(`[2] التاريخ الكامل (كاش ساخن): ${r.ok ? fmtMs(Date.now() - t0) : 'فشل'} — built=${r.ok ? r.built : '-'}`);

  t0 = Date.now();
  r = runBacktestCached(2026, settings);
  console.log(`[3] سنة 2026 (بناء بارد): ${r.ok ? fmtMs(Date.now() - t0) : 'فشل: ' + r.reason} — built=${r.ok ? r.built : '-'}`);
  if (r.ok) console.log(`    صفقات: ${r.stats.totalTrades} — نجاح ${r.stats.winRate.toFixed(1)}% — صافي ${r.stats.netPnl.toFixed(2)}$`);
}

main().catch(e => { console.error(e); process.exit(1); });
