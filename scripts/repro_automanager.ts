// إعادة إنتاج تقييم المدير الآلي بالضبط — لماذا عُطّلت X؟
import Database from 'bun:sqlite';
import { runBacktest } from '../src/lib/engine/backtest';
import { getEngineData } from '../src/lib/server/data';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
const data = getEngineData();
if (!data) { console.log('لا بيانات'); process.exit(1); }

const result = runBacktest(data, settings, Date.now(), realNews);
const allTr = result.trades as unknown as { strategy: string; session: string; pnl: number; entryT?: number }[];

console.log('إجمالي الصفقات في النافذة الكاملة:', allTr.length);
console.log('نطاق البيانات:', new Date((data.c5[0]?.t ?? 0) * 1000).toISOString(), '←', new Date((data.c5[data.c5.length-1]?.t ?? 0) * 1000).toISOString());

// نفس فلتر المدير الآلي: entryT >= now - 90d
const nowMs = Date.now();
const WINDOW_MS = 90 * 86400e3;
const evaluate = allTr.filter(t => (t.entryT ?? 0) >= nowMs - WINDOW_MS);
console.log('بعد فلتر 90 يوماً (entryT):', evaluate.length);

// ماذا لو استُخدم حقل آخر للزمن؟
const noEntryT = allTr.filter(t => t.entryT === undefined).length;
console.log('صفقات بلا entryT:', noEntryT);

// مقاييس X بالفلتر
function metrics(trades: typeof allTr, st: string) {
  const t = trades.filter(x => x.strategy === st);
  if (!t.length) return null;
  let gw = 0, gl = 0, net = 0, wins = 0;
  for (const x of t) { net += x.pnl; if (x.pnl >= 0) { gw += x.pnl; wins++; } else gl += -x.pnl; }
  return { n: t.length, pf: gl > 0 ? gw / gl : 99, net: Math.round(net * 100) / 100, wr: Math.round(wins / t.length * 100) };
}
for (const st of ['X', 'H', 'I', 'W', 'Y', 'AA']) {
  console.log(st, 'فلتر90:', JSON.stringify(metrics(evaluate, st)), '| كامل:', JSON.stringify(metrics(allTr, st)));
}

// أول وآخر entryT لصفقات X
const xs = allTr.filter(t => t.strategy === 'X');
if (xs.length) {
  const ets = xs.map(t => t.entryT ?? 0).sort((a, b) => a - b);
  console.log('X: أول entryT', new Date(ets[0]).toISOString(), '| آخر', new Date(ets[ets.length - 1]).toISOString());
}
