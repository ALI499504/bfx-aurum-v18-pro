// ============================================================
// تقييم X/Y/AA (الاستراتيجيات البحثية المتقدمة الموجودة في الكود)
// بنفس منهجية الضابط: تدريب ثم تحقق خارجي — ما نجح فقط يُفعّل
// bun scripts/xyz-eval.ts
// ============================================================
import { withBacktestEngine, type BacktestWindow } from '../src/lib/server/backtestCache';
import { runBacktest } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, buildScenarioSessions, Settings } from '../src/lib/engine/rules';
import { mt5Feed } from '../src/lib/server/mt5feed';

const TRAIN_W: BacktestWindow = {
  fromT: Date.UTC(2025, 5, 1) - 180 * 86400e3,
  toT: Date.UTC(2026, 4, 31, 23, 59, 59),
  reportFrom: Date.UTC(2025, 5, 1),
  reportTo: Date.UTC(2026, 4, 31, 23, 59, 59),
  permanent: true,
};
const OOS_W: BacktestWindow = {
  fromT: Date.UTC(2026, 5, 1) - 180 * 86400e3,
  toT: Date.now(),
  reportFrom: Date.UTC(2026, 5, 1),
  reportTo: Date.now(),
  permanent: true,
};

function metricsOf(trades: { strategy: string; pnl: number }[], st?: string) {
  const t = st ? trades.filter(x => x.strategy === st) : trades;
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return { trades: t.length, winRate: (wins / t.length) * 100, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), net };
}
const fmt = (n: number) => Math.round(n * 100) / 100;

function settingsFor(id: string, on: boolean): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  const sp = s.strategyParams as unknown as Record<string, Record<string, unknown>>;
  for (const k of ['A', 'E', 'F', 'H', 'K', 'L', 'M', 'N', 'B', 'C', 'D', 'G', 'I', 'J', 'O', 'P', 'Q', 'R', 'T', 'U', 'V', 'W', 'X', 'Y', 'AA', 'Z']) sp[k].enabled = false;
  sp[id].enabled = on;
  return s;
}

function run(w: BacktestWindow, s: Settings) {
  const r = withBacktestEngine(w, data => runBacktest(data, s, Date.now(), [], { fromT: w.reportFrom, toT: w.reportTo }));
  if (!r.ok) throw new Error(r.reason);
  return (r.result.trades as { strategy: string; pnl: number }[]);
}

async function main() {
  mt5Feed();
  const ids = ['X', 'Y', 'AA'];
  for (const id of ids) {
    console.log(`\n=== ${id} — التدريب ===`);
    const tr = metricsOf(run(TRAIN_W, settingsFor(id, true)), id);
    console.log(tr ? `${tr.trades} صفقة | نجاح ${Math.round(tr.winRate)}% | PF ${fmt(tr.pf)} | صافي ${fmt(tr.net)}$` : 'لا صفقات');
    console.log(`=== ${id} — التحقق الخارجي ===`);
    const oos = metricsOf(run(OOS_W, settingsFor(id, true)), id);
    console.log(oos ? `${oos.trades} صفقة | نجاح ${Math.round(oos.winRate)}% | PF ${fmt(oos.pf)} | صافي ${fmt(oos.net)}$` : 'لا صفقات');
    const pass = tr && oos && oos.trades >= 12 && oos.pf > 1 && oos.net > 0 && tr.trades >= 12 && tr.net > 0;
    console.log(pass ? `✓ ${id} مؤهلة للتفعيل` : `✗ ${id} غير مؤهلة — تبقى معطلة`);
  }
}
main();
