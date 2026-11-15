// ============================================================
// اختبار قوة البوت: استيعاب استراتيجيتين جديدتين تماماً (P و Q)
// التشغيل على شموع MT5 الحقيقية — سنة 2025 — بنفس محرك الباك تيست الرسمي
// وكامل الحوكمة (الجلسات، السلم، بوابة الجودة، حدود الوقف، الأخبار).
//   A) خط الأساس: E فقط (الوضع المعتمد للمالك)
//   B) التكامل الكامل: E + P + Q (كما سيعمل البوت فعلياً)
//   C) قياس معزول تشخيصي: P + Q فقط (تعطيل E هنا للقياس فقط —
//      الدستور يمنع هذا من الواجهات، وهو تعطيل مؤقت داخل السكربت)
// ============================================================
import { DEFAULT_SETTINGS } from '../src/lib/engine/rules';
import { enforceFrozenSettings } from '../src/lib/engine/constitution';
import { runBacktestCached } from '../src/lib/server/backtestCache';
import type { Settings } from '../src/lib/engine/rules';
import { STRATEGY_NAMES, StrategyId } from '../src/lib/engine/types';

/** بناء إعدادات سيناريو: تفعيل/تعطيل الجديدتين فقط — كل البقية كما هي */
const mk = (p: boolean, q: boolean): Settings => {
  const s = enforceFrozenSettings(structuredClone(DEFAULT_SETTINGS)) as unknown as Settings;
  s.sessions.P = { asia: false, london: p, londonNY: p, ny: p };
  s.sessions.Q = { asia: q, london: q, londonNY: q, ny: q };
  return s;
};

/** تجميع مصفوفة استراتيجية×جلسة إلى إجمالي لكل استراتيجية */
function perStrategy(matrix: Record<string, Record<string, { net: number; wins: number; losses: number; trades: number; winRate: number }>>) {
  const agg = new Map<string, { trades: number; wins: number; losses: number; net: number }>();
  for (const [s, sess] of Object.entries(matrix ?? {})) {
    for (const v of Object.values(sess)) {
      const cur = agg.get(s) ?? { trades: 0, wins: 0, losses: 0, net: 0 };
      cur.trades += v.trades; cur.wins += v.wins; cur.losses += v.losses; cur.net += v.net;
      agg.set(s, cur);
    }
  }
  return [...agg.entries()].sort((a, b) => b[1].net - a[1].net);
}

function report(tag: string, r: ReturnType<typeof runBacktestCached>) {
  console.log(`\n========== ${tag} ==========`);
  if (!r.ok) { console.log('فشل:', r.reason); return; }
  const st = r.stats;
  console.log(`الإجمالي: صفقات=${st.totalTrades} | إشارات=${st.signalsCount} | ربحية=${(st.winRate * 100).toFixed(1)}% | صافي=${st.netPnl.toFixed(2)}$ | PF=${st.profitFactor.toFixed(2)} | أقصى تراجع=${(st.maxDrawdownPct * 100).toFixed(1)}% | رصيد نهائي=${st.finalBalance.toFixed(2)}$ | زمن=${r.ms}ms`);
  if (r.period) console.log(`الفترة: ${r.period.from.slice(0, 10)} → ${r.period.to.slice(0, 10)}${r.cov5m ? ` (شموع 5م الحقيقية: ${r.cov5m.from.slice(0, 10)} → ${r.cov5m.to.slice(0, 10)})` : ''}`);
  console.log('--- الأداء لكل استراتيجية (مجمّع على الجلسات) ---');
  for (const [k, v] of perStrategy(st.matrix)) {
    const name = STRATEGY_NAMES[k as StrategyId] ?? k;
    console.log(`  ${k} — ${name}: صفقات=${v.trades} | ربح=${v.wins} | خسارة=${v.losses} | نسبة=${v.trades ? ((v.wins / v.trades) * 100).toFixed(0) : '—'}% | صافي=${v.net.toFixed(2)}$`);
  }
  // عينات من الصفقات الجديدة — إثبات أن البوت فهم منطق الاستراتيجية ونفذه
  for (const s of ['P', 'Q'] as const) {
    const tr = (r.trades ?? []).filter(t => t.strategy === s);
    if (!tr.length) continue;
    console.log(`--- عينات صفقات ${s} (${tr.length} صفقة) ---`);
    for (const t of tr.slice(0, 3)) {
      console.log(`  ${new Date(t.entryT).toISOString().slice(0, 16).replace('T', ' ')} | ${t.dir === 'buy' ? 'شراء' : 'بيع'} | ${t.result} | ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}$ | ${t.reason.slice(0, 100)}`);
    }
  }
  if (st.blocked && Object.keys(st.blocked).length) {
    const top = Object.entries(st.blocked).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log('--- أعلى أسباب الحجب ---', top.map(([k, v]) => `${k}=${v}`).join('، '));
  }
}

console.log('=== اختبار استيعاب الاستراتيجيات الجديدة — شموع XAUUSD الحقيقية من MT5 ===');

// A) خط الأساس — الوضع الحالي E فقط
report('A) خط الأساس: E فقط (الوضع المعتمد)', runBacktestCached(2025, mk(false, false), []));

// B) التكامل الكامل — كما سيعمل البوت فعلياً بعد إعطائه الجديدتين
report('B) التكامل الكامل: E + P + Q (بحوكمة كاملة)', runBacktestCached(2025, mk(true, true), []));

// C) قياس معزول تشخيصي — الجديدتان وحدهما (تعطيل E داخل السكربت فقط للقياس)
const iso = mk(true, true);
iso.sessions.E = { asia: false, london: false, londonNY: false, ny: false };
report('C) قياس معزول: P + Q فقط (تشخيصي)', runBacktestCached(2025, iso, []));

console.log('\n=== انتهى الاختبار ===');
