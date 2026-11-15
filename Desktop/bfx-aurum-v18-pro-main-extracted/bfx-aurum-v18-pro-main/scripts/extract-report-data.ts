// ============================================================
// استخراج بيانات التقرير النهائي: منحنى الإيكويتي + الإحصاءات الشهرية
// لوت ثابت 0.01 صارم + سقف احتفاظ 72 ساعة + البوابات 31/32
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';

const settings = await loadBotSettings();
const realNews = await loadRealNews();
// حصن المالك — التزام صارم (نفس إعدادات الحي المحفوظة)
settings.globalRules.fixed_lot = { enabled: true, value: 0.01 };
settings.globalRules.sizing_quality = { enabled: false, value: 1 };
settings.globalRules.max_hold_hours = { enabled: true, value: 72 };

const r = runBacktestCached(null, settings, realNews);
if (!r.ok) { console.error('FAILED:', r.reason); process.exit(1); }
const st = r.stats;

// منحنى الإيكويتي: رصيد متسلسل بعد كل صفقة (بأساس 1000$)
let bal = 1000;
const eq = r.trades.map(t => { bal += t.pnl; return { t: t.exitT, v: Math.round(bal * 100) / 100 }; });
// تنقية للرسم (حتى 1200 نقطة)
const step = Math.max(1, Math.ceil(eq.length / 1200));
const eqSparse = eq.filter((_, i) => i % step === 0 || i === eq.length - 1);

// شهرية (توقيت دمشق UTC+3)
const SYRIA_MS = 3 * 3600e3;
const mm = new Map<string, { net: number; n: number }>();
for (const t of r.trades) {
  const k = new Date(t.entryT + SYRIA_MS).toISOString().slice(0, 7);
  const a = mm.get(k) ?? { net: 0, n: 0 };
  a.net += t.pnl; a.n++;
  mm.set(k, a);
}
const monthly = [...mm.entries()].sort((x, y) => x[0] < y[0] ? -1 : 1).map(([month, a]) => ({ month, net: Math.round(a.net * 100) / 100, trades: a.n }));

// توزيع مدد الاحتفاظ
const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
const holdBuckets = [
  { label: '<6h', n: holds.filter(h => h < 6).length },
  { label: '6-24h', n: holds.filter(h => h >= 6 && h < 24).length },
  { label: '24-48h', n: holds.filter(h => h >= 24 && h < 48).length },
  { label: '48-72h', n: holds.filter(h => h >= 48 && h <= 72).length },
];

const byStrat = new Map<string, { n: number; net: number }>();
for (const t of r.trades) {
  const a = byStrat.get(t.strategy) ?? { n: 0, net: 0 };
  a.n++; a.net += t.pnl;
  byStrat.set(t.strategy, a);
}

const out = {
  stats: {
    totalTrades: st.totalTrades, winRate: st.winRate, netPnl: st.netPnl,
    profitFactor: st.profitFactor, maxDrawdownPct: st.maxDrawdownPct, maxDrawdown: st.maxDrawdown,
    oos: st.oos, dailyKpi: st.dailyKpi, fuseTrips: st.fuseTrips, adaptiveGates: st.adaptiveGates,
  },
  hold: {
    capHours: 72, maxHours: Math.round(Math.max(...holds) * 10) / 10,
    timeExits: r.trades.filter(t => t.result === 'time').length,
    overCap: holds.filter(h => h > 72.1).length,
    avgHours: Math.round(holds.reduce((s, h) => s + h, 0) / holds.length * 10) / 10,
    buckets: holdBuckets,
  },
  monthly, eqSparse,
  byStrat: [...byStrat.entries()].map(([strategy, a]) => ({ strategy, n: a.n, net: Math.round(a.net * 100) / 100 })).sort((x, y) => y.net - x.net),
  lotCheck: { boostedFills: st.adaptiveGates?.boostedFills ?? 0, lots: [...new Set(r.trades.map(t => t.lot))] },
};
await Bun.write('/tmp/report_final.json', JSON.stringify(out));
console.log('saved /tmp/report_final.json');
console.log(`trades=${st.totalTrades} net=${st.netPnl.toFixed(2)} PF=${st.profitFactor.toFixed(3)} DD=${st.maxDrawdownPct.toFixed(2)}%`);
console.log('lots used:', JSON.stringify(out.lotCheck.lots), '| boosted:', out.lotCheck.boostedFills);
console.log('max hold:', out.hold.maxHours, 'h | time exits:', out.hold.timeExits, '| over cap:', out.hold.overCap);
