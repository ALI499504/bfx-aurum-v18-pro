// اختبار سريع للمحرك من سطر الأوامر
import { readFileSync } from 'fs';
import type { Candle } from '../src/lib/engine/types';
import { runBacktest, aggregate } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';

const load = (iv: string): Candle[] => JSON.parse(readFileSync(`/home/z/my-project/data/xau_${iv}.json`, 'utf8'));

const t0 = Date.now();
const c5 = load('5m');
console.log(`candles 5m: ${c5.length} (load ${Date.now() - t0}ms)`);

const data = {
  c5,
  c15: load('15m'),
  c30: aggregate(c5, 1800e3),
  c1h: load('1h'),
  c4h: load('4h'),
  c1d: load('1d'),
  c1w: load('1w'),
  c1M: load('1M'),
};

const t1 = Date.now();
const res = runBacktest(data, DEFAULT_SETTINGS as never);
console.log(`backtest: ${Date.now() - t1}ms`);
const s = res.stats;
console.log(`signals: ${s.signalsCount}, trades: ${s.totalTrades}, wins: ${s.wins}, losses: ${s.losses}`);
console.log(`winRate: ${s.winRate.toFixed(1)}%, net: $${s.netPnl.toFixed(2)}, PF: ${s.profitFactor.toFixed(2)}, maxDD: $${s.maxDrawdown.toFixed(2)}`);
console.log(`OOS: trades=${s.oos.trades}, wr=${s.oos.winRate.toFixed(1)}%, avgR=${s.oos.avgR.toFixed(2)}, gate=${s.oos.gatePass}`);
console.log(`dailyKPI: ${s.dailyKpi.daysWith2Plus}/${s.dailyKpi.daysTraded} = ${s.dailyKpi.pct.toFixed(0)}%`);
console.log(`blocked fills: ${s.fillsBlocked}`);
console.log('top strategies:', s.ranking.slice(0, 5).map(r => `${r.strategy}:$${r.net.toFixed(0)}(${r.trades})`).join(' '));
console.log('trend1h:', res.finalStructure.trend1h, 'trend4h:', res.finalStructure.trend4h);
console.log('sample trade:', JSON.stringify(res.trades[0], null, 1)?.slice(0, 400));
