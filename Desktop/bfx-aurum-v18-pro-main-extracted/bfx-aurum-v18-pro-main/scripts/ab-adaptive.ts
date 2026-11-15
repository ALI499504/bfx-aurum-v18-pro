// ============================================================
// اختبار A/B نقي: الإعدادات الحية الحالية ± البوابات التكيفية (31/32/33)
// — نفس العملية، نفس لقطة البيانات، نفس إعدادات الأساس (I معطلة بقرار
//   المدير الذاتي + قتل الجلسات الأربعة) — العزل الكامل لأثر القواعد الجديدة
// التشغيل: bun scripts/ab-adaptive.ts
// ============================================================
import { runBacktestCached } from '../src/lib/server/backtestCache';
import { loadBotSettings, loadRealNews } from '../src/lib/server/backtestRunner';
import type { Settings } from '../src/lib/engine/rules';

const base = await loadBotSettings();
const realNews = await loadRealNews();

const clone = (s: Settings): Settings => JSON.parse(JSON.stringify(s)) as Settings;

// أ) الضابط: كل شيء كما هو، القواعد 31/32/33 معطلة
const control = clone(base);
for (const k of ['gate_side_pf', 'gate_decay90', 'sizing_quality'] as const) {
  (control.globalRules as Record<string, { enabled: boolean }>)[k] = { enabled: false };
}

// ب) المعالجة: الإعدادات الحية كما هي (القواعد الثلاث مفعلة من قاعدة البيانات)
const t0 = Date.now();
const rc = runBacktestCached(null, control, realNews);
if (!rc.ok) { console.error('control FAILED:', rc.reason); process.exit(1); }
const rt = runBacktestCached(null, base, realNews);
if (!rt.ok) { console.error('treatment FAILED:', rt.reason); process.exit(1); }
const ms = Date.now() - t0;

const line = (name: string, s: typeof rc.stats) => {
  const oos = s.oos;
  return `${name.padEnd(10)} | ${String(s.totalTrades).padStart(5)} صفقة | صافي ${s.netPnl.toFixed(2).padStart(10)}$ | PF ${s.profitFactor.toFixed(3)} | نجاح ${s.winRate.toFixed(1)}% | DD ${s.maxDrawdownPct.toFixed(2)}% | رصيد ${s.finalBalance.toFixed(0)}$ | OOS ${oos.trades} (${oos.winRate.toFixed(1)}%)`;
};

console.log(`[ab] رُصد في ${ms}ms — نفس اللقطة، نفس العملية`);
console.log(line('ضابط (بلا 31/32/33)', rc.stats));
console.log(line('معالجة (بالقواعد)', rt.stats));

// تفصيل أثر القواعد لكل استراتيجية
const agg = (trades: { strategy: string; pnl: number }[]) => {
  const m = new Map<string, { n: number; net: number }>();
  for (const t of trades) {
    const a = m.get(t.strategy) ?? { n: 0, net: 0 };
    a.n++; a.net += t.pnl;
    m.set(t.strategy, a);
  }
  return m;
};
const mc = agg(rc.trades as { strategy: string; pnl: number }[]);
const mt = agg(rt.trades as { strategy: string; pnl: number }[]);
console.log('\nالفرق لكل استراتيجية (معالجة − ضابط):');
const keys = [...new Set([...mc.keys(), ...mt.keys()])];
const diffs = keys.map(k => {
  const c = mc.get(k) ?? { n: 0, net: 0 };
  const t = mt.get(k) ?? { n: 0, net: 0 };
  return { k, dn: t.n - c.n, dnet: t.net - c.net };
}).sort((a, b) => b.dnet - a.dnet);
for (const d of diffs) {
  if (Math.abs(d.dnet) < 0.5 && d.dn === 0) continue;
  console.log(`  ${d.k.padEnd(4)} | الصفقات ${d.dn >= 0 ? '+' : ''}${d.dn} | الصافي ${d.dnet >= 0 ? '+' : ''}${d.dnet.toFixed(2)}$`);
}

// شفافية القواعد في المعالجة
const ag = rt.stats.adaptiveGates;
if (ag) {
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k}:${v}`).join('، ') || '—';
  console.log(`\n[قاعدة 31] محجوب اتجاهياً: ${fmt(ag.sideGuard)}`);
  console.log(`[قاعدة 32] محجوب انحساراً: ${fmt(ag.decayGuard)}`);
  console.log(`[قاعدة 33] صفقات اللوت المحسّن: ${ag.boostedFills} (${fmt(ag.boostedByStrat)})`);
}

await Bun.write('/tmp/ab_adaptive.json', JSON.stringify({
  control: { stats: rc.stats },
  treatment: { stats: rt.stats },
}));
console.log('\n[ab] saved /tmp/ab_adaptive.json');
