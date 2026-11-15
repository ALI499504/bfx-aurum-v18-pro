// حساب PF لكل (استراتيجية:جهة) من الباكitest الكامل — أساس تحديد الأطراف الميتة
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
const r = runBacktestCached(null, settings, realNews);
if (!r.ok) { console.error('FAILED:', r.reason); process.exit(1); }

const agg = new Map<string, { n: number; net: number; gw: number; gl: number }>();
for (const t of r.trades) {
  const k = `${t.strategy}:${t.dir === 'buy' ? 'BUY' : 'SELL'}`;
  const a = agg.get(k) ?? { n: 0, net: 0, gw: 0, gl: 0 };
  a.n++; a.net += t.pnl;
  if (t.pnl > 0) a.gw += t.pnl; else if (t.pnl < 0) a.gl += -t.pnl;
  agg.set(k, a);
}
console.log('key      | trades |     net$   |    PF');
const rows = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, a] of rows) {
  const pf = a.gl > 0 ? (a.gw / a.gl) : (a.gw > 0 ? 99 : 0);
  const flag = a.n >= 100 && pf < 1.0 ? ' <-- طرف ميت (PF<1 بعينة>=100)' : '';
  console.log(`${k.padEnd(9)}| ${String(a.n).padStart(6)} | ${a.net.toFixed(2).padStart(10)} | ${pf.toFixed(3)}${flag}`);
}
