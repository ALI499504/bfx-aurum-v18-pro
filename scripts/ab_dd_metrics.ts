// ============================================================
// التحليل النهائي الشامل — مقياسا DD:
//   1) مقياس المحرك (المستخدم في كل التقارير السابقة): سحبة مطلقة$/القاعدة 1000$
//   2) المقياس النسبي الحقيقي: السحبة ÷ قمة الإيكويتي (المخاطرة الفعلية)
// للحالات: A خط أساس | B زمني 48 فقط | C بوابات فقط | D48 الكل | E72 الكل+72
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
  { name: 'A) خط الأساس', s: variant(null, false) },
  { name: 'B) زمني 48 فقط', s: variant(48, false) },
  { name: 'C) بوابات 1+2+3 فقط', s: variant(null, true) },
  { name: 'D48) الكل + سقف 48', s: variant(48, true) },
  { name: 'E72) الكل + سقف 72', s: variant(72, true) },
];

const out: Record<string, unknown> = {};
console.log('الحالة                         | صفقات |   net$    | PF    | DD$    | DD%(مقياس المحرك) | DD%نسبي | تاريخ القاع النسبي');
for (const c of cases) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) { console.error(`${c.name}: FAILED`); process.exit(1); }
  const st = r.stats;
  const sorted = [...r.trades].sort((a, b) => a.exitT - b.exitT);
  // 1) مقياس المحرك: مطلق بالدولار من قمة الرصيد المُغلق
  let bal = 1000, peak = 1000, maxDDabs = 0, ddabsT = 0;
  // 2) نسبي من القمة
  let relWorst = 0, relT = 0;
  for (const t of sorted) {
    bal += t.pnl;
    peak = Math.max(peak, bal);
    const ddAbs = peak - bal;
    if (ddAbs > maxDDabs) { maxDDabs = ddAbs; ddabsT = t.exitT; }
    const ddRel = peak > 0 ? (ddAbs / peak) * 100 : 0;
    if (ddRel > relWorst) { relWorst = ddRel; relT = t.exitT; }
  }
  const engineDD = (maxDDabs / 1000) * 100;
  out[c.name] = { n: st.totalTrades, net: st.netPnl, pf: st.profitFactor, engineDD, maxDDabs, ddabsDate: new Date(ddabsT).toISOString().slice(0, 10), relWorst, relDate: new Date(relT).toISOString().slice(0, 10) };
  console.log(`${c.name.padEnd(30)} | ${String(st.totalTrades).padStart(5)} | ${st.netPnl.toFixed(2).padStart(9)} | ${st.profitFactor.toFixed(3)} | ${maxDDabs.toFixed(0).padStart(5)}$ | ${engineDD.toFixed(2).padStart(13)}% | ${relWorst.toFixed(2).padStart(7)}% | ${new Date(relT).toISOString().slice(0, 10)}`);
}

// شهري للحالتين المرشحتين A و D48 (صافي وعدد)
console.log('\n--- شهري مفصل: A | D48 ---');
for (const c of [cases[0], cases[3]]) {
  const r = runBacktestCached(null, c.s, realNews);
  if (!r.ok) continue;
  const byM = new Map<string, { net: number; n: number }>();
  for (const t of r.trades) {
    const m = new Date(t.entryT + 3 * 3600e3).toISOString().slice(0, 7);
    const a = byM.get(m) ?? { net: 0, n: 0 };
    a.net += t.pnl; a.n++;
    byM.set(m, a);
  }
  console.log(c.name);
  for (const [m, a] of [...byM.entries()].sort()) console.log(`  ${m}: ${a.net.toFixed(0).padStart(6)}$ / ${String(a.n).padStart(3)} صفقة`);
}

await Bun.write('/tmp/ab_final2.json', JSON.stringify(out, null, 2));
console.log('\n[saved] /tmp/ab_final2.json');
