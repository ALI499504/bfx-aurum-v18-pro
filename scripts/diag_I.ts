// تشخيص سريع: أين تختفي إشارات I؟
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import { runAllDetectors, DetectorsInput, DetectorsCtx, SignalEvent, resetTamsaState } from '../src/lib/engine/strategies';
import { mt5Feed } from '../src/lib/server/mt5feed';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
console.log('I.enabled:', settings.strategyParams?.I?.enabled);

// شغّل الباك تيست الكامل وراقب
const r = runBacktestCached(null, settings, realNews);
if (!r.ok) { console.error('FAILED:', r.reason); process.exit(1); }

const trByStrat = new Map<string, number>();
for (const t of r.trades) {
  trByStrat.set(t.strategy, (trByStrat.get(t.strategy) ?? 0) + 1);
}
console.log('--- عدد الصفقات المنفذة لكل استراتيجية ---');
for (const [k, v] of [...trByStrat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(4)}: ${v}`);
}

// ابحث في سجل القرارات عن I
const Ilog = r.decisionLog?.filter((d: { strategy?: string }) => d.strategy === 'I') ?? [];
console.log(`\n--- سجل قرارات I: ${Ilog.length} إجمالي ---`);
const IbyReason = new Map<string, number>();
for (const d of Ilog) {
  const reason = (d as { reason?: string }).reason ?? 'unknown';
  IbyReason.set(reason, (IbyReason.get(reason) ?? 0) + 1);
}
for (const [reason, n] of [...IbyReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${n}× ${reason.slice(0, 100)}`);
}
