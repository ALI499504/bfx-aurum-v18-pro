// فحص صحي شامل: كم إشارة تولّد كل استراتيجية A→R عبر كامل التاريخ الحقيقي
// قبل الفلاتر وبعد حل التعارضات — لإثبات عمل المحرك كاملاً وفق PDF
import fs from 'node:fs';
import path from 'node:path';
import { loadData, runBacktest, getCachedStructure } from '../src/lib/engine/backtest';
import { runAllDetectors, resetTamsaState, type DetectorsInput } from '../src/lib/engine/strategies';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/engine/rules';
import type { Candle, StrategyId } from '../src/lib/engine/types';

async function main() {
  // 1) شموع حقيقية من لقطة جسر MT5 على القرص (نفس مصدر الخادم حرفياً)
  const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
  const files: Record<string, Candle[]> = {};
  for (const [tf, arr] of Object.entries(snap.tfs)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    // اللقطة تخزّن الشمعة مصفوفة [t,o,h,l,c,v] — نحوّلها كما يفعل جسر التغذية
    files[tf] = (arr as unknown[][]).map(a => {
      const c = Array.isArray(a) ? a : (a as unknown as Record<string, number>);
      return Array.isArray(a)
        ? { t: Number(c[0]), o: Number(c[1]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]), v: Number(c[5] ?? 0) }
        : { t: Number(c.t), o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: Number(c.v ?? 0) };
    }).filter(c => Number.isFinite(c.t) && c.t > 0);
  }
  console.log('TFs في اللقطة:', Object.entries(files).map(([k, v]) => `${k}=${v.length}`).join(' · '));
  if (!files['5m']?.length) { console.error('لا شموع 5m'); return; }

  // 2) بناء بيانات المحرك + تسخين كامل عبر باك تيست فعلي (يملأ الكاش البنيوي)
  const data = loadData(files);
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const t0 = Date.now();
  const bt = runBacktest(data, settings, Date.now(), []);
  const btMs = Date.now() - t0;
  const { struct1h, struct4h, struct1d, cons } = getCachedStructure();
  console.log(`باك تيست فعلي: ${bt.trades.length} صفقة في ${btMs}ms · صافي ${bt.stats.netPnl.toFixed(2)}$ · WR ${bt.stats.winRate.toFixed(1)}%`);

  // 3) عدّ إشارات كل استراتيجية على كامل التاريخ (نفس مدخلات ensureSignals)
  resetTamsaState();
  const inp: DetectorsInput = {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h,
    c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: cons!,
    trend1h: struct1h!.trendTimeline, trend4h: struct4h!.trendTimeline,
    trend1d: struct1d!.trendTimeline, real1h: struct1h!.realPivots, real4h: struct4h!.realPivots,
  };
  const ctx = {
    params: structuredClone(DEFAULT_TAMSA_PARAMS),
    emaAt: () => null, // بلا مؤشر EMA: نقيس المولّدات الخام لكل استراتيجية
    sessionsOf: () => ({ enabled: true, asia: true, london: true, londonNY: true, ny: true }),
  };
  const sigs = runAllDetectors(inp, ctx);

  // 4) توزيع الإشارات على الاستراتيجيات
  const perStrat: Record<string, number> = {};
  for (const s of sigs) perStrat[s.strategy] = (perStrat[s.strategy] ?? 0) + 1;
  const from = new Date(data.c5[0].t).toISOString().slice(0, 10);
  const to = new Date(data.c5[data.c5.length - 1].t).toISOString().slice(0, 10);
  console.log(`\n=== إشارات مولّدة لكل استراتيجية (التاريخ الكامل ${from} → ${to}) ===`);
  const letters = 'ABCDEFGHIJKLMNOPQR'.split('');
  const zero: string[] = [];
  let total = 0;
  for (const L of letters) {
    const n = perStrat[L] ?? 0;
    total += n;
    console.log(`${L}: ${n}`);
    if (n === 0) zero.push(L);
  }
  console.log('المجموع:', total);
  console.log(zero.length ? `⚠️ استراتيجيات بلا إشارات على هذه البيانات: ${zero.join(',')}` : '✅ جميع الاستراتيجيات A-R تُولّد إشارات');

  // 5) عيّنة من أسباب الحجب في الباك تيست الرسمي (فلاتر القواعد العليا)
  const blocked = (bt as unknown as { blocked?: Record<string, number> }).blocked ?? {};
  console.log('\n=== أسباب حجب التنفيذ (فلاتر القواعد العليا) ===');
  const entries = Object.entries(blocked).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('\n') : '(بلا حجب مسجل في stats)');
}

main();
