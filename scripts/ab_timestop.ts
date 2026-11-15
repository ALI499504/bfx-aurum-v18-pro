// A/B: أثر مدة الوقف الزمني (TIME_STOP_BARS) على الأداء — آخر 6 أشهر فقط
import fs from 'fs';
import { runBacktest, loadData, resetEngineCache, EngineData } from '../src/lib/engine/backtest';
import { Candle } from '../src/lib/engine/types';
import { DISCIPLINE } from '../src/lib/engine/discipline';

const SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json';
function sanitize(a: unknown): Candle[] {
  const arr = Array.isArray(a) ? a : [];
  const out: Candle[] = [];
  for (const r of arr) {
    if (Array.isArray(r) && r.length >= 5) {
      const [T, O, H, L, C, V] = r as number[];
      if ([T, O, H, L, C].every(Number.isFinite)) out.push({ t: Math.round(T), o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? Math.round(V) : 0 });
    } else if (r && typeof r === 'object') {
      const c = r as Record<string, number>;
      if ([c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) out.push({ t: Math.round(c.t), o: c.o, h: c.h, l: c.l, c: c.c, v: Math.round(c.v ?? 0) });
    }
  }
  return out;
}
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')) as Record<string, unknown>;
const tfsJ = (snap.tfs ?? {}) as Record<string, unknown>;
const files: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
  const arr = sanitize(tfsJ[tf]);
  if (arr.length) files[tf] = arr;
}
// آخر 6 أشهر على 5m (فريمات المناطق بكامل تاريخها)
const cutoff = files['5m'][files['5m'].length - 1].t - 182 * 86400e3;
files['5m'] = files['5m'].filter(c => c.t >= cutoff);

const variants = [24, 48, 96];
console.log('variant | trades | wr% | PF | net$ | avgR | trades/day | sl_hits | tp_hits | time_exits | maxDD%');
for (const ts of variants) {
  (DISCIPLINE as { TIME_STOP_BARS: number }).TIME_STOP_BARS = ts;
  resetEngineCache();
  const data: EngineData = loadData({ ...files });
  const r = runBacktest(data, { lot: 0.01, spreadCents: 30 }, Date.now());
  const s = r.stats;
  const days = s.daily.filter(d => d.trades > 0).length || 1;
  const res = { tp: 0, sl: 0, time: 0 };
  for (const t of r.trades) res[t.result === 'tp' ? 'tp' : t.result === 'sl' ? 'sl' : 'time']++;
  const perDay = s.totalTrades / days;
  console.log(`${String(ts).padStart(7)} | ${String(s.totalTrades).padStart(6)} | ${s.winRate.toFixed(1)} | ${s.profitFactor.toFixed(2)} | ${s.netPnl.toFixed(1)} | ${s.avgR} | ${perDay.toFixed(2)} | ${res.sl} | ${res.tp} | ${res.time} | ${s.maxDrawdownPct.toFixed(1)}`);
}
