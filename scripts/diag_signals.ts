// تشخيص: عدد إشارات كل كاشف على البيانات الحقيقية
import { readFileSync } from 'fs';
import { loadData, runBacktest } from '../src/lib/engine/backtest';
import { loadBotSettings } from '../src/lib/server/backtestRunner';

const snap = JSON.parse(readFileSync('db/mt5-feed-snapshot.json', 'utf8'));
const toC = (a: unknown[]): { t: number; o: number; h: number; l: number; c: number; v: number } =>
  ({ t: a[0] as number, o: a[1] as number, h: a[2] as number, l: a[3] as number, c: a[4] as number, v: a[5] as number });
const files: Record<string, { t: number; o: number; h: number; l: number; c: number; v: number }[]> = {};
for (const [tf, arr] of Object.entries(snap.tfs as Record<string, unknown[][]>)) {
  files[tf] = arr.map(toC);
}
const data = loadData(files as never);
console.log('candles 5m:', data.c5.length);

const settings = await loadBotSettings();
const t0 = Date.now();
const r = runBacktest(data, settings, Date.now(), []);
console.log('run ms:', Date.now() - t0);
console.log('صفقات:', r.stats.totalTrades, 'صافي:', r.stats.netPnl.toFixed(2), '$ نجاح:', r.stats.winRate.toFixed(1) + '%');
console.log('signalsCount:', r.stats.signalsCount, '| finalPending:', r.finalPending.length);
const byStrat: Record<string, number> = {};
for (const t of r.trades) byStrat[t.strategy] = (byStrat[t.strategy] ?? 0) + 1;
console.log('صفقات لكل استراتيجية:', byStrat);
for (const [k, v] of Object.entries(r.stats.strategyTotals ?? {})) if (v.trades) console.log(` ${k}: ${v.trades} صفقة ${v.net.toFixed(2)}$`);
console.log('blocked:', r.stats.blocked);
