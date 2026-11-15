// ============================================================
// مسح v12 — الاختيار النهائي (M15 مناطق، تأمين lock صادق، نطاقات المالك)
// التشغيل: bun scripts/sweep-params.ts
// ============================================================
import { mt5Feed } from '../src/lib/server/mt5feed';
import { loadData, resetEngineCache, runBacktest } from '../src/lib/engine/backtest';
import type { EngineData } from '../src/lib/engine/backtest';
import { SMC_CFG } from '../src/lib/engine/smc';
import { DISCIPLINE } from '../src/lib/engine/discipline';
import type { Settings } from '../src/lib/engine/rules';

const settings: Settings = { lot: 0.01, spreadCents: 30 };

let data: EngineData | null = null;
function getData(): EngineData {
  if (data) return data;
  const s = mt5Feed();
  const raw: Record<string, unknown> = {};
  for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) raw[tf] = s.tfs[tf];
  resetEngineCache();
  data = loadData(raw);
  return data;
}

interface Row {
  name: string; trades: number; d10: number; wr: number; net: number; pf: number;
  ins: number; tp: number; avgWin: number; avgLoss: number; dd: number; maxDay: number;
}

function run(name: string): Row {
  resetEngineCache();
  const r = runBacktest(getData(), settings, Date.now());
  const st = r.stats;
  const winsArr = r.trades.filter(t => t.pnl > 0);
  const lossArr = r.trades.filter(t => t.pnl <= 0);
  return {
    name, trades: st.totalTrades, d10: st.discipline.summary.minTradesDays,
    wr: st.winRate, net: st.netPnl, pf: st.profitFactor,
    ins: st.discipline.summary.insuredTrades,
    tp: r.trades.filter(t => t.result === 'tp').length,
    avgWin: winsArr.length ? winsArr.reduce((a, t) => a + t.pnl, 0) / winsArr.length : 0,
    avgLoss: lossArr.length ? lossArr.reduce((a, t) => a + t.pnl, 0) / lossArr.length : 0,
    dd: st.maxDrawdownPct,
    maxDay: st.daily.reduce((a, d) => Math.max(a, d.trades), 0),
  };
}

const S = SMC_CFG as unknown as Record<string, unknown>;
const D = DISCIPLINE as unknown as Record<string, unknown>;

const rows: Row[] = [];
function go(name: string): void { rows.push(run(name)); }

// Z1: الافتراضيات المقفلة (لمسة عادية، نطاقات بنيوية 10-15)
go('Z1 defaults (lock5, SL/TP band, plain touch)');
// Z2: بلا اشتراط السحب عند اللمسة
(S.TOUCH_PIERCE as number) = 0;
go('Z2 = Z1 بلا pierce');
(S.TOUCH_PIERCE as number) = 0.1; (S.TOUCH_RECLAIM as boolean) = false;
go('Z3 = Z1 مع pierce فقط (بلا reclaim)');
(S.TOUCH_RECLAIM as boolean) = true;
// Z4: وقف ثابت 10 وهدف ثابت 15
D.SL_FIX_USD = 10; D.TP_FIX_USD = 15;
go('Z4 lock5 + SL10/TP15 ثابتة');
// Z5: Z1 مع هدف ثابت 12.5
D.SL_FIX_USD = 0; D.TP_FIX_USD = 12.5;
go('Z5 lock5 + SL band/TP12.5');
D.TP_FIX_USD = 0;
// Z6: Z1 مع TS24
D.TIME_STOP_BARS = 24;
go('Z6 = Z1 مع TS24');
D.TIME_STOP_BARS = 12;
// Z7: Z1 مع نوافذ قديمة (7-13/14-21.5)
(SMC_CFG as unknown as { KZ_LDN: [number, number] }).KZ_LDN = [7, 13];
(SMC_CFG as unknown as { KZ_NY: [number, number] }).KZ_NY = [14, 21.5];
go('Z7 = Z1 مع نوافذ قديمة');
(SMC_CFG as unknown as { KZ_LDN: [number, number] }).KZ_LDN = [6, 14];
(SMC_CFG as unknown as { KZ_NY: [number, number] }).KZ_NY = [13, 21.5];

console.log('\n' + ['التوليفة', 'صفقات', '≥10/يوم', 'أيام-نشطة', 'نجاح%', 'صافي$', 'PF', 'تأمين', 'TP', 'متوسط+', 'متوسط-', 'DD%', 'أقصى/يوم'].join(' | '));
for (const r of rows) {
  const active = Math.round(r.trades / Math.max(1, r.trades / 436));
  console.log([r.name, r.trades, r.d10, r.wr.toFixed(1), r.net.toFixed(1), r.pf.toFixed(2), r.ins, r.tp, r.avgWin.toFixed(2), r.avgLoss.toFixed(2), r.dd.toFixed(1), r.maxDay].join(' | '));
}
