// ============================================================
// شبكة ضبط Z — منهجية الضابط: الأفضل على التدريب ثم حكم خارج العينة
// bun scripts/z-grid.ts
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

interface M { trades: number; winRate: number; pf: number; net: number }
function metricsOf(trades: { strategy: string; pnl: number }[], st?: string): M | null {
  const t = st ? trades.filter(x => x.strategy === st) : trades;
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return { trades: t.length, winRate: (wins / t.length) * 100, pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), net };
}
const fmt = (n: number) => Math.round(n * 100) / 100;

function buildSettings(zP: { minSweepPips: number; rr: number; slBufPips: number }): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  const sp = s.strategyParams as unknown as Record<string, Record<string, unknown>>;
  sp['A'].slPips = 100; sp['A'].tpPips = 120;
  sp['E'].slPips = 50; sp['E'].tpPips = 200;
  (sp['F'].exec as Record<string, unknown>).slPips = 60; (sp['F'].exec as Record<string, unknown>).tpPips = 120;
  sp['H'].slPips = 90; sp['H'].tpPips = 200;
  (sp['L'].exec as Record<string, unknown>).revSlPips = 30; (sp['L'].exec as Record<string, unknown>).revTpPips = 120;
  (sp['M'].exec as Record<string, unknown>).revSlPips = 50; (sp['M'].exec as Record<string, unknown>).revTpPips = 200;
  (sp['N'].exec as Record<string, unknown>).revSlPips = 80; (sp['N'].exec as Record<string, unknown>).revTpPips = 200;
  for (const k of ['B', 'C', 'D', 'G', 'I', 'J', 'O', 'P', 'Q', 'R', 'T', 'U', 'V', 'W', 'X', 'Y', 'AA']) sp[k].enabled = false;
  sp['Z'].enabled = true;
  sp['Z'].minSweepPips = zP.minSweepPips;
  sp['Z'].rr = zP.rr;
  sp['Z'].slBufPips = zP.slBufPips;
  for (const k of ['A', 'E', 'F', 'H', 'K', 'L', 'M', 'N']) sp[k].enabled = false;
  return s;
}

function run(w: BacktestWindow, s: Settings) {
  const r = withBacktestEngine(w, data => runBacktest(data, s, Date.now(), [], { fromT: w.reportFrom, toT: w.reportTo }));
  if (!r.ok) throw new Error(r.reason);
  return (r.result.trades as { strategy: string; pnl: number }[]);
}

async function main() {
  mt5Feed();
  const grid: { minSweepPips: number; rr: number; slBufPips: number }[] = [];
  for (const ms of [15, 25, 40]) for (const rr of [1.5, 2.0, 3.0]) grid.push({ minSweepPips: ms, rr, slBufPips: 15 });
  const scored: { label: string; m: M | null; score: number; p: typeof grid[0] }[] = [];
  for (const p of grid) {
    const m = metricsOf(run(TRAIN_W, buildSettings(p)), 'Z');
    const score = m ? m.net / m.trades * Math.min(1, m.trades / 15) : -1;
    scored.push({ label: `sweep=${p.minSweepPips} rr=${p.rr}`, m, score, p });
    console.log(`${p.minSweepPips}/${p.rr}: ${m ? m.trades + ' صفقة | نجاح ' + Math.round(m.winRate) + '% | PF ' + fmt(m.pf) + ' | صافي ' + fmt(m.net) + '$' : 'لا صفقات'} | درجة ${fmt(score)}`);
  }
  const best = scored.filter(x => x.m && x.m.trades >= 12 && x.m.net > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) { console.log('\nلا توليفة تدريب مؤهلة — Z تبقى معطلة'); return; }
  console.log(`\n=== الأفضل: ${best.label} — الحكم خارج العينة ===`);
  const oosM = metricsOf(run(OOS_W, buildSettings(best.p)), 'Z');
  console.log(oosM ? `${oosM.trades} صفقة | نجاح ${Math.round(oosM.winRate)}% | PF ${fmt(oosM.pf)} | صافي ${fmt(oosM.net)}$` : 'لا صفقات');
  console.log('القرار:', oosM && oosM.pf > 1 && oosM.net > 0 ? '✓ نجح خارج العينة — مؤهل للتفعيل' : '✗ فشل خارج العينة — يبقى معطلاً');
}
main();
