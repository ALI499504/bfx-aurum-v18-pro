// ============================================================
// باك تيست مقارن — قرار المالك 2026-11-12:
//   1) إلغاء التأمين (القاعدة 20 — بروتوكول تأمين الأرباح)
//   2) سقف مسافة وقف الخسارة 15$ كحد أقصى (القاعدة 12)
// السيناريوهات:
//   base  : الإعدادات المحفوظة الحالية (تأمين مفعّل، بلا سقف) — خط الأساس
//   nobe  : إلغاء التأمين فقط
//   cap   : سقف الستوب 15$ فقط (بقاء التأمين)
//   full  : إلغاء التأمين + سقف الستوب 15$ (الإعدادات النهائية المعتمدة)
// الناتج: /tmp/bt_variants.json
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const settings0 = await loadBotSettings();
const realNews = await loadRealNews();
console.log(`[variants] settings loaded | news=${realNews.length}`);

function variant(mode: 'base' | 'nobe' | 'cap' | 'full'): Settings {
  const s = structuredClone(settings0);
  const gr = s.globalRules as Record<string, { enabled: boolean; value?: number }>;
  if (mode === 'nobe' || mode === 'full') {
    gr.break_even = { enabled: false, value: 50 };
    gr.be_case1 = { enabled: false, value: 50 };
    gr.be_case2 = { enabled: false, value: 100 };
    gr.be_lock_pips = { enabled: false, value: 50 };
  }
  if (mode === 'cap' || mode === 'full') {
    gr.mandatory_sl = { enabled: true, value: 15 };
  }
  return s;
}

interface Overall { trades: number; wr: number; net: number; pf: number; dd: number }
interface StratRow { strategy: string; trades: number; net: number; wr: number; pf: number }
interface VariantOut {
  mode: string; overall: Overall; byStrategy: StratRow[];
  sl: { max: number; p95: number; mean: number; over15: number; capped: number };
  hold: { capHours: number; maxHours: number; timeExits: number; overCap: number };
  results: Record<string, number>;
  ms: number;
}

function summarize(mode: string, r: NonNullable<ReturnType<typeof runBacktestCached> & { ok: true }>, ms: number): VariantOut {
  const st = r.stats;
  const trades = r.trades;
  // إحصاءات مسافة الوقف (بالدولار — 0.01 لوت: 1$ حركة = 1$ مخاطرة)
  const dists = trades.map(t => Math.abs(t.entry - t.sl)).sort((a, b) => a - b);
  const max = dists.length ? dists[dists.length - 1] : 0;
  const p95 = dists.length ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.95))] : 0;
  const mean = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  const over15 = dists.filter(d => d > 15.001).length;
  // توزيع نتائج الخروج
  const results: Record<string, number> = {};
  for (const t of trades) results[t.result] = (results[t.result] ?? 0) + 1;
  // جدول الاستراتيجيات
  const agg = new Map<string, { n: number; net: number; wins: number; gw: number; gl: number }>();
  for (const t of trades) {
    const s = String(t.strategy);
    const a = agg.get(s) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
    a.n++; a.net += t.pnl;
    if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
    agg.set(s, a);
  }
  const byStrategy: StratRow[] = [...agg.entries()]
    .map(([strategy, a]) => ({ strategy, trades: a.n, net: Math.round(a.net * 100) / 100, wr: a.n ? Math.round((a.wins / a.n) * 1000) / 10 : 0, pf: a.gl > 0 ? Math.round((a.gw / a.gl) * 100) / 100 : (a.gw > 0 ? 99 : 0) }))
    .sort((x, y) => y.net - x.net);
  // السقف الزمني (القاعدة 4)
  const r4 = (structuredClone(settings0).globalRules as Record<string, { enabled: boolean; value?: number }>).max_hold_hours;
  const capH = r4?.enabled ? (r4.value ?? 48) : 0;
  const holds = trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const maxHoldH = holds.length ? Math.max(...holds) : 0;
  const overCap = capH > 0 ? holds.filter(h => h > capH + 0.1).length : 0;
  return {
    mode, ms,
    overall: { trades: st.totalTrades, wr: st.winRate ?? 0, net: st.netPnl ?? 0, pf: st.profitFactor ?? 0, dd: st.maxDrawdownPct ?? 0 },
    byStrategy,
    sl: { max: Math.round(max * 100) / 100, p95: Math.round(p95 * 100) / 100, mean: Math.round(mean * 100) / 100, over15, capped: 0 },
    hold: { capHours: capH, maxHours: Math.round(maxHoldH * 10) / 10, timeExits: trades.filter(t => t.result === 'time').length, overCap },
    results,
  };
}

const out: Record<string, VariantOut> = {};
for (const mode of ['base', 'nobe', 'cap', 'full'] as const) {
  const t0 = Date.now();
  const r = runBacktestCached(null, variant(mode), realNews);
  if (!r.ok) { console.error(`[${mode}] FAILED: ${r.reason}`); process.exit(1); }
  out[mode] = summarize(mode, r, Date.now() - t0);
  const v = out[mode];
  console.log(`\n=== ${mode.toUpperCase()} | ${v.ms}ms ===`);
  console.log(`trades=${v.overall.trades} wr=${v.overall.wr.toFixed(1)}% net=${v.overall.net.toFixed(2)}$ PF=${v.overall.pf.toFixed(3)} DD=${v.overall.dd.toFixed(2)}%`);
  console.log(`SL: max=${v.sl.max}$ p95=${v.sl.p95}$ mean=${v.sl.mean}$ فوق-15$=${v.sl.over15} | خروج زمني=${v.hold.timeExits} أطول=${v.hold.maxHours}h فوق-سقف=${v.hold.overCap}`);
  console.log(`نتائج الخروج: ${Object.entries(v.results).map(([k, x]) => `${k}:${x}`).join(' | ')}`);
}

// مقارنة الاستراتيجية-باستراتيجية بين الأساس والنهائي
console.log('\n=== مقارنة لكل استراتيجية: base ←→ full ===');
console.log('code | base: n/net/pf | full: n/net/pf | دلتا-صافي');
const bMap = new Map(out.base.byStrategy.map(r => [r.strategy, r]));
const fMap = new Map(out.full.byStrategy.map(r => [r.strategy, r]));
const all = [...new Set([...bMap.keys(), ...fMap.keys()])];
const deltas: { s: string; d: number }[] = [];
for (const s of all) {
  const b = bMap.get(s), f = fMap.get(s);
  const bn = b ? `${b.trades}/${b.net >= 0 ? '+' : ''}${b.net.toFixed(0)}/${b.pf.toFixed(2)}` : '0/0/—';
  const fn = f ? `${f.trades}/${f.net >= 0 ? '+' : ''}${f.net.toFixed(0)}/${f.pf.toFixed(2)}` : '0/0/—';
  const d = (f?.net ?? 0) - (b?.net ?? 0);
  deltas.push({ s, d });
  console.log(`${s.padEnd(4)} | ${bn.padStart(18)} | ${fn.padStart(18)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}$`);
}
deltas.sort((a, b) => b.d - a.d);
console.log(`\nأكبر تحسّن: ${deltas.slice(0, 3).map(x => `${x.s} +${x.d.toFixed(0)}$`).join('، ')} | أكبر تراجع: ${deltas.slice(-3).reverse().map(x => `${x.s} ${x.d.toFixed(0)}$`).join('، ')}`);

await Bun.write('/tmp/bt_variants.json', JSON.stringify(out, null, 1));
console.log('\n[variants] saved /tmp/bt_variants.json');
