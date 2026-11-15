// ============================================================
// اختبار سيناريوهات بقية إصلاحات خطة التحويل (تقرير التشريح PDF)
//   S0: الأساس — الإعدادات المنشورة الحالية (بعد بوابات 26–30)
//   S1: S0 + إعادة تفعيل I (رابح التقرير #4 عطّله المدير الآلي بنافذة 90 يوماً)
//   S2: S1 + إعادة تفعيل U (المعطلة — التقرير يوصي بالمراقبة لا التعطيل)
//   S3: S1 + تخفيف عتبات الصامتين D/Q (التجربة الظلية — الفصل الخامس)
// لكل سيناريو: الصافي، PF، النجاح، أقصى DD + تفصيل I/U/D/Q + نافذة 90 يوماً
// التشغيل: bun scripts/pdf_fixes_ab.ts
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();
console.log('[ab] settings loaded');

const clone = (): Settings => structuredClone(base) as Settings;

const setEnabled = (s: Settings, code: string, on: boolean) => {
  const node = (s.strategyParams as Record<string, { enabled?: boolean } | undefined> | undefined)?.[code];
  if (node) node.enabled = on;
};

// تخفيف عتبات الصامتين D وQ (التجربة الظلية — قليلاً كما حدد التقرير)
const loosenSilents = (s: Settings) => {
  const sp = s.strategyParams as Record<string, Record<string, number>>;
  sp.D.gapMinPips = 8;      // من 12 — قبول فجوات أصغر قليلاً
  sp.D.bodyBreakMin = 40;   // من 50
  sp.D.totalMin = 80;       // من 100
  sp.Q.wickMinPips = 60;    // من 80
  sp.Q.asiaOpenMinPips = 150; // من 200
  sp.Q.isolationPips = 100;   // من 120
};

const scenarios: { key: string; label: string; build: () => Settings }[] = [
  { key: 'S0', label: 'الأساس المنشور', build: () => clone() },
  { key: 'S1', label: '+ إعادة تفعيل I', build: () => { const s = clone(); setEnabled(s, 'I', true); return s; } },
  { key: 'S2', label: '+ إعادة تفعيل I وU', build: () => { const s = clone(); setEnabled(s, 'I', true); setEnabled(s, 'U', true); return s; } },
  { key: 'S3', label: '+ I + تخفيف D/Q (ظل)', build: () => { const s = clone(); setEnabled(s, 'I', true); loosenSilents(s); return s; } },
];

interface Agg { n: number; net: number; wins: number; gw: number; gl: number }
const aggOf = (trades: { strategy: string; pnl: number; entryT?: number }[], fromT = 0) => {
  const m = new Map<string, Agg>();
  for (const t of trades) {
    if (fromT && (t.entryT ?? 0) < fromT) continue;
    const a = m.get(t.strategy) ?? { n: 0, net: 0, wins: 0, gw: 0, gl: 0 };
    a.n++; a.net += t.pnl;
    if (t.pnl > 0) { a.wins++; a.gw += t.pnl; } else if (t.pnl < 0) a.gl += -t.pnl;
    m.set(t.strategy, a);
  }
  return m;
};
const pfOf = (a?: Agg) => (a && a.gl > 0 ? a.gw / a.gl : a && a.gw > 0 ? 99 : 0);
const f = (n: number, d = 2) => n.toFixed(d);

const results: { key: string; label: string; stats: Awaited<ReturnType<typeof run>> ; agg: Map<string, Agg>; win90: Map<string, Agg> }[] = [];

async function run(s: Settings) {
  const r = runBacktestCached(null, s, realNews);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

const WINDOW90 = 90 * 86400e3;
for (const sc of scenarios) {
  const t0 = Date.now();
  const r = await run(sc.build());
  const agg = aggOf(r.trades as { strategy: string; pnl: number; entryT?: number }[]);
  const lastT = Math.max(...(r.trades as { entryT?: number }[]).map(t => t.entryT ?? 0));
  const win90 = aggOf(r.trades as { strategy: string; pnl: number; entryT?: number }[], lastT - WINDOW90);
  results.push({ key: sc.key, label: sc.label, stats: r.stats, agg, win90 });
  console.log(`[${sc.key}] ${sc.label}: ${r.stats.totalTrades} صفقة — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log('\n=== المقارنة الإجمالية ===');
console.log(['السيناريو', 'صفقات', 'صافي$', 'PF', 'نجاح%', 'DD%'].join(' | '));
for (const x of results) {
  console.log([`${x.key} ${x.label}`, x.stats.totalTrades, f(x.stats.netPnl), f(x.stats.profitFactor, 3), f(x.stats.winRate, 1), f(x.stats.maxDrawdownPct, 1)].join(' | '));
}

console.log('\n=== تفصيل I / U / D / Q في كل سيناريو (نافذة كاملة) ===');
for (const code of ['I', 'U', 'D', 'Q']) {
  const line = results.map(x => {
    const a = x.agg.get(code);
    return a ? `${a.n}pg ${f(a.net)}$ PF${f(pfOf(a))}` : '0pg';
  });
  console.log(`${code}: ${results.map((x, i) => `${x.key}=${line[i]}`).join(' | ')}`);
}

console.log('\n=== نافذة 90 يوماً الأخيرة (عدسة المدير الآلي) — S1 ===');
const s1 = results.find(x => x.key === 'S1')!;
for (const code of ['I', 'U']) {
  const a = s1.win90.get(code);
  console.log(`${code}: ${a ? `${a.n} صفقة، صافي ${f(a.net)}$، PF ${f(pfOf(a))}` : 'لا صفقات في النافذة'}`);
}

await Bun.write('/tmp/pdf_ab_results.json', JSON.stringify(results.map(x => ({
  key: x.key, label: x.label,
  trades: x.stats.totalTrades, net: x.stats.netPnl, pf: x.stats.profitFactor,
  wr: x.stats.winRate, dd: x.stats.maxDrawdownPct,
  perStrategy: [...x.agg.entries()].map(([c, a]) => ({ c, n: a.n, net: Math.round(a.net * 100) / 100, pf: Math.round(pfOf(a) * 100) / 100 })),
})), null, 1));
console.log('\n[ab] saved /tmp/pdf_ab_results.json');
