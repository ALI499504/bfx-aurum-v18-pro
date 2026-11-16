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
//   6) بيانات MT5 الحقيقية أولاً — وإذا لم تتوفر كفاية يُستخدم
//      ملف الاستيراد التاريخي (db/mt5-feed-snapshot.json) كاحتياطي
//      حتى تعمل الفترات قبل يونيو 2025 بشكل دائم.
// ============================================================
import { mt5Feed, tryGetImportedData } from './mt5feed';
import type { Candle } from '@/lib/engine/types';
import { TF_MS } from '@/lib/engine/types';
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
  const curYearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  let start: number, end: number;
  if (year !== null) { start = Date.UTC(year, 0, 1); end = Math.min(Date.UTC(year + 1, 0, 1) - 1, lastT + 300e3); }
  else if (fromYear != null && toYear != null) { start = Date.UTC(fromYear, 0, 1); end = Math.min(Date.UTC(toYear + 1, 0, 1) - 1, lastT + 300e3); }
  else { start = c5[0].t; end = lastT + 300e3; } // كل التاريخ
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
  // جلب بيانات MT5 الحية (إن وجدت)
  const s = mt5Feed();
  const c5all = (s.tfs['5m'] ?? []) as Candle[];
  const hasReal = c5all.length >= MIN_5M_WINDOW;
  
  // إذا لم تكن هناك بيانات MT5 كافية، حاول الوقوف على البيانات المستوردة
  const imported = hasReal ? null : tryGetImportedData();
  const c5Imported = imported?.['5m'] ?? [];
  const active5m = hasReal ? c5all : c5Imported;
  
  if (!active5m.length) return null;
  const full = w.fromT <= active5m[0].t && w.toT >= active5m[active5m.length - 1].t;
  const raw: Record<string, Candle[]> = {};
  
  // جلب جميع الفريمات من المصدر الفعال (MT5 أو مستورد)
  const source = hasReal ? s : imported;
  for (const tf of ENGINE_TFS) {
    const arr = (source?.tfs[tf] ?? []) as Candle[];
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
  
  // التحقق من الحد الأدنى من الشموع 5m
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
  // جلب بيانات MT5 الحية (إن وجدت)
  const s = mt5Feed();
  const c5All = (s.tfs['5m'] ?? []) as Candle[];
  const c5 = c5All.length ? c5All : [];
  const hasReal = c5All.length >= MIN_5M_WINDOW;
  // إذا لم تكن هناك بيانات MT5 كافية، حاول الوقوف على البيانات المستوردة
  const imported = hasReal ? null : tryGetImportedData();
  const c5Imported = imported?.['5m'] ?? [];
  const active5m = hasReal ? c5 : c5Imported;
  if (!active5m.length) {
    return { ok: false, reason: 'لا توجد بيانات كافية (MT5 أو تاريخية) لتشغيل الباك‑تيست' };
  }
  const nIn = count5mIn(active5m as Candle[], w.reportFrom, w.reportTo);
  if (nIn < MIN_5M_WINDOW) {
    return { ok: false, reason: `عدد شموع الفترة غير كافٍ (${nIn} < ${MIN_5M_WINDOW})` };
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
