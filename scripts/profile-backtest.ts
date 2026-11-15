// ============================================================
// Profiling the backtest engine with real MT5 snapshot data
// Goal: find why backtest takes so long ("يتأخر كثيرا")
// ============================================================
import { readFileSync } from 'fs';
import { aggregate, aggregateWeekly, aggregateMonthly, runBacktest, type EngineData } from '../src/lib/engine/backtest';
import type { Candle } from '../src/lib/engine/types';
import { TF_MS } from '../src/lib/engine/types';

const raw = JSON.parse(readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8'));
const conv = (a: unknown[][]): Candle[] => a.map(x => ({ t: x[0] as number, o: x[1] as number, h: x[2] as number, l: x[3] as number, c: x[4] as number, v: x[5] as number }));

const tfs: Record<string, Candle[]> = {};
for (const k of Object.keys(raw.tfs as Record<string, unknown[][]>)) tfs[k] = conv(raw.tfs[k]);

const c5 = tfs['5m'];
console.log(`5m candles: ${c5.length}  (${new Date(c5[0].t).toISOString()} → ${new Date(c5[c5.length - 1].t).toISOString()})`);

// Build EngineData like buildWindowData does for full history (no slicing)
const data: EngineData = {
  c5,
  c15: tfs['15m'] ?? aggregate(c5, TF_MS['15m']),
  c30: tfs['30m'] ?? aggregate(c5, TF_MS['30m']),
  c1h: tfs['1h'] ?? aggregate(c5, TF_MS['1h']),
  c4h: tfs['4h'] ?? aggregate(c5, TF_MS['4h']),
  c1d: tfs['1d'] ?? aggregate(c5, TF_MS['1d']),
  c1w: tfs['1w'] ?? aggregateWeekly(c5),
  c1M: tfs['1M'] ?? aggregateMonthly(c5),
};

const settings = { lot: 0.01, spreadCents: 20 };

// warm GC-ish
const t0 = Date.now();
const res = runBacktest(data, settings, Date.now());
const ms = Date.now() - t0;
console.log(`runBacktest(full history): ${ms} ms, trades=${res.trades.length}, winRate=${res.stats.winRate}%`);

// Second run (same data, caches for structure warm)
const t1 = Date.now();
runBacktest(data, settings, Date.now());
console.log(`runBacktest(2nd run): ${Date.now() - t1} ms`);

// Yearly windows like the UI does
for (const y of [2025, 2026]) {
  const fromT = Date.UTC(y, 0, 1) - 180 * 86400e3;
  const t2 = Date.now();
  runBacktest(data, settings, Date.now(), { fromT, toT: Date.UTC(y + 1, 0, 1) - 1 });
  console.log(`runBacktest(${y} window incl 180d warmup): ${Date.now() - t2} ms`);
}
