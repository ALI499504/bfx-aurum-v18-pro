// اختبار التكامل: runBacktest الرسمي على بيانات 17 شهراً — يجب أن يطابق البحث
import { readFileSync } from 'fs';
import { Candle } from '../src/lib/engine/types';
import { loadData, runBacktest } from '../src/lib/engine/backtest';

const toCandles = (rows: unknown[]): Candle[] =>
  (rows as [number, number, number, number, number, number][])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && r[0] > 0 && r[2] >= r[3])
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 }));

const snap = JSON.parse(readFileSync('db/research/mt5-feed-snapshot.json', 'utf8'));
const t: Record<string, unknown[]> = snap.tfs;
const data = loadData({
  '5m': toCandles(t['5m']),
  '15m': toCandles(t['15m']),
  '1d': toCandles(t['1d']),
  '1w': toCandles(t['1w']),
  '1M': toCandles(t['1M']),
});

const t0 = Date.now();
const res = runBacktest(data, { lot: 0.01, spreadCents: 30 });
const ms = Date.now() - t0;
const s = res.stats;
console.log(`زمن التشغيل: ${ms}ms`);
console.log(`صفقات: ${s.totalTrades} | نجاح: ${s.winRate.toFixed(1)}% | صافي: ${s.netPnl.toFixed(2)}$ | PF: ${s.profitFactor.toFixed(2)}`);
console.log(`OOS: ${s.oos.trades} صفقة، ${s.oos.winRate.toFixed(1)}% | دروداون: ${s.maxDrawdown.toFixed(0)}$`);
console.log(`مناطق: ${s.zones.formed} | إشارات: ${s.signalsCount} | مرفوضات:`, s.blocked);
console.log(`إجمالي R: ${s.totalR} | متوسط R: ${s.avgR}`);
const perType = { sweep: 0, BOS: 0 };
for (const tr of res.trades) if (tr.confirmationType) perType[tr.confirmationType]++;
console.log('حسب نوع التأكيد:', perType);
const perTfS = res.trades.reduce<Record<string, { n: number; w: number }>>((acc, tr) => {
  const k = tr.zoneTf ?? '?';
  acc[k] = acc[k] ?? { n: 0, w: 0 };
  acc[k].n++; if (tr.pnl > 0) acc[k].w++;
  return acc;
}, {});
console.log('حسب فريم المنطقة:', Object.fromEntries(Object.entries(perTfS).map(([k, v]) => [k, `${v.w}/${v.n} = ${(v.w / v.n * 100).toFixed(0)}%`])));
console.log('pending:', res.finalPending.length, '| zonesNear:', res.zonesNear.length, '| decisionLog:', res.decisionLog.length);

require('fs').writeFileSync('/tmp/integ_trades.json', JSON.stringify(res.trades.map(x => ({ entryT: x.entryT, entry: x.entry, exit: x.exit, pnl: x.pnl, exitT: x.exitT, slO: x.slOrig, zoneId: x.zoneId }))));
if (res.trades.length) {
  const last = res.trades[res.trades.length - 1];
  console.log('\nآخر صفقة:', new Date(last.entryT).toISOString(), last.dir, 'entry', last.entry.toFixed(2), 'sl', last.sl.toFixed(2), 'tp', last.tp.toFixed(2), '→', last.result, last.pnl.toFixed(2) + '$');
  console.log('reason:', last.reason.slice(0, 220));
}
