// ============================================================
// مقارنة سقف الاحتفاظ 48 مقابل 72 ساعة — باللوت الثابت 0.01 الصارم
// قرار المالك: «لا أريد صفقة أكثر من يومين أو ثلاثة أيام — اجعله يتقيد بذلك»
// يشغّل الباك تيست مرتين (48h ثم 72h) بالبوابات نفسها ويطبع المقارنة.
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings0 = await loadBotSettings();
const realNews = await loadRealNews();

// ضمان اللوت الصارم في النسخة قيد الاختبار (حماية إضافية فوق المحفوظ)
settings0.globalRules.sizing_quality = { enabled: false, value: 1 };
settings0.globalRules.fixed_lot = { enabled: true, value: 0.01 };

const agg = (r: { trades: { strategy: string; pnl: number; result: string; exitT: number; entryT: number }[] }) => {
  const m = new Map<string, { n: number; net: number }>();
  for (const t of r.trades) {
    const a = m.get(t.strategy) ?? { n: 0, net: 0 };
    a.n++; a.net += t.pnl;
    m.set(t.strategy, a);
  }
  return m;
};

const runs: { cap: number; st: typeof settings0 }[] = [
  { cap: 48, st: structuredClone(settings0) },
  { cap: 72, st: structuredClone(settings0) },
];
for (const run of runs) {
  run.st.globalRules.max_hold_hours = { enabled: true, value: run.cap };
}

const out: Record<string, unknown>[] = [];
for (const run of runs) {
  const t0 = Date.now();
  const r = runBacktestCached(null, run.st, realNews);
  if (!r.ok) { console.error(`FAILED @${run.cap}h:`, r.reason); process.exit(1); }
  const st = r.stats;
  const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const timeExits = r.trades.filter(t => t.result === 'time').length;
  const overCap = holds.filter(h => h > run.cap + 0.1).length;
  const perStrat = agg(r);
  const top = ['E', 'W', 'X', 'I', 'AA', 'F', 'Y', 'M'].map(s => {
    const a = perStrat.get(s);
    return `${s}:${a ? Math.round(a.net) : 0}$/${a?.n ?? 0}n`;
  }).join(' ');
  console.log(`--- ${run.cap}h ---`);
  console.log(`trades=${st.totalTrades} wr=${(st.winRate ?? 0).toFixed(1)}% net=${(st.netPnl ?? 0).toFixed(2)} PF=${(st.profitFactor ?? 0).toFixed(3)} DD=${(st.maxDrawdownPct ?? 0).toFixed(2)}% | أطول صفقة=${Math.max(...holds).toFixed(1)}h إغلاقات زمنية=${timeExits} فوق السقف=${overCap}`);
  console.log(`  ${top}`);
  console.log(`  بوابات: ${JSON.stringify(st.adaptiveGates)}`);
  out.push({ cap: run.cap, stats: st, holds: { max: Math.max(...holds), timeExits, overCap }, perStrat: [...perStrat.entries()].map(([strategy, a]) => ({ strategy, n: a.n, net: Math.round(a.net * 100) / 100 })) });
  console.log(`  (${Math.round((Date.now() - t0) / 1000)}s)`);
}

await Bun.write('/tmp/cap_compare.json', JSON.stringify(out, null, 1));
console.log('saved /tmp/cap_compare.json');
