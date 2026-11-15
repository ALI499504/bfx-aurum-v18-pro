// Equivalence + speed check: runs fixed scenarios and dumps results JSON
// Usage: bun run scripts/verify-equivalence.ts <label> <outFile>
import { readFileSync, writeFileSync } from 'fs';
import { aggregate, aggregateWeekly, aggregateMonthly, runBacktest, type EngineData } from '../src/lib/engine/backtest';
import type { Candle } from '../src/lib/engine/types';
import { TF_MS } from '../src/lib/engine/types';

const label = process.argv[2] ?? 'x';
const outFile = process.argv[3] ?? `/tmp/bt-${label}.json`;

const raw = JSON.parse(readFileSync('/home/z/my-project/db/mt5-feed-snapshot.json', 'utf8'));
const conv = (a: unknown[][]): Candle[] => a.map(x => ({ t: x[0] as number, o: x[1] as number, h: x[2] as number, l: x[3] as number, c: x[4] as number, v: x[5] as number }));
const tfs: Record<string, Candle[]> = {};
for (const k of Object.keys(raw.tfs as Record<string, unknown[][]>)) tfs[k] = conv(raw.tfs[k]);
const c5all = tfs['5m'];
const settings = { lot: 0.01, spreadCents: 20 };
const NOW = 1794084400000; // fixed nowMs for determinism

function dataForMonths(months: number): EngineData {
  const cutoff = c5all[c5all.length - 1].t - months * 30 * 86400e3;
  let i = 0;
  while (i < c5all.length && c5all[i].t < cutoff) i++;
  const c5 = c5all.slice(i);
  return {
    c5,
    c15: aggregate(c5, TF_MS['15m']),
    c30: aggregate(c5, TF_MS['30m']),
    c1h: aggregate(c5, TF_MS['1h']),
    c4h: aggregate(c5, TF_MS['4h']),
    c1d: tfs['1d'], c1w: tfs['1w'], c1M: tfs['1M'],
  };
}

const out: Record<string, unknown> = { label };

// Scenario A: 6 months, no range
{
  const d = dataForMonths(6);
  const t0 = Date.now();
  const r = runBacktest(d, settings, NOW);
  const ms = Date.now() - t0;
  out.a6 = { ms, trades: r.trades.length, winRate: r.stats.winRate, netPnl: r.stats.netPnl, formed: r.stats.zones.formed, dead: r.stats.zones.dead, signals: r.stats.signalsCount, blocked: r.stats.fillsBlocked,
    sig: r.trades.map(t => [t.id, t.entryT, t.exitT, +t.entry.toFixed(5), +t.exit.toFixed(5), +t.pnl.toFixed(6), t.result, t.dir]) };
}
// Scenario B: 9 months, no range
{
  const d = dataForMonths(9);
  const t0 = Date.now();
  const r = runBacktest(d, settings, NOW);
  const ms = Date.now() - t0;
  out.b9 = { ms, trades: r.trades.length, winRate: r.stats.winRate, netPnl: r.stats.netPnl, formed: r.stats.zones.formed, dead: r.stats.zones.dead, signals: r.stats.signalsCount, blocked: r.stats.fillsBlocked,
    sig: r.trades.map(t => [t.id, t.entryT, t.exitT, +t.entry.toFixed(5), +t.exit.toFixed(5), +t.pnl.toFixed(6), t.result, t.dir]) };
}
// Scenario C: 9 months with report range (year-window style)
{
  const d = dataForMonths(9);
  const fromT = d.c5[0].t + 60 * 86400e3; // report starts 60d into data
  const t0 = Date.now();
  const r = runBacktest(d, settings, NOW, { fromT, toT: d.c5[d.c5.length - 1].t });
  const ms = Date.now() - t0;
  out.c9r = { ms, trades: r.trades.length, winRate: r.stats.winRate, netPnl: r.stats.netPnl,
    sig: r.trades.map(t => [t.id, t.entryT, t.exitT, +t.entry.toFixed(5), +t.exit.toFixed(5), +t.pnl.toFixed(6), t.result, t.dir]) };
}

writeFileSync(outFile, JSON.stringify(out));
console.log(`label=${label} A6=${(out.a6 as { ms: number }).ms}ms B9=${(out.b9 as { ms: number }).ms}ms C9R=${(out.c9r as { ms: number }).ms}ms -> ${outFile}`);
