// ============================================================
// كاش الباك تيست الدائم — إصلاح جذري لعطل «باك تيست 2025 = خطأ»
// ------------------------------------------------------------
// الجذر القديم: ذاكرة المحرك تُفرغ مع كل شمعة 5 دقائق جديدة
// ومع كل تنقل بين النوافذ الحية والباك تيست، فيُعاد بناء تحليل
// التاريخ الكامل (2023→2026) من الصفر فيستغرق 40+ ثانية فتقطع
// البوابة الطلب فيصل للسيد «خطأ يحتاج تدخل».
// الحل هنا:
//   1) بيانات سنة منتهية ثابتة لا تتغير أبداً → تُبنى مرة واحدة
//      وتُحفظ لقطة تحليل كاملة (EngineSnapshot) في الذاكرة للأبد.
//   2) كل طلب لاحق يتبنى اللقطة ويشغّل المحرك خلال ميلي ثوانٍ.
//   3) التبني والتنفيذ والإعادة كلها في كتلة متزامنة واحدة —
//      الجافاسكربت أحادي الخيط فلا تقاطع ممكن مع البث الحي،
//      وكاش الصفحات الحية يبقى سليماً كما هو (صفر تلوث).
//   4) الفترات المفتوحة (السنة الجارية / كل التاريخ) كاش بمدة
//      صلاحية 90 ثانية — توازن بين الطزاجة وسرعة الاستجابة.
//   5) تسخين تلقائي عند إقلاع الخادم (prewarmBacktest) فأول طلب
//      من السيد يكون فورياً أصلاً.
// كل البيانات حقيقية 100% من شموع MT5 — لا توليد ولا محاكاة.
// ============================================================
import { mt5Feed } from './mt5feed';
import type { Candle } from '@/lib/engine/types';
import { TF_MS } from '@/lib/engine/types';
import { SYRIA_OFFSET_MS } from '@/lib/engine/sessions';
import {
  loadData, resetEngineCache, runBacktest,
  snapshotEngine, adoptEngine,
  type EngineData, type EngineSnapshot,
} from '@/lib/engine/backtest';
import type { Settings } from '@/lib/engine/rules';
import { loadBotSettings } from './backtestRunner';

const ENGINE_TFS = ['5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
const MIN_5M_WINDOW = 250;   // أقل عدد شموع 5m داخل النافذة لتشغيل محرك عادل
const WARMUP_MS = 180 * 86400e3; // تسخين 180 يوماً قبل بداية النافذة (مطابق للنسخة السابقة)
const OPEN_TTL_MS = 90_000;  // صلاحية كاش الفترات المفتوحة
const MAX_MEMOS = 8;         // سقف اللقطات المحفوظة (كل لقطة ~10-20MB)

// ---------- مثبتات نافذة الباك تيست (استقرار الأرقام) ----------
// جذر تقلّب الأرباح تلقائياً (7000→2000): نافذة «كل التاريخ» كانت تُبنى من
// أول شمعة متاحة وآخر شمعة واصلة — كلاهما يتحرك مع إعادة سحب الجسر، وعمق
// التاريخ في الطرفية، وكل شمعة 5m جديدة. من الآن:
//   • بداية «كل التاريخ» مثبتة على مرساة سحب الجسر الرسمية (2025-01-01)
//     أو أول شمعة متاحة إن كانت أبعد — لا تتأثر بإعادة السحب نفسها.
//   • نهاية أي نافذة = آخر يوم سوري «مكتمل» — الشمعة الجارية واليوم
//     غير المكتمل يُستبعدان، فالرقم ثابت طوال اليوم ولا يدخل إلى الحساب
//     شمعة نصف مكتملة ولا حدث أخبار مؤرخ في المستقبل.
const HISTORY_ANCHOR_MS = Date.UTC(2022, 0, 1); // كل التاريخ من 2022

/** نهاية آخر يوم سوري مكتمل داخل البيانات (بالمللي ثانية UTC) */
function lastClosedSyriaDayEnd(lastT: number): number {
  const dayStart = Math.floor((lastT + SYRIA_OFFSET_MS) / 86400e3) * 86400e3 - SYRIA_OFFSET_MS;
  const dayFullyCovered = lastT + TF_MS['5m'] <= dayStart + 86400e3;
  return dayFullyCovered ? dayStart + 86400e3 : dayStart;
}

interface MemoEntry {
  snap: EngineSnapshot;
  builtAt: number;
  key: string;
  countInWindow: number; // عدد شموع 5m داخل نافذة التقرير وقت البناء — لكشف وصول تاريخ جديد
  permanent: boolean;
}

const memos = new Map<string, MemoEntry>();

// ---------- أدوات نافذة زمنية ----------
/** تقطيع دقيق [fromT, toT] — إصلاح خلل تاريخي: حين لا توجد أي شمعة داخل النافذة
 *  كان يُعاد المصفوفة كاملة (j بقى a.length) فتعمل السنوات الناقصة على بيانات خاطئة! */
function sliceArr(a: Candle[], fromT: number, toT: number): Candle[] {
  // أول فهرس t >= fromT (إن لم يوجد = a.length)
  let lo = 0, hi = a.length - 1, i = a.length;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].t >= fromT) { i = m; hi = m - 1; } else lo = m + 1; }
  // أول فهرس t > toT انطلاقاً من i — إن لم يوجد = a.length، وإن كل النافذة خالية = i (شريحة فارغة صحيحة)
  let lo2 = i, hi2 = a.length - 1, j = a.length;
  while (lo2 <= hi2) { const m = (lo2 + hi2) >> 1; if (a[m].t <= toT) lo2 = m + 1; else { j = m; hi2 = m - 1; } }
  if (j < i) j = i;
  return i === 0 && j === a.length ? a : a.slice(i, j);
}

function count5mIn(a: Candle[], fromT: number, toT: number): number {
  return sliceArr(a, fromT, toT).length;
}

// ---------- تحديد النافذة من السنة/المدى ----------
export interface BacktestWindow { fromT: number; toT: number; reportFrom: number; reportTo: number; permanent: boolean }

export function resolveWindow(year: number | null, fromYear?: number | null, toYear?: number | null): BacktestWindow | null {
  const c5 = (mt5Feed().tfs['5m'] ?? []) as Candle[];
  if (!c5.length) return null;
  const lastT = c5[c5.length - 1].t;
  const closedEnd = lastClosedSyriaDayEnd(lastT);
  const curYearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  let start: number, end: number;
  if (year !== null) { start = Date.UTC(year, 0, 1); end = Math.min(Date.UTC(year + 1, 0, 1) - 1, closedEnd); }
  else if (fromYear != null && toYear != null) { start = Date.UTC(fromYear, 0, 1); end = Math.min(Date.UTC(toYear + 1, 0, 1) - 1, closedEnd); }
  else { start = Math.max(c5[0].t, HISTORY_ANCHOR_MS); end = closedEnd; } // كل التاريخ: مثبت على مرساة 2025-01-01 حتى آخر يوم مكتمل
  if (end <= start) return null;
  return {
    fromT: start - WARMUP_MS,
    toT: end,
    reportFrom: start,
    reportTo: end,
    permanent: end < curYearStart, // فترة منتهية = بياناتها مجمدة تاريخياً
  };
}

// ---------- بناء بيانات المحرك لنافذة (يُستدعى داخل كتلة متزامنة) ----------
function buildWindowData(w: BacktestWindow): EngineData | null {
  const s = mt5Feed();
  const c5all = (s.tfs['5m'] ?? []) as Candle[];
  if (c5all.length < MIN_5M_WINDOW) return null;
  const full = w.fromT <= c5all[0].t && w.toT >= c5all[c5all.length - 1].t; // النافذة تغطي كل المتوفر
  const raw: Record<string, Candle[]> = {};
  for (const tf of ENGINE_TFS) {
    const arr = (s.tfs[tf] ?? []) as Candle[];
    if (!arr.length) continue;
    const cut = full ? arr : sliceArr(arr, w.fromT, w.toT);
    if (!cut.length) continue;
    // بوابة الجودة نفسها في data.ts: فريم متناثر يُستبعد ليُبنى تجميعياً من 5m الأكثف
    if (tf !== '5m' && tf !== '1d' && tf !== '1w' && tf !== '1M') {
      const span = cut[cut.length - 1].t - cut[0].t;
      if (cut.length < (span / TF_MS[tf]) * 0.5) continue;
    }
    raw[tf] = cut;
  }
  if (!raw['5m'] || raw['5m'].length < MIN_5M_WINDOW) return null;
  resetEngineCache();
  return loadData(raw);
}

// ============================================================
// النواة: تنفيذ باك تيست عبر كاش اللقطات — كتلة متزامنة ذرّية
// ============================================================
export function withBacktestEngine<T>(
  w: BacktestWindow,
  compute: (data: EngineData) => T,
): { ok: true; result: T; built: boolean; ms: number } | { ok: false; reason: string } {
  const c5 = (mt5Feed().tfs['5m'] ?? []) as Candle[];
  if (!c5.length) return { ok: false, reason: 'لا توجد شموع حقيقية مستلمة من MT5 بعد — فعّل الجسر على جهازك' };
  const nIn = count5mIn(c5, w.reportFrom, w.reportTo);
  if (nIn < MIN_5M_WINDOW) {
    return { ok: false, reason: `شموع الفترة المطلوبة غير متوفرة في التاريخ الحقيقي المستلم من MT5 (المتاح من ${new Date(c5[0].t).toISOString().slice(0, 10)} إلى ${new Date(c5[c5.length - 1].t).toISOString().slice(0, 10)})` };
  }

  const key = `${w.fromT}..${w.toT}`;
  const t0 = Date.now();
  const live = snapshotEngine(); // كاش البث الحي — يُعاد كما كان في كل الحالات

  try {
    const hit = memos.get(key);
    if (hit && (hit.permanent ? hit.countInWindow === nIn : Date.now() - hit.builtAt < OPEN_TTL_MS)) {
      adoptEngine(hit.snap); // اللقطة جاهزة — تبني فوري ثم تنفيذ خلال أجزاء من الثانية
      const result = compute(hit.snap.data!);
      return { ok: true, result, built: false, ms: Date.now() - t0 };
    }

    // بناء بارد — مرة واحدة لكل فترة منتهية (وأول 90 ثانية للفترات المفتوحة)
    const data = buildWindowData(w);
    if (!data) return { ok: false, reason: 'فشل بناء بيانات المحرك من شموع MT5 الحقيقية (شموع غير كافية في النافذة)' };
    const result = compute(data);
    const snap = snapshotEngine();
    memos.set(key, { snap, builtAt: Date.now(), key, countInWindow: nIn, permanent: w.permanent });
    // إخلاء الأقدمية عند تجاوز السقف (الفترات المفتوحة أولاً لأنها قصيرة العمر)
    if (memos.size > MAX_MEMOS) {
      const victim = [...memos.values()]
        .sort((a, b) => (a.permanent === b.permanent ? a.builtAt - b.builtAt : a.permanent ? 1 : -1))[0];
      if (victim) memos.delete(victim.key);
    }
    return { ok: true, result, built: true, ms: Date.now() - t0 };
  } finally {
    adoptEngine(live); // كاش البث الحي يعود كما كان — ذرياً قبل أي طلب آخر
  }
}

// ---------- تشغيل كامل مُغلف: نافذة + إعدادات + أخبار حقيقية ----------
export function runBacktestCached(
  year: number | null,
  settings: Settings,
  realNews: { t: number; name: string; impact?: string }[],
  fromYear?: number | null,
  toYear?: number | null,
): { ok: true; stats: ReturnType<typeof runBacktest>['stats']; trades: ReturnType<typeof runBacktest>['trades']; finalStructure: ReturnType<typeof runBacktest>['finalStructure']; decisionLog: ReturnType<typeof runBacktest>['decisionLog']; finalPending: ReturnType<typeof runBacktest>['finalPending']; sessionNow: ReturnType<typeof runBacktest>['sessionNow']; period?: { from: string; to: string }; cov5m?: { from: string; to: string } | null; built: boolean; ms: number } | { ok: false; reason: string } {
  const w = resolveWindow(year, fromYear ?? null, toYear ?? null);
  if (!w) return { ok: false, reason: 'تعذر تحديد نافذة الفترة — لا شموع حقيقية مستلمة' };
  const hasRange = year !== null || (fromYear != null && toYear != null);
  const r = withBacktestEngine(w, data => runBacktest(data, settings, Date.now(), realNews, hasRange ? { fromT: w.reportFrom, toT: w.reportTo } : undefined));
  if (!r.ok) return r;
  if (hasRange) {
    r.result.stats.startT = Math.max(r.result.stats.startT, w.reportFrom);
    r.result.stats.endT = Math.min(r.result.stats.endT, w.reportTo);
  }
  // التغطية الفعلية لشموع 5m الحقيقية داخل نافذة التقرير — للشفافية الكاملة:
  // إن بدأ تاريخ 5m وسط الفترة (حد طرفية الوسيط) يعرف السيد بالضبط ماذا حُسب على ماذا
  const c5all = (mt5Feed().tfs['5m'] ?? []) as Candle[];
  const inW = c5all.length ? sliceArr(c5all, w.reportFrom, w.reportTo) : [];
  const cov5m = inW.length >= 2 ? { from: new Date(inW[0].t).toISOString(), to: new Date(inW[inW.length - 1].t).toISOString() } : null;
  return {
    ok: true, stats: r.result.stats, trades: r.result.trades,
    finalStructure: r.result.finalStructure, decisionLog: r.result.decisionLog,
    finalPending: r.result.finalPending, sessionNow: r.result.sessionNow,
    period: hasRange ? { from: new Date(w.reportFrom).toISOString(), to: new Date(w.reportTo).toISOString() } : undefined,
    cov5m,
    built: r.built, ms: r.ms,
  };
}

// ============================================================
// تسخين تلقائي: يُستدعى عند إقلاع الخادم في الخلفية — يبني لقطات
// السنوات المنتهية مرة واحدة فأول «باك تيست 2025» من السيد فوري.
// ============================================================
export async function prewarmBacktest(): Promise<void> {
  // حماية الذاكرة (خطة التحويل — درس إنتاجي): التسخين الثقيل في وضع التطوير كان
  // يتصادم مع مترجم Next عند إقلاع الخادم فيقتل العملية بـOOM فيتوقف رابط المعاينة.
  // الإنتاج (standalone) يبقى مشغّلاً بالتسخين الكامل لأن ذاكعته أخف.
  if (process.env.NODE_ENV !== 'production') {
    console.log('[backtest-cache] التسخين مُتخطى في وضع التطوير (حماية OOM) — أول طلب باك تيست سيبني الكاش عند الطلب');
    return;
  }
  // إصلاح «تجميد الشارت عند إقلاع الخادم» (2026-11-17):
  // هذا التسخين يُشغّل أربعة باكتيستات كاملة متزامنة عند الإقلاع (2024/2025/2026/
  // كل التاريخ) = 68 ثانية قياساً على الإنتاج تُجمّد حلقة Node الواحدة، فيتوقف
  // /api/chart تماماً (قياس فعلي: 30–40 ثانية لأول طلب بعد كل إقلاع أو نشر).
  // والكاش الذي يبنيه يخص شاشة الباك تيست اليدوية فقط — لا الشارت ولا الإشارات.
  // فالأصلح: لا تسخين تلقائي. أول من يفتح الباك تيست يبني نتيجته مرة واحدة
  // (والتخزين المؤقت بعدها دائم). يمكن تشغيله يدوياً بمتغير PREWARM_BACKTEST=1.
  if (process.env.PREWARM_BACKTEST !== '1') {
    console.log('[backtest-cache] التسخين التلقائي مُعطَّل (حماية استجابة الشارت) — يُبنى عند أول طلب باك تيست. للتشغيل: PREWARM_BACKTEST=1');
    return;
  }
  const status = await import('./data').then(m => m.getDataStatus());
  if (!status.ok) return; // بلا بيانات حقيقية بعد — الجسر سيشغّل الباك تيست التلقائي لاحقاً
  const year = new Date().getUTCFullYear();
  const targets: (number | null)[] = [year - 2, year - 1, year, null];
  let settings: Settings;
  try { settings = await loadBotSettings(); } catch { return; }
  for (const y of targets) {
    try {
      const r = runBacktestCached(y, settings, []);
      console.log(`[backtest-cache] تسخين ${y ?? 'كل التاريخ'}: ${r.ok ? `جاهز (${r.ms}ms، ${r.stats.totalTrades} صفقة)` : r.reason.slice(0, 80)}`);
    } catch (e) {
      console.error('[backtest-cache] فشل تسخين', y, String(e).slice(0, 120));
    }
  }
}
