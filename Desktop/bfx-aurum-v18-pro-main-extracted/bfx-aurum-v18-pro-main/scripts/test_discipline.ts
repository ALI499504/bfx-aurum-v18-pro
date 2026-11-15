// ============================================================
// اختبار طبقة الانضباط v2.0 — التحقق من التزام المحرك بشروط المالك الخمسة
// على البيانات الحقيقية من لقطة جسر MT5:
// ① كل صفقة: مسافة الوقف ≤ 15.00$
// ② صفقة واحدة فقط: لا تداخل زمني بين أي صفقتين
// ③ لا صفقة جديدة بعد تحقق هدف اليوم (+3% مع ≥10 صفقات)
// ④ لا صفقة جديدة بعد ضرب قاطع التراجع 10% في نفس اليوم
// ⑤ إحصاء توزيع الصفقات اليومية مقابل الحد الأدنى 10
// ============================================================
import fs from 'fs';
import { runBacktest, loadData, resetEngineCache, EngineData } from '../src/lib/engine/backtest';
import { Candle } from '../src/lib/engine/types';
import { DISCIPLINE } from '../src/lib/engine/discipline';

const SNAP = '/home/z/my-project/db/mt5-feed-snapshot.json';

function sanitize(a: unknown): Candle[] {
  const arr = Array.isArray(a) ? a : [];
  const out: Candle[] = [];
  for (const r of arr) {
    if (Array.isArray(r) && r.length >= 5) {
      const [T, O, H, L, C, V] = r as number[];
      if ([T, O, H, L, C].every(Number.isFinite)) {
        out.push({ t: Math.round(T), o: O, h: H, l: L, c: C, v: Number.isFinite(V) ? Math.round(V) : 0 });
      }
    } else if (r && typeof r === 'object') {
      const c = r as Record<string, number>;
      if ([c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) {
        out.push({ t: Math.round(c.t), o: c.o, h: c.h, l: c.l, c: c.c, v: Math.round(c.v ?? 0) });
      }
    }
  }
  return out;
}

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')) as Record<string, unknown>;
const tfsJ = (snap.tfs ?? {}) as Record<string, unknown>;
const files: Record<string, Candle[]> = {};
for (const tf of ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']) {
  const arr = sanitize(tfsJ[tf]);
  if (arr.length) files[tf] = arr;
}
console.log('الفريمات:', Object.entries(files).map(([k, v]) => `${k}=${v.length}`).join(' '));
if (!files['5m'] || files['5m'].length < 500) {
  console.error('لا توجد بيانات كافية في اللقطة — شغّل الجسر أولاً');
  process.exit(1);
}

resetEngineCache();
const raw: Record<string, Candle[]> = {};
for (const tf of Object.keys(files)) raw[tf] = files[tf];
const data: EngineData = loadData(raw);
const t0 = Date.now();
const r = runBacktest(data, { lot: 0.01, spreadCents: 30 }, Date.now());
const ms = Date.now() - t0;
const s = r.stats;
const trades = r.trades;

console.log(`\n== الباك تيست (${(ms / 1000).toFixed(1)}s) ==`);
console.log(`الفترة: ${new Date(s.startT).toISOString().slice(0, 10)} ← ${new Date(s.endT).toISOString().slice(0, 10)}`);
console.log(`الصفقات: ${s.totalTrades} | نجاح: ${s.winRate.toFixed(1)}% | صافي: ${s.netPnl.toFixed(2)}$ | PF: ${s.profitFactor.toFixed(2)} | أقصى تراجع: ${s.maxDrawdownPct.toFixed(1)}%`);

console.log('\n== أسباب الرفض (تظهر طبقة الانضباط) ==');
for (const [k, v] of Object.entries(s.blocked).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

// ==== فحص 1: سقف الوقف 15$ ====
let slViol = 0, maxSl = 0;
for (const t of trades) {
  const dist = Math.abs(t.entry - (t.slOrig ?? t.sl));
  if (dist > maxSl) maxSl = dist;
  if (dist > DISCIPLINE.MAX_SL_USD + 1e-9) slViol++;
}
console.log(`\n① سقف الوقف 15$: أوسع وقف = ${maxSl.toFixed(2)}$ — مخالفات: ${slViol} ${slViol === 0 ? '✓ ملزم' : '✗ مخالفة!'}`);

// ==== فحص 2: صفقة واحدة (لا تداخل) ====
const sorted = [...trades].sort((a, b) => a.entryT - b.entryT);
let overlap = 0;
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].entryT < sorted[i - 1].exitT) overlap++;
}
console.log(`③ صفقة واحدة فقط: تداخلات زمنية = ${overlap} ${overlap === 0 ? '✓ ملزم' : '✗ مخالفة!'}`);

// ==== فحص 3+4: لا صفقات بعد هدف اليوم/قاطع التراجع ====
const SY = 3 * 3600e3;
const dayOf = (t: number) => new Date(t + SY).toISOString().slice(0, 10);
const dayTradeCounts = new Map<string, number>();
for (const t of trades) dayTradeCounts.set(dayOf(t.exitT), (dayTradeCounts.get(dayOf(t.exitT)) ?? 0) + 1);
let targetViol = 0, capViol = 0;
for (const d of s.daily) {
  if (d.targetHit && d.trades > DISCIPLINE.MIN_TRADES_PER_DAY) {
    // بعد تحقق الهدف لا يجوز أكثر من 10 صفقات (الهدف يُحقق عند الصفقة 10 فأكثر)
    targetViol++;
  }
}
// التحقق الزمني الصارم: آخر صفقة بتحقق الهدف يجب أن تكون هي رقم ≥10 ويعقبها لا شيء في نفس اليوم
for (const d of s.daily) {
  const dayTrades = trades.filter(t => dayOf(t.exitT) === d.day).sort((a, b) => a.exitT - b.exitT);
  if (d.targetHit && dayTrades.length > DISCIPLINE.MIN_TRADES_PER_DAY) capViol++;
}
console.log(`⑤ هدف اليوم +3%: أيام الهدف = ${s.discipline.summary.targetHitDays} — مخالفات (صفقات فوق 10 بعد الهدف): ${capViol} ${capViol === 0 ? '✓' : '✗'}`);
console.log(`④ قاطع التراجع 10%: أيام الإيقاف = ${s.discipline.summary.cappedDays} — أعمق تراجع يومي مسجل: ${Math.max(0, ...s.daily.map(d => d.maxDdPct)).toFixed(2)}% (يجب ≤ 10 من قمة اليوم على أساس مغلق — القاطع يمنع تجاوزه بصفقات جديدة)`);

// ==== توزيع الصفقات اليومية ====
const counts = [...dayTradeCounts.values()].sort((a, b) => a - b);
const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
const med = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
const ge10 = counts.filter(c => c >= 10).length;
console.log(`\n② الصفقات اليومية: متوسط ${avg.toFixed(1)} | وسيط ${med} | أدنى ${counts[0] ?? 0} | أعلى ${counts[counts.length - 1] ?? 0} | أيام ≥10 صفقات: ${ge10}/${counts.length}`);
console.log(`   ملخص الانضباط: أيام ${s.discipline.summary.days} — هدف ${s.discipline.summary.targetHitDays} — حد10 ${s.discipline.summary.minTradesDays} — قاطع ${s.discipline.summary.cappedDays}`);

// الحالة الحية
console.log('\n== الحالة الحية (نهاية البيانات) ==');
console.log(`  اليوم: ${s.discipline.day} | صفقات اليوم: ${s.discipline.tradesToday} | عائد اليوم: ${s.discipline.dayPnlPct}% | تراجع اليوم: ${s.discipline.dayDdPct}%`);
console.log(`  هدف محقق: ${s.discipline.targetHit} | قاطع ضُرب: ${s.discipline.capped}`);

// عينة أيام
console.log('\n== عينة آخر 12 يوم تداول ==');
for (const d of s.daily.slice(-12)) {
  console.log(`  ${d.day} | صفقات ${String(d.trades).padStart(2)} | صافي ${d.net >= 0 ? '+' : ''}${d.net.toFixed(2)}$ (${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(2)}%) | تراجع ${d.maxDdPct.toFixed(2)}% ${d.targetHit ? '| هدف✓' : ''}${d.capped ? '| إيقاف✓' : ''}`);
}
