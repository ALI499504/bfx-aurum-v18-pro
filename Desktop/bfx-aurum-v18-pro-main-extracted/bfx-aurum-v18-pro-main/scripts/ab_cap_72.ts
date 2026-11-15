// ============================================================
// اختبار السقف الزمني 48 مقابل 72 ساعة + تحليل موضع السحبة
// المالك: «لا أريدها أكثر من يومين أو ثلاثة أيام» — الخياران متوافقان.
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();

function variant(hours: number | null, gates: boolean): Settings {
  const o = structuredClone(base) as Settings;
  o.globalRules.max_hold_hours = hours === null ? { enabled: false, value: 48 } : { enabled: true, value: hours };
  o.globalRules.gate_side_pf = { enabled: gates, value: 90 };
  o.globalRules.gate_decay90 = { enabled: gates, value: 100 };
  o.globalRules.sizing_quality = { enabled: gates, value: 2 };
  return o;
}

const cases: { name: string; s: Settings }[] = [
  { name: 'D48) كل المعتمد + سقف 48 ساعة', s: variant(48, true) },
  { name: 'E72) كل المعتمد + سقف 72 ساعة', s: variant(72, true) },
  { name: 'F72) سقف 72 فقط بلا بوابات', s: variant(72, false) },
  { name: 'D-noBoost) بوابات 1+2 فقط بلا تحجيم', s: (() => { const s = variant(48, true); s.globalRules.sizing_quality = { enabled: false, value: 2 }; return s; })() },
];

const fmtS = (n: number) => n.toFixed(2).padStart(10);
const results: Record<string, { n: number; net: number; pf: number; dd: number; wr: number; timeExits: number; maxHoldH: number; overCap: number; boosted: number; decayBlocked: number }> = {};

for (const c of cases) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) { console.error(`${c.name}: FAILED ${r.reason}`); process.exit(1); }
  const st = r.stats;
  const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const capH = c.s.globalRules.max_hold_hours?.enabled ? (c.s.globalRules.max_hold_hours.value ?? 48) : 0;
  const ag = st.adaptiveGates;
  results[c.name] = {
    n: st.totalTrades, net: st.netPnl ?? 0, pf: st.profitFactor ?? 0, dd: st.maxDrawdownPct ?? 0, wr: st.winRate ?? 0,
    timeExits: r.trades.filter(t => t.result === 'time').length,
    maxHoldH: holds.length ? Math.max(...holds) : 0,
    overCap: capH > 0 ? holds.filter(h => h > capH + 0.1).length : -1,
    boosted: ag?.boostedFills ?? 0,
    decayBlocked: Object.values(ag?.decayGuard ?? {}).reduce((a, b) => a + b, 0),
  };
  const x = results[c.name];
  console.log(`${c.name.padEnd(36)} | ${String(x.n).padStart(5)} صفقة | net ${fmtS(x.net)}$ | PF ${x.pf.toFixed(3)} | DD ${x.dd.toFixed(2)}% | زمني ${x.timeExits} | أطول ${x.maxHoldH.toFixed(1)}س | فوق السقف ${x.overCap} | مضاعف ${x.boosted} | انحسار ${x.decayBlocked}`);
}

// تحليل موضع السحبة الأعمق من الصفقات (إيكويتي مُغلق)
console.log('\n--- موضع القاع (من إيكويتي الصفقات المُغلقة) ---');
for (const c of cases) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) continue;
  const sorted = [...r.trades].sort((a, b) => a.exitT - b.exitT);
  let bal = 1000, peak = 1000, worst = 0, worstT = 0;
  for (const t of sorted) {
    bal += t.pnl;
    peak = Math.max(peak, bal);
    const dd = ((peak - bal) / peak) * 100;
    if (dd > worst) { worst = dd; worstT = t.exitT; }
  }
  const d = new Date(worstT).toISOString().slice(0, 10);
  const y = new Date(worstT).getFullYear();
  // صفقات السنة نفسها عند القاع
  const tradesNear = sorted.filter(t => Math.abs(t.exitT - worstT) < 30 * 86400e3);
  const byStrat = new Map<string, number>();
  for (const t of tradesNear) byStrat.set(t.strategy, (byStrat.get(t.strategy) ?? 0) + t.pnl);
  const top = [...byStrat.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' ');
  console.log(`${c.name.padEnd(36)} | القاع ${worst.toFixed(2)}% بتاريخ ${d} | ${y} | أسوأ مساهمين: ${top}`);
}

await Bun.write('/tmp/ab_cap.json', JSON.stringify(results, null, 2));
console.log('\n[saved] /tmp/ab_cap.json');
