// ============================================================
// تجربة A/B نهائية — عزل أثر كل مكوّن من المكوّنات المعتمدة:
//   A) خط الأساس: Time Stop معطل + البوابات 31/32/33 معطلة
//   B) Time Stop فقط (48 ساعة)
//   C) الحلول 1+2+3 فقط (عزل الاتجاه الميت + بوابة الانحسار + تحجيم الجودة)
//   D) الكل معاً (الإعدادات الحية المعتمدة)
// الهدف: معرفة من رفع الربح ومن رفع الـDD.
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();

const clone = (s: Settings): Settings => structuredClone(s) as Settings;

// تعطيل كل المكوّنات الجديدة (خط الأساس)
function baseline(s: Settings): Settings {
  const o = clone(s);
  o.globalRules.max_hold_hours = { enabled: false, value: 48 };
  o.globalRules.gate_side_pf = { enabled: false, value: 90 };
  o.globalRules.gate_decay90 = { enabled: false, value: 100 };
  o.globalRules.sizing_quality = { enabled: false, value: 2 };
  return o;
}
// Time Stop فقط
function timestopOnly(s: Settings): Settings {
  const o = baseline(s);
  o.globalRules.max_hold_hours = { enabled: true, value: 48 };
  return o;
}
// الحلول 1+2+3 فقط (بلا Time Stop)
function gatesOnly(s: Settings): Settings {
  const o = baseline(s);
  o.globalRules.gate_side_pf = { enabled: true, value: 90 };
  o.globalRules.gate_decay90 = { enabled: true, value: 100 };
  o.globalRules.sizing_quality = { enabled: true, value: 2 };
  return o;
}

const cases: { name: string; s: Settings }[] = [
  { name: 'A) خط الأساس (بلا كل جديد)', s: baseline(base) },
  { name: 'B) Time Stop 48 ساعة فقط', s: timestopOnly(base) },
  { name: 'C) الحلول 1+2+3 فقط', s: gatesOnly(base) },
  { name: 'D) الكل معاً (المعتمد)', s: base },
];

interface Row { n: number; net: number; pf: number; dd: number; wr: number; timeExits: number; maxHoldH: number; overCap: number; boosted: number; sideBlocked: number; decayBlocked: number; eq: number; lo: number; }
const rows: Record<string, Row> = {};

for (const c of cases) {
  const t0 = Date.now();
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) { console.error(`${c.name}: FAILED ${r.reason}`); process.exit(1); }
  const st = r.stats;
  const holds = r.trades.map(t => (t.exitT - t.entryT) / 3600e3);
  const capH = c.s.globalRules.max_hold_hours?.enabled ? (c.s.globalRules.max_hold_hours.value ?? 48) : 0;
  const ag = st.adaptiveGates;
  rows[c.name] = {
    n: st.totalTrades, net: st.netPnl ?? 0, pf: st.profitFactor ?? 0, dd: st.maxDrawdownPct ?? 0, wr: st.winRate ?? 0,
    timeExits: r.trades.filter(t => t.result === 'time').length,
    maxHoldH: holds.length ? Math.max(...holds) : 0,
    overCap: capH > 0 ? holds.filter(h => h > capH + 0.1).length : -1,
    boosted: ag?.boostedFills ?? 0,
    sideBlocked: Object.values(ag?.sideGuard ?? {}).reduce((a, b) => a + b, 0),
    decayBlocked: Object.values(ag?.decayGuard ?? {}).reduce((a, b) => a + b, 0),
    eq: st.equityCurve?.length ?? 0,
    lo: 0,
  };
  console.log(`${c.name.padEnd(34)} | ${String(rows[c.name].n).padStart(5)} صفقة | net ${rows[c.name].net.toFixed(2).padStart(10)}$ | PF ${rows[c.name].pf.toFixed(3)} | DD ${rows[c.name].dd.toFixed(2)}% | wr ${rows[c.name].wr.toFixed(1)}% | زمني ${rows[c.name].timeExits} | أطول ${rows[c.name].maxHoldH.toFixed(1)}س | فوق السقف ${rows[c.name].overCap} | مضاعف ${rows[c.name].boosted} | اتجاهي ${rows[c.name].sideBlocked} | انحسار ${rows[c.name].decayBlocked} | ${Date.now() - t0}ms`);
}

// منحنى الإيكويتي لكل حالة: نقطة القاع وقيمته — لتحليل موضع السحبة
console.log('\n--- موضع القاع (أعمق سحبة) ---');
for (const c of cases) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) continue;
  const eq = r.stats.equityCurve as { t: number; eq: number }[] | undefined;
  if (!eq?.length) { console.log(`${c.name}: لا منحنى`); continue; }
  let peak = eq[0].eq, worst = 0, worstT = 0, worstPeak = 0;
  for (const p of eq) {
    peak = Math.max(peak, p.eq);
    const dd = peak > 0 ? ((peak - p.eq) / peak) * 100 : 0;
    if (dd > worst) { worst = dd; worstT = p.t; worstPeak = peak; }
  }
  const d = new Date(worstT).toISOString().slice(0, 10);
  console.log(`${c.name.padEnd(34)} | القاع ${worst.toFixed(2)}% بتاريخ ${d} | القمة قبله ${worstPeak.toFixed(0)}$`);
}

// تفصيل شهري للحالة D مقابل A — أين تحسّن وأين تفاقم
console.log('\n--- شهري: A مقابل D ---');
const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
for (const c of [cases[0], cases[3]]) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) continue;
  const byM = new Map<string, { net: number; n: number }>();
  for (const t of r.trades) {
    const m = monthOf(t.entryT);
    const a = byM.get(m) ?? { net: 0, n: 0 };
    a.net += t.pnl; a.n++;
    byM.set(m, a);
  }
  const parts = [...byM.entries()].sort().map(([m, a]) => `${m.slice(2)}:${a.net.toFixed(0)}$/${a.n}`).join(' ');
  console.log(`${c.name}\n  ${parts}`);
}

await Bun.write('/tmp/ab_final.json', JSON.stringify(rows, null, 2));
console.log('\n[saved] /tmp/ab_final.json');
