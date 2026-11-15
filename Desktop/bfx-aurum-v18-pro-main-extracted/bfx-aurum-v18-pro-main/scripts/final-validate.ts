// ============================================================
// التحقق النهائي — التهيئة المقفلة v2.1 على كل الفترة + تقسيم IS/OOS
// التشغيل: bun scripts/final-validate.ts
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';
import { loadData, resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import type { EngineData } from '../src/lib/engine/backtest';
import { DISCIPLINE } from '../src/lib/engine/discipline';
import { SMC_CFG } from '../src/lib/engine/smc';
import type { Settings } from '../src/lib/engine/rules';

const settings: Settings = { lot: 0.01, spreadCents: 30 };

const s = mt5Feed();
const raw: Record<string, unknown> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) raw[tf] = s.tfs[tf];
resetEngineCache();
const data = loadData(raw);
const c5 = data.c5;

function report(name: string, fromT?: number, toT?: number): void {
  resetEngineCache();
  const r = runBacktest(data, settings, Date.now(), fromT || toT ? { fromT, toT } : undefined);
  const st = r.stats;
  const d = st.discipline;
  const dist: Record<string, number> = {};
  for (const t of r.trades) dist[t.result] = (dist[t.result] ?? 0) + 1;
  const slBand = r.trades.filter(t => {
    const risk = Math.abs(t.entry - (t.slOrig ?? t.sl));
    return risk >= DISCIPLINE.MIN_SL_USD - 1e-6 && risk <= DISCIPLINE.MAX_SL_USD + 1e-6;
  }).length;
  const tpBand = r.trades.filter(t => {
    const d2 = Math.abs(t.tp - t.entry);
    return d2 >= DISCIPLINE.TP_MIN_USD - 1e-6 && d2 <= DISCIPLINE.TP_MAX_USD + 1e-6;
  }).length;
  console.log(`\n== ${name} ==`);
  console.log(`صفقات ${st.totalTrades} — نجاح ${st.winRate.toFixed(1)}% — صافي ${st.netPnl.toFixed(2)}$ — PF ${st.profitFactor.toFixed(2)} — أقصى تراجع ${st.maxDrawdownPct.toFixed(1)}%`);
  console.log(`أيام ${d.summary.days} — ≥10 صفقات: ${d.summary.minTradesDays} — هدف محقق: ${d.summary.targetHitDays} — قاطع 10%: ${d.summary.cappedDays} — مؤمَّنة: ${d.summary.insuredTrades}`);
  console.log(`التزام النطاقات: وقف داخل 10–15$ في ${slBand}/${st.totalTrades} — هدف داخل 10–15$ في ${tpBand}/${st.totalTrades}`);
  console.log(`الخروج: ${JSON.stringify(dist)} — الرفض: ${JSON.stringify(st.blocked)}`);
}

console.log(`=== تهيئة v2.1 النهائية: مناطق M15 + تأكيد M5/M15 + لمسة-سحب ${SMC_CFG.TOUCH_PIERCE}×ATR ===`);
console.log(`نوافذ لندن ${SMC_CFG.KZ_LDN[0]}:00-${SMC_CFG.KZ_LDN[1]}:00 ونيويورك ${SMC_CFG.KZ_NY[0]}:00-${SMC_CFG.KZ_NY[1]}:00 دمشق — TS ${DISCIPLINE.TIME_STOP_BARS}×M5 — تأمين ${DISCIPLINE.INSURE_MODE} ${DISCIPLINE.INSURE_USD}$`);

report('كل الفترة (2025-06 → 2026-11)');

const t0 = c5[0].t, tN = c5[c5.length - 1].t;
const third = (tN - t0) / 3;
report('IS1 (الثلث الأول)', t0, t0 + third);
report('IS2 (الثلث الأوسط)', t0 + third, t0 + 2 * third);
report('OOS (الثلث الأخير)', t0 + 2 * third, tN);
