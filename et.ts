import fs from 'node:fs';
import { loadData, runBacktest, resetEngineCache } from './src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from './src/lib/engine/rules';
import type { Candle } from './src/lib/engine/types';
const j = JSON.parse(fs.readFileSync('/tmp/snap.json', 'utf8')) as { tfs: Record<string, number[][]> };
const toC = (rows: number[][]): Candle[] => rows.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
const files: Record<string, Candle[]> = {};
for (const k of Object.keys(j.tfs)) files[k] = toC(j.tfs[k]);
const c5 = files['5m'];

function run(fast: number, slow: number, extra?: (st: any) => void) {
  resetEngineCache();
  const data = loadData(files);
  const st = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  st.indicators.emaFast = fast; st.indicators.emaSlow = slow;
  if (extra) extra(st);
  const r = runBacktest(data as never, st, c5[c5.length - 1].t, []);
  return { net: r.stats.netPnl, trades: r.stats.totalTrades, pf: r.stats.profitFactor, dd: r.stats.maxDrawdownPct, win: r.stats.winRate };
}

const pairs: [number, number][] = [[20,90],[100,400],[50,200],[100,300],[50,400],[13,48],[200,400]];
console.log('=== فلتر EMA المزدوج على النظام (كل 11 مفعّلة) ===');
console.log('EMA fast/slow | صافي | صفقات | نجاح | PF | DD');
for (const [f,s] of pairs) {
  const r = run(f,s);
  const mark = (f===20&&s===90) ? ' ← الحالي' : '';
  console.log(`${String(f).padStart(3)}/${String(s).padStart(3)}      | $${String(Math.round(r.net)).padStart(6)} | ${String(r.trades).padStart(4)} | ${r.win.toFixed(1)}% | ${r.pf.toFixed(2)} | ${r.dd.toFixed(1)}%${mark}`);
}
