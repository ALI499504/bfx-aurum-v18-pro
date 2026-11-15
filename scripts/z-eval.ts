// ============================================================
// تقييم استراتيجية Z (انجراف السيولة وإعادة الاستحواذ) على الشموع الحقيقية
// بنفس منهجية الضابط: تدريب 2025-06→2026-05 + تحقق خارجي 2026-06→الآن
// تشغيل: bun scripts/z-eval.ts
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
const line = (m: M | null) => m ? `${m.trades} صفقة | نجاح ${Math.round(m.winRate)}% | PF ${fmt(m.pf)} | صافي ${fmt(m.net)}$` : 'لا صفقات';

function buildSettings(zOn: boolean, systemOn: boolean): Settings {
  const s = structuredClone(DEFAULT_SETTINGS) as Settings;
  s.scenarioSessions = buildScenarioSessions();
  const sp = s.strategyParams as unknown as Record<string, Record<string, unknown>>;
  // القيم المضبوطة المعتمدة
  sp['A'].slPips = 100; sp['A'].tpPips = 120;
  sp['E'].slPips = 50; sp['E'].tpPips = 200;
  (sp['F'].exec as Record<string, unknown>).slPips = 60; (sp['F'].exec as Record<string, unknown>).tpPips = 120;
  sp['H'].slPips = 90; sp['H'].tpPips = 200;
  (sp['L'].exec as Record<string, unknown>).revSlPips = 30; (sp['L'].exec as Record<string, unknown>).revTpPips = 120;
  (sp['M'].exec as Record<string, unknown>).revSlPips = 50; (sp['M'].exec as Record<string, unknown>).revTpPips = 200;
  (sp['N'].exec as Record<string, unknown>).revSlPips = 80; (sp['N'].exec as Record<string, unknown>).revTpPips = 200;
  for (const k of ['B', 'C', 'D', 'G', 'I', 'J', 'O', 'P', 'Q', 'R', 'T', 'U', 'V', 'W', 'X', 'Y', 'AA']) sp[k].enabled = false;
  sp['Z'].enabled = zOn;
  if (!systemOn) for (const k of ['A', 'E', 'F', 'H', 'K', 'L', 'M', 'N']) sp[k].enabled = false;
  return s;
}

function run(w: BacktestWindow, s: Settings): { strategy: string; pnl: number }[] {
  const r = withBacktestEngine(w, data => runBacktest(data, s, Date.now(), [], { fromT: w.reportFrom, toT: w.reportTo }));
  if (!r.ok) throw new Error('باك-تست فشل: ' + r.reason);
  return (r.result.trades as { strategy: string; pnl: number }[]);
}

async function main() {
  mt5Feed();
  const feed = mt5Feed();
  const counts = Object.fromEntries(['5m','15m','30m','1h','4h','1d','1w','1M'].map(k => [k, (feed.tfs[k] as unknown[] | undefined)?.length ?? 0]));
  console.log('الشموع المحلية:', JSON.stringify(counts));

  console.log('\n=== Z وحدها — التدريب (2025-06 → 2026-05) ===');
  const tr = run(TRAIN_W, buildSettings(true, false));
  console.log(line(metricsOf(tr, 'Z')));

  console.log('\n=== Z وحدها — التحقق الخارجي (2026-06 → الآن) ===');
  const oos = run(OOS_W, buildSettings(true, false));
  console.log(line(metricsOf(oos, 'Z')));

  console.log('\n=== النظام الحي المعتمد وحده — خارج العينة ===');
  const sys0 = run(OOS_W, buildSettings(false, true));
  console.log(line(metricsOf(sys0)));

  console.log('\n=== النظام المعتمد + Z — خارج العينة ===');
  const sys1 = run(OOS_W, buildSettings(true, true));
  const t1 = sys1;
  console.log('النظام كله:', line(metricsOf(t1)));
  console.log('Z داخل النظام:', line(metricsOf(t1, 'Z')));
}
main();
