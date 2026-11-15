// ============================================================
// تشغيل باك تيست التحقق مباشرة عبر المحرك (بلا خادم Next وبلا كاش)
// يقارن: الأداء لكل استراتيجية بعد إصلاحات خطة التحويل على النافذة الكاملة
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
console.log('[verify] settings loaded, running full-history backtest...');
const t0 = Date.now();
const r = runBacktestCached(null, settings, realNews);
if (!r.ok) {
  console.error('[verify] FAILED:', r.reason);
  process.exit(1);
}
const ms = Date.now() - t0;
const st = r.stats;
console.log(`[verify] done in ${ms}ms | trades=${st.totalTrades} wr=${(st.winRate ?? 0).toFixed(1)}% net=${(st.netPnl ?? 0).toFixed(2)} PF=${(st.profitFactor ?? 0).toFixed(3)} DD=${(st.maxDrawdownPct ?? 0).toFixed(2)}%`);

// إثبات الوقف الزمني (القاعدة 4): أطول احتفاظ فعلي + عدد الإغلاقات الزمنية الإجبارية
const r4 = settings.globalRules.max_hold_hours;
const capH = r4?.enabled ? (r4.value ?? 48) : 0;
const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
const maxHoldH = holds.length ? Math.max(...holds) : 0;
const timeExits = r.trades.filter(t => t.result === 'time').length;
const overCap = capH > 0 ? holds.filter(h => h > capH + 0.1).length : 0;
console.log(`[قاعدة 4] سقف الاحتفاظ: ${capH > 0 ? `${capH} ساعة` : 'معطل'} | أطول صفقة فعلية: ${maxHoldH.toFixed(1)} ساعة | إغلاقات زمنية إجبارية: ${timeExits} | صفقات فوق السقف: ${overCap}`);

// شفافية البوابات التكيفية (قواعد 31/32/33)
if (st.adaptiveGates) {
  const ag = st.adaptiveGates;
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}:${v}`).join('، ') || '—';
  console.log(`[قاعدة 31] احتجاز اتجاهي (صفقات محجوبة): ${fmt(ag.sideGuard)}`);
  console.log(`[قاعدة 32] احتجاز انحسار 90 يوم (صفقات محجوبة): ${fmt(ag.decayGuard)}`);
  console.log(`[قاعدة 33] صفقات اللوت المحسّن: ${ag.boostedFills} (${fmt(ag.boostedByStrat)})`);
}

// تجميع كامل لكل استراتيجية (كل الصفقات — بلا اقتطاع)
const agg = new Map<string, { n: number; net: number; wins: number; gw: number; gl: number }>();
for (const t of r.trades) {
  const s = String(t.strategy);
  const a = agg.get(s) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
  a.n++; a.net += t.pnl;
  if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
  agg.set(s, a);
}
const rows = [...agg.entries()]
  .map(([strategy, a]) => ({ strategy, trades: a.n, net: Math.round(a.net * 100) / 100, wr: a.n ? Math.round((a.wins / a.n) * 1000) / 10 : 0, pf: a.gl > 0 ? Math.round((a.gw / a.gl) * 100) / 100 : (a.gw > 0 ? 99 : 0) }))
  .sort((x, y) => y.net - x.net);
console.log('\ncode | trades |    net$   |  wr%  |  pf');
for (const row of rows) console.log(`${row.strategy.padStart(4)} | ${String(row.trades).padStart(6)} | ${row.net.toFixed(2).padStart(9)} | ${String(row.wr).padStart(5)} | ${row.pf.toFixed(2)}`);

// تفصيل شراء/بيع للاستراتيجيات الكبرى (تشخيص تفاعل البوابات مع خانة العائلة الواحدة)
console.log('\n--- شراء/بيع ---');
const dirAgg = new Map<string, { n: number; net: number }>();
for (const t of r.trades) {
  const k = `${t.strategy}:${t.dir === 'buy' ? 'شراء' : 'بيع'}`;
  const a = dirAgg.get(k) ?? { n: 0, net: 0 };
  a.n++; a.net += t.pnl;
  dirAgg.set(k, a);
}
for (const [k, a] of [...dirAgg.entries()].filter(([k]) => ['E', 'I', 'W', 'X', 'H', 'F'].some(s => k.startsWith(s + ':'))).sort((x, y) => y[1].net - x[1].net)) {
  console.log(`${k.padEnd(8)} | ${String(a.n).padStart(5)} | ${a.net.toFixed(2).padStart(10)}`);
}

// حفظ للنقل
await Bun.write('/tmp/bt_direct.json', JSON.stringify({ stats: st, byStrategy: rows, runMs: ms, hold: { capHours: capH, maxHours: Math.round(maxHoldH * 10) / 10, timeExits, overCap } }));
console.log('\n[verify] saved /tmp/bt_direct.json');
