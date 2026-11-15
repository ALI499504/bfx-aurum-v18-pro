// ============================================================
// معايرة صمام الإيكويتي مع تحجيم الجودة: DD مقابل الربح
// المتغيرات: بلا صمام تشديد (50%) / 30% / 25% / 20% — القواعد 31/32/33 مفعلة في الكل
// التشغيل: bun scripts/tune-fuse.ts
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();

const variants: { name: string; fuse: number }[] = [
  { name: 'الصمام الحالي 50%', fuse: 50 },
  { name: 'الصمام 30%', fuse: 30 },
  { name: 'الصمام 25%', fuse: 25 },
  { name: 'الصمام 20%', fuse: 20 },
];

const results: { name: string; fuse: number; trades: number; net: number; pf: number; wr: number; dd: number; final: number; oos: number }[] = [];
for (const v of variants) {
  const s = JSON.parse(JSON.stringify(base)) as Settings;
  (s.globalRules as Record<string, { enabled: boolean; value: number }>).fuse_equity_floor = { enabled: true, value: v.fuse };
  const r = runBacktestCached(null, s, realNews);
  if (!r.ok) { console.error(`${v.name} FAILED:`, r.reason); process.exit(1); }
  const st = r.stats;
  results.push({ name: v.name, fuse: v.fuse, trades: st.totalTrades, net: st.netPnl, pf: st.profitFactor, wr: st.winRate, dd: st.maxDrawdownPct, final: st.finalBalance, oos: st.oos.trades });
  console.log(`${v.name.padEnd(14)} | ${String(st.totalTrades).padStart(5)} صفقة | صافي ${st.netPnl.toFixed(0).padStart(6)}$ | PF ${st.profitFactor.toFixed(3)} | DD ${st.maxDrawdownPct.toFixed(2)}% | رصيد ${st.finalBalance.toFixed(0)}$`);
}

// اختيار التوازن: أعلى صافي مع DD ≤ 30%
const ok = results.filter(r => r.dd <= 30);
const best = ok.length ? ok.reduce((a, b) => (b.net > a.net ? b : a)) : results[0];
console.log(`\n>>> التوازن الموصى به: ${best.name} — صافي ${best.net.toFixed(0)}$ | PF ${best.pf.toFixed(3)} | DD ${best.dd.toFixed(2)}%`);
await Bun.write('/tmp/fuse_tune.json', JSON.stringify(results));
