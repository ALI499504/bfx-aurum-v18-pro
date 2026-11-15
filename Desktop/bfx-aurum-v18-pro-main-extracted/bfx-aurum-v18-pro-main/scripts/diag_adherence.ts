// إثبات الالتزام الحرفي: كل تعديل يدوي في واجهة الاستراتيجيات يلتزمه المحرك فوراً
// يفحص: (1) تعطيل استراتيجية كاملة (2) تعطيل بند (3) تعطيل سيناريو (4) تعديل رقم
// (5) تعديل جلسات بند (6) تعديل جلسات سيناريو (7) مستويات L (8) فلتر R الترندي
import fs from 'node:fs';
import path from 'node:path';
import { loadData, runBacktest } from '../src/lib/engine/backtest';
import { runAllDetectors, resetTamsaState, type DetectorsInput } from '../src/lib/engine/strategies';
import { DEFAULT_TAMSA_PARAMS } from '../src/lib/engine/tamsa-params';
import { DEFAULT_SETTINGS, buildScenarioSessions, type Settings } from '../src/lib/engine/rules';
import type { Candle, StrategyId } from '../src/lib/engine/types';

function loadSnap(): DetectorsInput {
  const snapPath = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8')) as { tfs: Record<string, unknown[]> };
  const files: Record<string, Candle[]> = {};
  for (const [tf, arr] of Object.entries(snap.tfs)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    files[tf] = (arr as unknown[][]).map((a: unknown[]) => ({
      t: Number(a[0]), o: Number(a[1]), h: Number(a[2]), l: Number(a[3]), c: Number(a[4]), v: Number(a[5] ?? 0),
    })).filter((c: Candle) => Number.isFinite(c.t) && c.t > 0);
  }
  // تسريع الفحص: آخر 60 يوماً من 5m فقط (تكفي لإثبات الالتزام — كل الاستراتيجيات تُولّد فيها)
  const cut = files['5m'][files['5m'].length - 1].t - 60 * 86400e3;
  for (const k of Object.keys(files)) {
    if (k === '1w' || k === '1M') continue; // الفريمات الكبيرة تبقى كاملة (مراسٍ الهيكل)
    files[k] = files[k].filter(c => c.t >= cut);
  }
  const data = loadData(files);
  // تسخين الكاش البنيوي
  runBacktest(data, structuredClone(DEFAULT_SETTINGS), Date.now(), []);
  const { getCachedStructure } = require('../src/lib/engine/backtest') as typeof import('../src/lib/engine/backtest');
  const { struct1h, struct4h, struct1d, cons } = getCachedStructure();
  return {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: cons!, trend1h: struct1h!.trendTimeline, trend4h: struct4h!.trendTimeline, trend1d: struct1d!.trendTimeline,
    real1h: struct1h!.realPivots, real4h: struct4h!.realPivots,
  };
}

const ctxOf = (settings: Settings, inp: DetectorsInput) => ({
  params: ((): unknown => {
    // محاكاة mergeParams: الدمج العميق مع الافتراضي
    const out = structuredClone(DEFAULT_TAMSA_PARAMS) as unknown as Record<string, unknown>;
    const deep = (b: Record<string, unknown>, v: Record<string, unknown>) => {
      for (const k of Object.keys(v)) {
        const bv = b[k], vv = v[k];
        if (bv && typeof bv === 'object' && !Array.isArray(bv) && vv && typeof vv === 'object' && !Array.isArray(vv)) deep(bv, vv);
        else if (vv !== undefined) b[k] = vv;
      }
    };
    deep(out, (settings.strategyParams ?? {}) as Record<string, unknown>);
    return out;
  })(),
  emaAt: (t: number) => {
    const ind = settings.indicators;
    if (!ind.ema) return null;
    void t; // الفحص يركز على بوابات المعاملات — EMA الافتراضي معطل هنا
    return null;
  },
  sessionsOf: (st: StrategyId, cs: string | undefined, scenario: 1 | 2) => {
    const node = settings.scenarioSessions?.[st]?.[cs ?? 'main'];
    const sk = scenario === 1 ? 's1' : 's2';
    const v = (node as Record<string, ({ enabled?: boolean; asia: boolean; london: boolean; londonNY: boolean; ny: boolean }) | undefined> | undefined)?.[sk];
    return { enabled: v?.enabled !== false, asia: v?.asia ?? true, london: v?.london ?? true, londonNY: v?.londonNY ?? true, ny: v?.ny ?? true };
  },
});

function count(inp: DetectorsInput, settings: Settings): Record<string, number> {
  resetTamsaState();
  const sigs = runAllDetectors(inp, ctxOf(settings, inp) as never);
  const per: Record<string, number> = {};
  for (const s of sigs) per[s.strategy] = (per[s.strategy] ?? 0) + 1;
  return per;
}

function main() {
  const inp = loadSnap();
  let pass = 0, fail = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (ok) { pass++; console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`); }
    else { fail++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };

  // (0) خط الأساس
  const base = structuredClone(DEFAULT_SETTINGS);
  const c0 = count(inp, base);
  const total0 = Object.values(c0).reduce((a, b) => a + b, 0);
  console.log(`خط الأساس: ${total0} إشارة`, c0);

  // (1) تعطيل استراتيجية كاملة (A.enabled = false)
  const s1 = structuredClone(base);
  (s1.strategyParams as Record<string, { enabled: boolean }>).A.enabled = false;
  const c1 = count(inp, s1);
  check('تعطيل استراتيجية كاملة (A)', (c1.A ?? 0) === 0, `A: ${c0.A ?? 0} → ${c1.A ?? 0}`);

  // (2) تعطيل بند واحد (A.case2.enabled = false) — case1 يبقى
  const s2 = structuredClone(base);
  ((s2.strategyParams as Record<string, Record<string, { enabled: boolean }>>).A).case2.enabled = false;
  const c2 = count(inp, s2);
  check('تعطيل بند (A.case2)', (c2.A ?? 0) < (c0.A ?? 0), `A: ${c0.A ?? 0} → ${c2.A ?? 0} (بقي case1 فقط)`);

  // (3) تعطيل سيناريو (A.case1.s1.enabled = false) — إشارات case1 (المتوافق = س1 بلا EMA) تختفي
  //     وتبقى إشارات case2 (سيناريوها 1 ما زال مفعلاً) = الفرق بين الأساس وعدد case1
  const s3 = structuredClone(base);
  (((s3.scenarioSessions as Record<string, Record<string, Record<string, { enabled?: boolean; [k: string]: boolean }>>>).A).case1.s1).enabled = false;
  const c3 = count(inp, s3);
  // عدد case1 وحدها = نتيجة اختبار (2) بعد تعطيل case2
  const case1Only = c2.A ?? 0;
  check('تعطيل سيناريو الأول (A.case1.s1)', (c3.A ?? 0) === (c0.A ?? 0) - case1Only,
    `A: ${c0.A ?? 0} → ${c3.A ?? 0} (اختفى بند case1 = ${case1Only}، بقي case2)`);

  // (4) تعديل رقم (E.entryPips 20 → 5): يجب أن تتغير مسافات الدخول
  const s4 = structuredClone(base);
  (s4.strategyParams as unknown as Record<string, Record<string, unknown>>).E.entryPips = 5;
  resetTamsaState();
  const sig4 = runAllDetectors(inp, ctxOf(s4, inp) as never).filter(s => s.strategy === 'E');
  resetTamsaState();
  const sig0 = runAllDetectors(inp, ctxOf(base, inp) as never).filter(s => s.strategy === 'E');
  const changed = sig4.length > 0 && sig0.length > 0 &&
    sig4.some(s4e => !sig0.some(s0e => s0e.entry === s4e.entry && s0e.knownAt === s4e.knownAt));
  check('تعديل رقم يدوي (E.entryPips 20→5) يغيّر أسعار الدخول فعلياً', changed,
    `أول دخول قبل: ${sig0[0]?.entry.toFixed(2)} → بعده: ${sig4[0]?.entry.toFixed(2)}`);

  // (5) إغلاق كل جلسات بند (E.e1 كلا السيناريوهين) → صفر إشارات e1 تحديداً (بقية بنود E تعمل)
  const s5 = structuredClone(base);
  const e1Node = (((s5.scenarioSessions as Record<string, Record<string, Record<string, { enabled?: boolean; [k: string]: boolean }>>>).E).e1);
  for (const sc of ['s1', 's2'] as const) for (const sk of ['asia', 'london', 'londonNY', 'ny']) e1Node[sc][sk] = false;
  resetTamsaState();
  const e5 = runAllDetectors(inp, ctxOf(s5, inp) as never).filter(s => s.strategy === 'E');
  resetTamsaState();
  const e0 = runAllDetectors(inp, ctxOf(base, inp) as never).filter(s => s.strategy === 'E');
  const e1Gone = e5.every(s => s.case !== 'e1') && e0.some(s => s.case === 'e1');
  check('إغلاق كل جلسات بند (E.e1)', e1Gone, `e1: ${e0.filter(s => s.case === 'e1').length} → ${e5.filter(s => s.case === 'e1').length} (بقية E تعمل)`);

  // (6) تعديل جلسات B لإغلاق لندن — إشارات B في لندن تختفي
  const s6 = structuredClone(base);
  const bMain = (((s6.scenarioSessions as Record<string, Record<string, Record<string, { [k: string]: boolean }>>>).B).main);
  for (const sc of ['s1', 's2'] as const) bMain[sc].london = false;
  resetTamsaState();
  const b6 = runAllDetectors(inp, ctxOf(s6, inp) as never).filter(s => s.strategy === 'B');
  const b6London = b6.filter(s => {
    const h = ((s.knownAt + 3 * 3600e3) % 86400e3) / 3600e3;
    return h >= 10 && h < 15;
  });
  check('إغلاق جلسة لندن لـ B (كلا السيناريوهين)', b6London.length === 0, `إشارات B في لندن: ${b6London.length}`);

  // (7) مستويات L قابلة للتعديل: تغيير levels يولّد خطوطاً جديدة
  const s7 = structuredClone(base);
  (s7.strategyParams as unknown as Record<string, Record<string, unknown>>).L.levels = [33.3, 47.7, 66.6];
  resetTamsaState();
  const l7 = runAllDetectors(inp, ctxOf(s7, inp) as never).filter(s => s.strategy === 'L');
  resetTamsaState();
  const l0 = runAllDetectors(inp, ctxOf(base, inp) as never).filter(s => s.strategy === 'L');
  const lChanged = l7.length > 0 && l7.some(a => !l0.some(b => Math.abs(a.refLevel - b.refLevel) < 1e-9 && a.knownAt === b.knownAt));
  check('تعديل مصفوفة مستويات L (38.2/50/61.8 → 33.3/47.7/66.6)', lChanged, `L: ${l0.length} → ${l7.length} إشارة بمستويات جديدة`);

  // (8) بناء بوابات الجلسات يتضمن مفتاح السيناريو
  const bs = buildScenarioSessions();
  const hasEnabled = Object.values(bs).every(cases => Object.values(cases).every(sc =>
    sc.s1.enabled === true && sc.s2.enabled === true));
  check('buildScenarioSessions يولّد مفتاح تفعيل لكل سيناريو', hasEnabled);

  console.log(`\n=== النتيجة: ${pass} ناجح / ${fail} فاشل ===`);
  if (fail > 0) process.exit(1);
}

main();
