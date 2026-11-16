// ============================================================
// محرك الباك تيست — Backtest Engine Framework
// من 2025-01-01 حتى اليوم | سبريد ثابت | قواعد عليا | سلم أولويات
// ============================================================
import { Candle, Dir, Setup, StrategyId, TF, TF_MS, Trade, pips, SESSION_AR, SessionId, STRATEGY_NAMES } from './types';
import { currentSession, syriaHour, syriaWeekday, previousUSHighLow, SYRIA_OFFSET_MS, syriaDayNum } from './sessions';
import { analyzeStructure, detectConsolidations, FibAnchor, findFibAnchors, StructureAnalysis } from './structure';
import { DetectorsInput, runAllDetectors, signalToSetup, resetTamsaState, consumeLevel, SignalEvent, regimeGateStats } from './strategies';
import { DEFAULT_TAMSA_PARAMS, TamsaParams, SessionKey } from './tamsa-params';
import { newsBlock, resolveConflictsPdf, tradePnl, slCapPips } from './rules';
import { Settings } from './rules';
import { emaSeries } from './indicators';
import { PIP, BASKET_IDS } from './types';
import { DecisionEntry, formatDecisionLine, CANCEL_CAUSES, BLOCK_REASON_LABELS } from './constitution';

export interface BacktestResult {
  trades: Trade[];
  stats: BacktestStats;
  finalStructure: {
    trend1h: Dir; trend4h: Dir;
    lastRealHigh?: { kind: string; price: number; t: number };
    lastRealLow?: { kind: string; price: number; t: number };
    lastEvents: { type: string; dir: string; level: number; t: number }[];
  };
  /** أوامر معلقة حية عند نهاية البيانات — تُغذي نافذة الإشارات الحية */
  finalPending: {
    strategy: string; dir: 'buy' | 'sell'; entry: number; sl: number; tp: number;
    session: string; reason: string; expiresAt: number; createdAt: number; fibConfirmed?: boolean;
    setup?: 'A' | 'B' | null;
  }[];
  /** سجل قرارات الوكيل بصيغة المواصفة — نافذة آخر 24 ساعة من البيانات */
  decisionLog: DecisionEntry[];
  emaDirNow: Dir;
  sessionNow: SessionId | null;
}

export interface BacktestStats {
  startT: number; endT: number;
  totalTrades: number; wins: number; losses: number; winRate: number;
  netPnl: number; finalBalance: number; baseBalance: number;
  profitFactor: number; maxDrawdown: number; maxDrawdownPct: number;
  oos: { trades: number; winRate: number; avgR: number; gatePass: boolean; gateEnabled: boolean; threshold: number; minTrades: number };
  dailyKpi: { daysTraded: number; daysWith2Plus: number; pct: number; excludedStopDays: number; target: number };
  weekly: { weekStart: number; net: number; pct: number }[];
  monthly: { month: string; net: number; pct: number }[];
  matrix: Record<string, Record<string, { net: number; wins: number; losses: number; trades: number; winRate: number }>>;
  strategyTotals: Record<string, { net: number; trades: number; wins: number; losses: number; winRate: number; weeklyAvgPct: number; monthlyAvgPct: number; bestSession: string | null; worstSession: string | null }>;
  ranking: { strategy: string; net: number; winRate: number; trades: number }[];
  emaEnabled: boolean; emaState: Dir;
  spreadCents: number; lot: number; tpRatio: number;
  generatedAt: number;
  signalsCount: number; fillsBlocked: number;
  /** تشخيص: الإشارات المولّدة وما قُتل لكل استراتيجية (شفافية القمع) */
  sigByStrat?: Record<string, number>;
  fillBlockedByStrat?: Record<string, number>;
  /** بوابتا خطة التحويل (26/27): عدد الإشارات القتيلة لكل استراتيجية في كل بوابة */
  gateBlockedByStrat?: { dailyTrend: Record<string, number>; erQuiet: Record<string, number> };
  /** البوابات التكيفية (قواعد 31/32/33): الاحتجاز الاتجاهي، الانحسار الزمني، صفقات اللوت المحسّن */
  adaptiveGates?: {
    sideGuard: Record<string, number>;
    decayGuard: Record<string, number>;
    boostedFills: number;
    boostedByStrat: Record<string, number>;
  };
  /** توزيع أسباب حظر التنفيذ — شفافية كاملة لكل إشارة لم تُنفذ */
  blocked: Record<string, number>;
  /** ضربات الحوكمة الصلبة (الحدود المكتوبة في الكود) */
  railHits: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
  /** ضربات صمامات المخاطر المعتمدة (يومي/أسبوعي/إيكويتي) */
  fuseTrips: { daily: number; weekly: number; equity: number };
  /** نمط تحديد الحجم: fixed (لوت ثابت) أو risk (نسبة مخاطرة ديناميكية) */
  sizing: { mode: 'fixed' | 'risk'; riskPct: number };
  /** متوسط درجة الجودة للصفقات المنفذة */
  avgScore: number;
  /** النتيجة بوحدة R — مجموع R لكل الصفقات (R للصفقة = الربح ÷ مخاطرة الوقف بالدولار) */
  totalR: number;
  /** متوسط R للصفقة */
  avgR: number;
  /** منحنى الرصيد الكامل (مصغّر حتى 700 نقطة) — منحنى حسابي دقيق حتى مع آلاف الصفقات */
  equity?: { t: number; v: number }[];
}

// ---------- تحميل وتجميع البيانات ----------
export interface EngineData {
  c5: Candle[]; c15: Candle[]; c30: Candle[]; c1h: Candle[]; c4h: Candle[]; c1d: Candle[]; c1w: Candle[]; c1M: Candle[];
}

export function aggregate(base: Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  const bucket = (t: number) => Math.floor(t / ms) * ms;
  for (const c of base) {
    const b = bucket(c.t);
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l);
      cur.c = c.c; cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** شموع أسبوعية محاذاة لبدء الاثنين (كما في Binance) */
export function aggregateWeekly(base: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of base) {
    const d = new Date(c.t);
    const day = (d.getUTCDay() + 6) % 7; // 0=الاثنين
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400e3;
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l);
      cur.c = c.c; cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** شموع شهرية محاذاة لبداية الشهر الميلادي */
export function aggregateMonthly(base: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of base) {
    const d = new Date(c.t);
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l);
      cur.c = c.c; cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ذاكرة مؤقتة على مستوى العملية
/** مخرجات توليد الإشارات: المصفوفة + لقطة عدّادات بوابتا خطة التحويل (لكل بصمة إعدادات) */
export interface GeneratedSignals {
  sig: SignalEvent[];
  gateStats: { dailyTrend: Record<string, number>; erQuiet: Record<string, number> };
}

const cache: {
  data?: EngineData;
  struct1h?: StructureAnalysis;
  struct4h?: StructureAnalysis;
  struct1d?: StructureAnalysis;
  fib?: { fibD: FibAnchor[]; fib4h: FibAnchor[]; fibW: FibAnchor[] };
  cons?: ReturnType<typeof detectConsolidations>;
  usLevels?: { asiaOpenT: number; high: number; low: number }[];
  preTrend?: Map<number, Dir>;
  signals?: Map<string, GeneratedSignals>; // مفتاح = بصمة الإعدادات (المعاملات تُغير الإشارات)
  ema4h?: { fast: number[]; slow: number[] };
  ema1d?: { fast: number[]; slow: number[] };
} = {};

export function loadData(files: Record<string, Candle[]>): EngineData {
  if (cache.data) return cache.data;
  const c5 = files['5m'];
  const data: EngineData = {
    c5,
    c15: files['15m'] ?? aggregate(c5, TF_MS['15m']),
    c30: files['30m'] ?? aggregate(c5, TF_MS['30m']),
    c1h: files['1h'] ?? aggregate(c5, TF_MS['1h']),
    c4h: files['4h'] ?? aggregate(c5, TF_MS['4h']),
    c1d: files['1d'] ?? aggregate(c5, TF_MS['1d']),
    c1w: files['1w'] ?? aggregateWeekly(c5),
    c1M: files['1M'] ?? aggregateMonthly(c5),
  };
  cache.data = data;
  return data;
}

function ensurePrecompute(data: EngineData) {
  if (!cache.struct1h) cache.struct1h = analyzeStructure(data.c1h, '1h');
  if (!cache.struct4h) cache.struct4h = analyzeStructure(data.c4h, '4h');
  if (!cache.struct1d) cache.struct1d = analyzeStructure(data.c1d, '1d');
  if (!cache.fib) {
    cache.fib = {
      fibD: findFibAnchors(data.c1d, '1d', [0.236, 0.382, 0.5, 0.618]),
      fib4h: findFibAnchors(data.c4h, '4h', [0.236, 0.382, 0.5, 0.618]),
      fibW: findFibAnchors(data.c1w, '1w', [0.236, 0.382, 0.5, 0.618]),
    };
  }
  if (!cache.cons) cache.cons = detectConsolidations(data.c15);
  if (!cache.usLevels) {
    const lv: { asiaOpenT: number; high: number; low: number }[] = [];
    for (const c of data.c5) {
      const h = syriaHour(c.t);
      const wd = syriaWeekday(c.t);
      if (h === 1 && c.t % 3600e3 === 0 && wd !== 6) {
        const prev = previousUSHighLow(data.c5, c.t);
        if (prev) lv.push({ asiaOpenT: c.t, high: prev.high, low: prev.low });
      }
    }
    cache.usLevels = lv;
  }
  if (!cache.preTrend) {
    // اتجاه 1h السائد قبل بداية كل تجميع
    const tl = cache.struct1h!.trendTimeline;
    cache.preTrend = new Map();
    for (const z of cache.cons!) {
      let d: Dir = 'range';
      for (const p of tl) { if (p.t <= z.startT) d = p.trend; else break; }
      cache.preTrend.set(z.startT, d);
    }
  }
  if (!cache.ema4h) cache.ema4h = { fast: emaSeries(data.c4h, 20), slow: emaSeries(data.c4h, 90) };
  if (!cache.ema1d) cache.ema1d = { fast: emaSeries(data.c1d, 20), slow: emaSeries(data.c1d, 90) };
}

function ensureSignals(data: EngineData, settings: Settings): GeneratedSignals {
  ensurePrecompute(data);
  const key = settingsKey(settings);
  if (!cache.signals) cache.signals = new Map();
  const hit = cache.signals.get(key);
  if (hit) return hit;
  // سقف الذاكرة: كل تركيبة معاملات تُنتج مصفوفة إشارات كاملة (~آلاف السجلات).
  // بلا سقف، الضبط الشبكي (200+ تركيبة) يتراكم إلى غيغابايتات ويُقتل العملية OOM.
  // نحتفظ بآخر 3 بصمات فقط (المباشر + آخر نسختين) ونُفرغ الأقدم.
  if (cache.signals.size >= 3) {
    const drop = [...cache.signals.keys()].slice(0, cache.signals.size - 2);
    for (const k of drop) cache.signals.delete(k);
  }
  const inp: DetectorsInput = {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: cache.cons!,
    trend1h: cache.struct1h!.trendTimeline, trend4h: cache.struct4h!.trendTimeline,
    trend1d: cache.struct1d!.trendTimeline,
    real1h: cache.struct1h!.realPivots,
    real4h: cache.struct4h!.realPivots,
  };
  // معاملات الاستراتيجيات مدموجة مع الافتراضيات (شجرة كاملة حتى لو نقصت أوراق من القاعدة)
  const params = mergeParams(settings.strategyParams);
  const ctx = {
    params,
    emaAt: (t: number) => (settings.indicators.ema ? emaStateAt(data, t, settings.indicators.emaFast, settings.indicators.emaSlow) : null),
    sessionsOf: (st: StrategyId, cs: string | undefined, scenario: 1 | 2) => {
      const node = settings.scenarioSessions?.[st]?.[cs ?? 'main'];
      const sk = scenario === 1 ? 's1' : 's2';
      const v = (node as Record<string, ({ enabled?: boolean; asia: boolean; london: boolean; londonNY: boolean; ny: boolean }) | undefined> | undefined)?.[sk];
      // مفتاح السيناريو (زر المستخدم) + أزرار الجلسات — الافتراضي كله مفعل (توافق مع الإعدادات القديمة)
      return { enabled: v?.enabled !== false, asia: v?.asia ?? true, london: v?.london ?? true, londonNY: v?.londonNY ?? true, ny: v?.ny ?? true };
    },
    // بوابا خطة التحويل (26/27): الافتراضي مفعّلان — القاعدة 26 اتجاه اليومي، القاعدة 27 هدوء العكسية
    // __erIncludeG: مفتاح محاكاة قبلي حصراً (إخراج G من بوابة الكفاءة لقياس أثرها) — الافتراضي داخلها
    regimeGates: {
      dailyTrend: settings.globalRules.gate_daily_trend?.enabled !== false,
      erQuiet: settings.globalRules.gate_er_quiet?.enabled !== false,
      erIncludeG: (settings.globalRules as Record<string, unknown>)['__erIncludeG'] !== false,
    },
  };
  resetTamsaState();
  const sig = runAllDetectors(inp, ctx);
  const gen: GeneratedSignals = {
    sig,
    gateStats: { dailyTrend: { ...regimeGateStats().dailyTrend }, erQuiet: { ...regimeGateStats().erQuiet } },
  };
  cache.signals.set(key, gen);
  return gen;
}

/** مفتاح كاش الإشارات: بصمة المعاملات + بوابات الجلسات + حالة المؤشرات */
function settingsKey(s: Settings): string {
  try { return JSON.stringify([s.strategyParams, s.scenarioSessions, s.indicators]); }
  catch { return String(Date.now()); }
}

/** دمج عميق لمعاملات الاستراتيجيات مع الافتراضيات الحرفية من الدليل */
function mergeParams(saved: unknown): TamsaParams {
  const out = structuredClone(DEFAULT_TAMSA_PARAMS) as unknown as Record<string, unknown>;
  const s = (saved ?? {}) as Record<string, unknown>;
  const deep = (b: Record<string, unknown>, v: Record<string, unknown>) => {
    for (const k of Object.keys(v)) {
      const bv = b[k], vv = v[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && vv && typeof vv === 'object' && !Array.isArray(vv)) deep(bv as Record<string, unknown>, vv as Record<string, unknown>);
      else if (vv !== undefined) b[k] = vv;
    }
  };
  deep(out, s);
  return out as unknown as TamsaParams;
}

// ---------- حالة EMA 20/90 على 4H واليومي حصراً (الدليل ص85) ----------
function emaStateAt(data: EngineData, t: number, fastP: number, slowP: number): 'up' | 'down' | 'range' {
  const at = (c: Candle[], ema: { fast: number[]; slow: number[] }): Dir | null => {
    let idx = -1;
    let lo = 0, hi = c.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].t + (c === data.c4h ? TF_MS['4h'] : TF_MS['1d']) <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < slowP) return null;
    const diff = ema.fast[idx] - ema.slow[idx];
    return diff > 0 ? 'up' : 'down';
  };
  const d4 = at(data.c4h, cache.ema4h!);
  const dD = at(data.c1d, cache.ema1d!);
  // تشابك الخطوط (تعارض 4H واليومي) → منطقة عرضية تجميعية → إجبار السيناريو الثاني
  if (!d4 && !dD) return 'range';
  if (d4 && dD && d4 !== dD) return 'range';
  return d4 ?? dD ?? 'range';
}

// ---------- الباك تيست ----------
// ---------- إشارات خروج القاعدة للسلة المتحققة (W/X/Y/AA) — التنفيذ الحي ----------
/**
 * نفس قواعد خروج السلة بالحرف كما في المحاكاة المعتمدة (exit_fn على شمعة الساعة المغلقة):
 *   W (TSMOM): انعكاس زخم الأفق → يقتل الاتجاه القديم
 *   X (Ogle): كسر EMA البطيء ضد الصفقة
 *   Y (EWMAC): انعكاس تقاطع EMA ضد الصفقة
 *   AA (دونشييان): كسر قناة الخروج ضد الصفقة
 * exitBuy=true ⇒ أي صفقة شراء مفتوحة لهذه الاستراتيجية يجب إغلاقها الآن، ومثلها exitSell.
 * تُستخدم في عقل التنفيذ الحي لإصدار أوامر الإغلاق القاعدية عبر الجسر — نفس المنطق حرفياً.
 */
export function basketExitSignals(data: EngineData, settings: Settings): Record<'W' | 'X' | 'Y' | 'AA', { exitBuy: boolean; exitSell: boolean }> {
  const out: Record<'W' | 'X' | 'Y' | 'AA', { exitBuy: boolean; exitSell: boolean }> = {
    W: { exitBuy: false, exitSell: false }, X: { exitBuy: false, exitSell: false },
    Y: { exitBuy: false, exitSell: false }, AA: { exitBuy: false, exitSell: false },
  };
  try {
    const rl = mergeParams(settings.strategyParams);
    const c1h = data.c1h;
    if (!c1h || c1h.length < 10) return out;
    const closes = c1h.map(x => x.c);
    const last = closes.length - 1;
    const c = closes[last];
    // W: زخم الأفق (مثل المحرك بالحرف)
    const nMom = rl.W.horizonDays * 24;
    if (last >= nMom) {
      const sign = c > closes[last - nMom] ? 1 : -1;
      out.W = { exitBuy: sign < 0, exitSell: sign > 0 };
    }
    // X: كسر EMA البطيء
    const eX = emaSeries(c1h, rl.X.emaSlow);
    const eXl = eX[last];
    if (Number.isFinite(eXl)) out.X = { exitBuy: c < eXl, exitSell: c > eXl };
    // Y: انعكاس تقاطع EWMAC
    const eYf = emaSeries(c1h, rl.Y.fast)[last];
    const eYs = emaSeries(c1h, rl.Y.slow)[last];
    if (Number.isFinite(eYf) && Number.isFinite(eYs)) out.Y = { exitBuy: eYf < eYs, exitSell: eYf > eYs };
    // AA: كسر قناة الخروج دونشييان
    const lo = slidingMin(c1h.map(x => x.l), rl.AA.exitN)[last];
    const hi = slidingMax(c1h.map(x => x.h), rl.AA.exitN)[last];
    if (Number.isFinite(lo) && Number.isFinite(hi)) out.AA = { exitBuy: c < lo, exitSell: c > hi };
  } catch { /* المؤشرات لا توقف القناة */ }
  return out;
}

export function runBacktest(
  data: EngineData,
  settings: Settings,
  nowMs = Date.now(),
  realNews: { t: number; name: string; impact?: string }[] = [],
  /** نافذة تقرير اختيارية: المؤشرات تُحسب على كامل البيانات لكن لا صفقات تُفتح خارج [fromT, toT] */
  range?: { fromT?: number; toT?: number },
): BacktestResult {
  ensurePrecompute(data);
  // إصلاح جذري: الإشارات تُجمع من 23 كاشفاً كلٌّ بتسلسله الزمني الخاص — الدمج غير مرتب!
  // بلا ترتيب، مؤشر الاستهلاك يبتلع كل إشارات أول كاشف في الشمعة الأولى ثم يتعثر
  // في أول عنصر خارج الترتيب، فتُهدر آلاف الإشارات (expired/conflict وهمي).
  // الترتيب الزمني الصارم هو أساس أي محاكاة صحيحة (بلا تسلل مستقبلي).
  const gen = ensureSignals(data, settings);
  const gateStats = gen.gateStats;
  const signals = gen.sig.slice().sort((a, b) => a.knownAt - b.knownAt);

  const gr = settings.globalRules;
  const lot = gr.fixed_lot.enabled ? (gr.fixed_lot.value ?? 0.01) : 0.01; // القاعدة 2
  // قرار المالك (2026-11-12): الستوب 15$ حداً أقصى — سقف مسافة الوقف يُطبّق لحظة التنفيذ على كل الاستراتيجيات
  const slCap = slCapPips(gr); // بالبيب (15$ = 150 بيب) — Infinity إن بلا سقف
  const capPips = (p: number) => (slCap === Infinity ? p : Math.min(p, slCap));
  const spreadCents = gr.fixed_spread.enabled ? (gr.fixed_spread.value ?? 30) : 0; // القاعدة 17
  // الأخبار: أحداث ForexFactory الحقيقية فقط — القاعدة 14 (قبل 15 دقيقة وبعد 60)
  const news: { t: number; name: string }[] = gr.news_filter.enabled
    ? (realNews ?? []).filter(e => Number.isFinite(e.t)).map(e => ({ t: e.t, name: e.name }))
    : [];
  const beforeMin = gr.news_filter.enabled ? (gr.news_filter.value ?? 15) : 0;
  const afterMin = gr.news_after_min.enabled ? (gr.news_after_min.value ?? 60) : 0;
  const baseBalance = gr.fixed_base.enabled ? (gr.fixed_base.value ?? 1000) : 1000; // القاعدة 13

  // ---------- صمامات المخاطر المعتمدة (عصر السلة — قرار المالك بعد المحاكاة على 1000$) ----------
  // حد يومي 3% من الأساس (يُشدد القاعدة 7 المطلقة 50$ إن كان أضيق)، حد أسبوعي 6%،
  // وحماية الإيكويتي: منع الدخول الجديد عند هبوط الإيكويتي عن قمته بنسبة ≥ القيمة.
  const fuseDailyPct = gr.fuse_daily_pct?.enabled ? (gr.fuse_daily_pct.value ?? 3) : null;
  const fuseWeeklyPct = gr.fuse_weekly_pct?.enabled ? (gr.fuse_weekly_pct.value ?? 6) : null;
  const fuseEquityPct = gr.fuse_equity_floor?.enabled ? (gr.fuse_equity_floor.value ?? 50) : null;
  let weekNumPrev = -1;
  let weekPnl = 0;
  let weekStopped = false;
  let dayFuseBlocked = false;
  let eqPeak = baseBalance;
  let equityHalted = false;
  let fuseTrips = { daily: 0, weekly: 0, equity: 0 };

  // ---------- بوابة السبريد (خطة التحويل — القاعدة 2: اختبار السبريد قبل التفعيل) ----------
  // الاستراتيجية التي هامشها الصافي المتحقق الإجمالي (متوسط صافي الربح لكل صفقة على كامل
  // السجل بعينة ≥ 15) دون تكلفة السبريد × معامل الأمان تُوضع تحت الاحتجاز الاحتمالي:
  // صفقة واحدة يومياً كحد أقصى — كي تبقى العينة حيّة قادرة على الإثبات أو التعافي
  // ولا تُجمّد تجميداً دائماً. هذا هو التنفيذ العملي لـ«حماية السبريد + خفض التردد
  // 60%+» لـ U (هامش 0.023$ مقابل سبريد 0.30$) ولسائر الخاسرين المزمنين حصراً —
  // المتوسط الإجمالي لا يُسقط استراتيجيات حافتها الإجمالية قوية أثناء سحوبات مؤقتة.
  const spreadGuardOn = gr.gate_spread_guard?.enabled !== false;
  const spreadGuardFactor = Math.max(0.1, gr.gate_spread_guard?.value ?? 1);
  const spreadCostPerTrade = (spreadCents / 100) * (lot / 0.01);
  const SPREAD_SAMPLE_MIN = 15;
  const stratPnlHist = new Map<string, number[]>();
  const onSpreadProbation = (st: string): boolean => {
    if (!spreadGuardOn) return false;
    const arr = stratPnlHist.get(st);
    if (!arr || arr.length < SPREAD_SAMPLE_MIN) return false;
    const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
    return avg <= spreadCostPerTrade * spreadGuardFactor;
  };
  const stratDayFills = new Map<string, number>(); // تنفيذ اليوم لكل استراتيجية (لحصر المحتجَزين)

  // ---------- البوابات التكيفية (قواعد 31/32/33) — كلها سببية من الصفقات المغلقة قبل لحظة القرار ----------
  // تاريخ مغلق لكل (استراتيجية:جهة) — أساس الاحتجاز الاتجاهي
  const sideHist = new Map<string, number[]>();
  // تاريخ مغلق طابع زمني لكل استراتيجية — أساس بوابة الانحسار الزمني وتحجيم الجودة
  const closedHist = new Map<string, { t: number; pnl: number }[]>();
  const pushClosed = (tr: Trade): void => {
    const sk = `${tr.strategy}:${tr.dir}`;
    const sh = sideHist.get(sk) ?? [];
    sh.push(tr.pnl);
    sideHist.set(sk, sh);
    const ch = closedHist.get(tr.strategy) ?? [];
    ch.push({ t: tr.exitT, pnl: tr.pnl });
    closedHist.set(tr.strategy, ch);
  };
  const pfOf = (arr: number[]): { pf: number; gw: number; gl: number } => {
    const gw = arr.filter(x => x > 0).reduce((s, x) => s + x, 0);
    const gl = -arr.filter(x => x < 0).reduce((s, x) => s + x, 0);
    return { pf: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), gw, gl };
  };
  // القاعدة 31: الاحتجاز الاتجاهي — PF تراكمي دون العتبة بعينة ≥ 30 (أو فرع الطوارئ: PF < 0.50 بـ ≥ 12)
  const sideGuardOn = gr.gate_side_pf?.enabled !== false;
  const sidePfMax = Math.max(0.1, (gr.gate_side_pf?.value ?? 90) / 100);
  const SIDE_MIN = 30;
  const SIDE_CATASTROPHIC_MIN = 12;
  const SIDE_CATASTROPHIC_PF = 0.50;
  const onSideProbation = (st: string, dir: 'buy' | 'sell'): boolean => {
    if (!sideGuardOn) return false;
    const arr = sideHist.get(`${st}:${dir}`);
    if (!arr || arr.length < SIDE_CATASTROPHIC_MIN) return false;
    const { pf } = pfOf(arr);
    return (arr.length >= SIDE_MIN && pf < sidePfMax) || pf < SIDE_CATASTROPHIC_PF;
  };
  // القاعدة 32: بوابة الانحسار الزمني — PF نافذة 90 يوماً دون 1.00 بعينة ≥ 50 داخل النافذة
  const DECAY_WINDOW_MS = 90 * 86400e3;
  const DECAY_MIN_TRADES = 50;
  const decayOn = gr.gate_decay90?.enabled !== false;
  const decayPfMax = Math.max(0.1, (gr.gate_decay90?.value ?? 100) / 100);
  const onDecayProbation = (st: string, nowT: number): boolean => {
    if (!decayOn) return false;
    const arr = closedHist.get(st);
    if (!arr) return false;
    const win = arr.filter(x => nowT - x.t <= DECAY_WINDOW_MS);
    if (win.length < DECAY_MIN_TRADES) return false;
    return pfOf(win.map(x => x.pnl)).pf < decayPfMax;
  };
  // القاعدة 33: تحجيم الجودة — السلة الكبيرة السبعة بنافذة 90 يوماً صحية (PF ≥ 1.15 بعينة ≥ 10) تتداول بلوت مضاعف
  const QUALITY_SET = new Set<string>(['E', 'W', 'X', 'I', 'AA', 'F', 'Y']);
  const QUALITY_MIN_TRADES = 10;
  const QUALITY_PROMO_PF = 1.15; // عتبة ترقية سلّم القاعدة 30 — نفسها
  const BOOST_DD_MAX = 10; // % — التضخيم معطل عند التراجع عن قمة الإيكويتي ≥ 10% (وعي المخاطرة: تضخيم في الصحة فقط، لا يضاعف الخسارة في السحبة)
  const boostOn = gr.sizing_quality?.enabled !== false;
  const boostMult = Math.max(1, gr.sizing_quality?.value ?? 2);
  const boostLot = Math.round(lot * boostMult * 100) / 100;
  const qualityBoost = (st: string, nowT: number): boolean => {
    if (!boostOn || !QUALITY_SET.has(st)) return false;
    const arr = closedHist.get(st);
    if (!arr) return false;
    const win = arr.filter(x => nowT - x.t <= DECAY_WINDOW_MS);
    if (win.length < QUALITY_MIN_TRADES) return false;
    return pfOf(win.map(x => x.pnl)).pf >= QUALITY_PROMO_PF;
  };
  const stratSideDayFills = new Map<string, number>(); // تنفيذ اليوم لكل (استراتيجية:جهة) — للاحتجاز الاتجاهي
  // شفافية البوابات التكيفية في الإحصاءات
  const sideGuardByStrat: Record<string, number> = {};
  const decayGuardByStrat: Record<string, number> = {};
  const boostedByStrat: Record<string, number> = {};
  let boostedFills = 0;

  const trades: Trade[] = [];
  let balance = baseBalance;
  let tradeId = 1;
  let setupId = 1;
  let signalsCount = 0;
  const sigByStrat: Record<string, number> = {};   // تشخيص: الإشارات المولدة لكل استراتيجية
  const fillBlockedByStrat: Record<string, number> = {}; // تشخيص: ما قُتل/انتهى لكل استراتيجية
  let fillsBlocked = 0;
  const blocked: Record<string, number> = {};
  const bump = (cause: string) => { blocked[cause] = (blocked[cause] ?? 0) + 1; fillsBlocked++; };

  // القاعدة 3: حد أدنى للاحتفاظ 4 دقائق — يقيّد الإغلاق القسري (الزمني) فقط
  const minHoldMs = gr.min_hold_min.enabled ? (gr.min_hold_min.value ?? 4) * 60e3 : 0;
  // القاعدة 10 (دلالة عصر السلة): صفقة نشطة واحدة لكل استراتيجية — وليست واحدة للحساب كله —
  // مع سقف تزامن عام max_concurrent (الافتراضي 4 = مكوّنات السلة المعتمدة W/X/Y/AA).
  // التبرير: المحاكاة المعتمدة (+3167$ سنة / PF 3.92) تقوم على مواضع متوازية لمكونات السلة،
  // والصمامات (يومي 3% / أسبوعي 6% / إيكويتي 15%) هي حد المخاطرة الجديد بدل القيد المطلق.
  const maxConcurrent = gr.max_concurrent?.enabled
    ? Math.max(1, gr.max_concurrent.value ?? 4)
    : (gr.single_trade.enabled ? 1 : 99);

  let pending: Setup[] = [];
  const openTrades: Trade[] = [];

  let dayNumPrev = -1;
  let dayKey = '';
  let dayTrades = 0;
  let dayPnl = 0;
  let dayStopped: 'loss' | 'profit' | null = null;
  const stoppedDays = new Set<string>();
  const dayTraded = new Set<string>();
  const dayWith1Plus = new Set<string>();
  // هدف الالتزام اليومي (القاعدة 6: صفقة واحدة على الأقل)
  const dailyTarget = gr.min_daily_trades.enabled ? Math.max(1, gr.min_daily_trades.value ?? 1) : 1;

  const sigPtr = { i: 0 };
  const c5 = data.c5;

  // ---------- حسابات خروج القاعدة (استراتيجيات السلة المتحققة — على شموع الساعة المغلقة) ----------
  // قرار الخروج من إغلاق ساعة مكتملة، والتنفيذ على آخر شمعة 5m من الساعة (إغلاقها = إغلاق الساعة
  // في التجميع) — بلا تسلل مستقبلي، وحرفياً كما في المحاكاة المعتمدة (exit_fn على شمعة 1h).
  const rl = mergeParams(settings.strategyParams);
  const c1h = data.c1h;
  const c1hCloses = c1h.map(x => x.c);
  const nMom = rl.W.horizonDays * 24;
  const momSign = new Int8Array(c1hCloses.length);
  for (let i = nMom; i < c1hCloses.length; i++) momSign[i] = c1hCloses[i] > c1hCloses[i - nMom] ? 1 : -1;
  const eXSlow = emaSeries(c1h, rl.X.emaSlow);   // خروج Ogle: كسر EMA البطيء
  const eYFast = emaSeries(c1h, rl.Y.fast);      // خروج EWMAC: انعكاس التقاطع
  const eYSlow = emaSeries(c1h, rl.Y.slow);
  const donExitLo = slidingMin(c1h.map(x => x.l), rl.AA.exitN); // دونشييان: كسر قناة الخروج
  const donExitHi = slidingMax(c1h.map(x => x.h), rl.AA.exitN);
  const X_MAX_HOLD_HOURS = 120; // حرفياً من المحاكاة: held > 120 شمعة ساعية (5 أيام)
  const hourIdxAt = (tms: number): number => {
    let lo = 0, hi = c1h.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c1h[mid].t <= tms) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx;
  };

  // رتبة الاستراتيجية في سلم الجلسة النشطة (قاعدة 21 + بروتوكول السيادة)
  const rankOf = (strategy: StrategyId, sess: SessionId | null, scenario: 1 | 2 | undefined): number => {
    const sk: SessionKey = (sess ?? 'asia') as SessionKey;
    const ladder = settings.priorityLadder?.[sk] ?? [];
    const idx = ladder.indexOf(strategy as never);
    return (idx < 0 ? 99 : idx) * 2 + (scenario === 2 ? 1 : 0);
  };

  const doClose = (tr: Trade, exitPrice: number, result: Trade['result'], atT: number) => {
    tr.exit = exitPrice; tr.exitT = atT; tr.result = result;
    tr.pnl = tradePnl(tr.dir, tr.entry, tr.exit, tr.lot, spreadCents);
    const riskD = Math.abs(tr.entry - tr.sl) * (tr.lot / 0.01);
    tr.r = riskD > 0 ? Math.round(tr.pnl / riskD * 100) / 100 : 0;
    balance += tr.pnl;
    dayPnl += tr.pnl;
    weekPnl += tr.pnl;
    trades.push(tr);
    logClose(tr, atT);
    // قاعدة الاستهلاك الذاتي: إغلاق الصفقة يستهلك مستواها لهذه الاستراتيجية (قاعدة المرة الواحدة)
    if (tr.levelKey) consumeLevel(tr.strategy, tr.levelKey);
    // بوابة السبريد: تاريخ الصافي المتدحرج لكل استراتيجية (أساس الاحتجاز الاحتمالي)
    const hist = stratPnlHist.get(tr.strategy) ?? [];
    hist.push(tr.pnl);
    stratPnlHist.set(tr.strategy, hist);
    pushClosed(tr); // البوابات التكيفية 31/32/33: تاريخ مسبب بالطابع الزمني والجهة
    const idx = openTrades.findIndex(x => x.id === tr.id);
    if (idx >= 0) openTrades.splice(idx, 1);
  };

  const endT = c5[c5.length - 1].t + TF_MS['5m'];

  // القاعدة 14 داخل حدود البيانات حصراً: تقويم ForexFactory المخزّن يغطي الأسبوع الحالي فقط،
  // وتطبيق مواعيده على التاريخ الكامل كان يُدخل أحداثاً مؤرخة بعد آخر شمعة (تسريب مستقبلي
  // يمنع صفقات نهاية النافذة) ويحرك الأرقام مع دوران التقويم الأسبوعي. الأحداث خارج
  // [بداية نافذة التقرير، نهايتها + 15 دقيقة] تُستبعد من الحجب بالكامل — الحد الأعلى
  // +15د يغطي حجب «قبل الخبر» للشمعة الأخيرة دون أي تسريب أبعد منه.
  const newsFloor = range?.fromT ?? c5[0].t;
  const newsHorizon = (range?.toT ?? endT) + 15 * 60e3;
  const newsWin = news.filter(n => n.t >= newsFloor && n.t <= newsHorizon);

  // ---- سجل قرارات الوكيل (نافذة آخر 24 ساعة) ----
  const LOG_WINDOW_MS = 24 * 3600e3;
  const CLOSE_LABELS: Record<Trade['result'], string> = {
    sl: 'الوقف ضُرب (ينفذ في أي وقت — القاعدة 12)',
    tp: 'الهدف تحقق',
    time: `سقف الاحتفاظ الزمني (القاعدة 4) — ${gr.max_hold_hours?.enabled ? `${gr.max_hold_hours.value ?? 8} ساعة` : 'معطل حالياً'}`,
    news: 'إغلاق مرتبط بالأخبار',
    dayend: 'إيقاف اليوم: حد الخسارة/الربح (القاعدتان 7 و8)',
    rule: 'خروج قاعدة الاستراتيجية (انعكاس الزخم/التقاطع/القناة — السلة المتحققة)',
  };
  const inLogWindow = (t: number): boolean => t >= endT - LOG_WINDOW_MS;
  const decisionLog: DecisionEntry[] = [];
  const loggedOnce = new Map<number, Set<string>>();
  const pushLog = (e: Omit<DecisionEntry, 'line' | 'syria'>): void => {
    decisionLog.push(formatDecisionLine(e));
    if (decisionLog.length > 800) decisionLog.splice(0, decisionLog.length - 800);
  };
  const logBlock = (cause: string, t: number, st?: { id: number; refLevel: number; strategy: StrategyId }): void => {
    if (!inLogWindow(t)) return;
    if (st) {
      let set = loggedOnce.get(st.id);
      if (!set) { set = new Set(); loggedOnce.set(st.id, set); }
      if (set.has(cause)) return;
      set.add(cause);
    }
    const cancel = CANCEL_CAUSES.has(cause);
    pushLog({
      t, level: st && Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null,
      setup: st && (st.strategy === 'A' || st.strategy === 'B') ? st.strategy as 'A' | 'B' : null,
      condition: BLOCK_REASON_LABELS[cause] ?? cause,
      decision: cancel ? 'إلغاء' : 'لا شيء',
      sl: null, tp: null,
      extra: cancel ? undefined : 'بانتظار إعادة المحاولة — الأمر لم يُلغَ',
    });
  };
  const logClose = (tr: Trade, atT: number): void => {
    if (!inLogWindow(atT)) return;
    pushLog({
      t: atT, level: null,
      setup: (tr.strategy === 'A' || tr.strategy === 'B') ? tr.strategy as 'A' | 'B' : null,
      condition: CLOSE_LABELS[tr.result],
      decision: 'إغلاق', sl: null, tp: null,
      extra: `خروج ${(tr.exit ?? 0).toFixed(2)} — النتيجة ${(tr.pnl ?? 0).toFixed(2)}$ (${(tr.r ?? 0).toFixed(2)}R)`,
    });
  };

  // ---- المستويات اليدوية (استراتيجية Z): أوامر مباشرة من المستخدم ----
  if (!range?.fromT && settings.manualLevels?.enabled && settings.manualLevels.levels.length) {
    const startT = c5[0].t;
    for (const lv of settings.manualLevels.levels) {
      if (!Number.isFinite(lv.price) || lv.price <= 0) continue;
      const slP = Math.min(Math.max(10, (lv.slDollars || 10) * 10 / (lot / 0.01)), capPips(Infinity)); // بالبيب — ضمن سقف القاعدة 12
      pending.push({
        id: setupId++,
        strategy: 'Z',
        dir: lv.dir,
        entry: lv.price,
        slPips: slP,
        tpPips: slP * 2,
        sl: lv.dir === 'buy' ? lv.price - pips(slP) : lv.price + pips(slP),
        tp: lv.dir === 'buy' ? lv.price + pips(slP) * 2 : lv.price - pips(slP) * 2,
        createdAt: startT,
        expiresAt: startT + 30 * 86400e3,
        session: 'asia',
        reason: `مستوى يدوي ${lv.dir === 'buy' ? 'شراء' : 'بيع'}${lv.note ? ` — ${lv.note}` : ''} (أمر مباشر من المستخدم)`,
        refLevel: lv.price,
      });
    }
  }

  for (let i = 0; i < c5.length; i++) {
    const bar = c5[i];
    const t = bar.t;
    const sess = currentSession(t);
    const warmup = !!(range?.fromT && t < range.fromT);

    // ---- بداية يوم دمشق جديد ----
    const dn = syriaDayNum(t);
    if (dn !== dayNumPrev) {
      dayNumPrev = dn;
      dayKey = new Date(dn * 86400e3).toISOString().slice(0, 10);
      dayTrades = 0; dayPnl = 0; dayStopped = null;
      stratDayFills.clear(); // عدّاد اليوم لكل استراتيجية (بوابة السبريد)
      stratSideDayFills.clear(); // عدّاد اليوم لكل (استراتيجية:جهة) — الاحتجاز الاتجاهي
    }

    // ---- بداية أسبوع جديد: تصفير صمام الخسارة الأسبوعية ----
    const wk = weekKey(t);
    if (wk !== weekNumPrev) {
      weekNumPrev = wk;
      weekPnl = 0;
      weekStopped = false;
    }

    const hSy = ((t + SYRIA_OFFSET_MS) % 86400e3) / 3600e3;

    // ---- إدخال الإشارات الجديدة المعروفة ----
    const newSetups: Setup[] = [];
    while (sigPtr.i < signals.length && signals[sigPtr.i].knownAt <= t) {
      const s = signals[sigPtr.i++];
      if (warmup) continue; // فترة التسخين — بلا تنفيذ
      signalsCount++;
      sigByStrat[s.strategy] = (sigByStrat[s.strategy] ?? 0) + 1;
      const st = signalToSetup(s, setupId++, sess ?? 'asia');
      newSetups.push(st);
    }
    if (newSetups.length) {
      // حل التعارضات (ص78–79): بروتوكول الدليل يعمل داخل عائلة TAMSA حصراً —
      // إشارات السلة المتحققة (W/X/Y/AA) معفاة: كاشفاتها محققة بمعزل عن الدليل
      // (المحاكاة المعتمدة نفذتها بلا بروتوكول الدليل)، وقمعها يُلغي حافتها.
      const basketSetups = newSetups.filter(n => BASKET_IDS.includes(n.strategy as never));
      const tamsaSetups = newSetups.filter(n => !BASKET_IDS.includes(n.strategy as never));
      const pool: (Setup & { rank: number })[] = tamsaSetups.map(n => ({ ...n, rank: rankOf(n.strategy, sess, n.scenario) }));
      const nearPips = 100; // حرفياً من الدليل (البند الأول: نفس الاتجاه والمنطقة)
      const protectSl = 50; // معادلة الوقف المحمي
      const oppositePips = 30; // البند الثالث: «في نفس المنطقة السعرية تماماً» — عتبة ضيقة
      const { kept, dropped } = resolveConflictsPdf(pool, nearPips, protectSl, oppositePips);
      pending.push(...kept.map(({ rank: _r, ...rest }) => rest as Setup));
      pending.push(...basketSetups);
      for (const d of dropped) { bump('conflict'); fillBlockedByStrat[d.setup.strategy] = (fillBlockedByStrat[d.setup.strategy] ?? 0) + 1; logBlock('conflict', t, d.setup as { id: number; refLevel: number; strategy: StrategyId }); }
    }

    // ---- إدارة الأوامر المعلقة ----
    const stillPending: Setup[] = [];
    for (const st of pending) {
      if (st.expiresAt <= t) { bump('expired'); fillBlockedByStrat[st.strategy] = (fillBlockedByStrat[st.strategy] ?? 0) + 1; logBlock('expired', t, st); consumeLevel(st.strategy, st.levelKey ?? ''); continue; }
      // إبطال بكسر عكسي: أغلق السعر عبر مستوى الوقف قبل الدخول
      const fresh = t - st.createdAt < TF_MS['5m'];
      if (!fresh) {
        if (st.dir === 'buy' && bar.c < st.sl) { bump('invalid'); fillBlockedByStrat[st.strategy] = (fillBlockedByStrat[st.strategy] ?? 0) + 1; logBlock('invalid', t, st); consumeLevel(st.strategy, st.levelKey ?? ''); continue; }
        if (st.dir === 'sell' && bar.c > st.sl) { bump('invalid'); fillBlockedByStrat[st.strategy] = (fillBlockedByStrat[st.strategy] ?? 0) + 1; logBlock('invalid', t, st); consumeLevel(st.strategy, st.levelKey ?? ''); continue; }
      }
      // القاعدة 19: الفرصة الفائتة — اقتراب ≤50 بيب دون لمس ثم انطلاق ≥100 بيب بالاتجاه
      // (لا تنطبق على أوامر السلة السوقية — تُنفذ فوراً على الافتتاح)
      const ghostOn = gr.ghost_entry.enabled && st.strategy !== 'Z' && !st.market;
      if (ghostOn) {
        const distPips = Math.abs(bar.c - st.entry) / PIP;
        const favorable = st.dir === 'buy' ? (bar.c - st.entry) / PIP : (st.entry - bar.c) / PIP;
        if (distPips <= (gr.ghost_entry.value ?? 50)) st.bestApproach = Math.min(st.bestApproach ?? 9999, distPips);
        if ((st.bestApproach ?? 9999) <= (gr.ghost_entry.value ?? 50) && favorable >= (gr.ghost_run_pips?.value ?? 100)) {
          bump('ghost'); fillBlockedByStrat[st.strategy] = (fillBlockedByStrat[st.strategy] ?? 0) + 1; logBlock('ghost', t, st); consumeLevel(st.strategy, st.levelKey ?? ''); continue;
        }
      }
      stillPending.push(st);
    }
    pending = stillPending;

    // ---- إدارة الصفقات المفتوحة ----
    if (openTrades.length) {
      // 1) وقف أو هدف (الوقف أولاً تحفظاً — القاعدة 12) — tpPips=0 يعني بلا هدف (السلة)
      for (const tr of [...openTrades]) {
        if (tr.dir === 'buy') {
          if (bar.l <= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (tr.tpPips > 0 && bar.h >= tr.tp) doClose(tr, tr.tp, 'tp', t);
        } else {
          if (bar.h >= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (tr.tpPips > 0 && bar.l <= tr.tp) doClose(tr, tr.tp, 'tp', t);
        }
      }
      // 1.5) خروج القاعدة لمكونات السلة المتحققة: قرار من آخر شمعة ساعية مكتملة
      if (openTrades.length && bar.t % TF_MS['1h'] === TF_MS['1h'] - TF_MS['5m']) {
        const hIdx = hourIdxAt(bar.t);
        if (hIdx >= 0) {
          for (const tr of [...openTrades]) {
            if (t - tr.entryT < minHoldMs) continue;
            const buy = tr.dir === 'buy';
            let exitRule = false;
            let why = '';
            if (tr.strategy === 'W') {
              // TSMOM-30d: الخروج بانعكاس زخم الأفق (حرفياً من المحاكاة المعتمدة)
              const ms2 = momSign[hIdx];
              if (ms2 !== 0 && ((buy && ms2 < 0) || (!buy && ms2 > 0))) { exitRule = true; why = 'انعكاس زخم 30 يوماً'; }
            } else if (tr.strategy === 'X') {
              // Ogle: كسر EMA البطيء ضد الصفقة أو تجاوز أقصى احتفاظ 120 ساعة
              const e = eXSlow[hIdx];
              if (Number.isFinite(e) && ((buy && bar.c < e) || (!buy && bar.c > e))) { exitRule = true; why = 'كسر EMA البطيء'; }
              else if (t - tr.entryT >= X_MAX_HOLD_HOURS * 3600e3) { exitRule = true; why = 'أقصى احتفاظ 120 ساعة'; }
            } else if (tr.strategy === 'Y') {
              // EWMAC: انعكاس تقاطع EMA 32/128 ضد الصفقة
              if (Number.isFinite(eYFast[hIdx]) && Number.isFinite(eYSlow[hIdx]) && ((buy && eYFast[hIdx] < eYSlow[hIdx]) || (!buy && eYFast[hIdx] > eYSlow[hIdx]))) { exitRule = true; why = 'انعكاس تقاطع EWMAC'; }
            } else if (tr.strategy === 'AA') {
              // دونشييان: كسر قناة الخروج 60 ساعة ضد الصفقة
              const lo60 = donExitLo[hIdx], hi60 = donExitHi[hIdx];
              if (Number.isFinite(lo60) && ((buy && bar.c < lo60) || (!buy && bar.c > hi60))) { exitRule = true; why = 'كسر قناة دونشييان للخروج'; }
            }
            if (exitRule) doClose(tr, bar.c, 'rule', t);
            void why;
          }
        }
      }
      // 2) القاعدة 20: بروتوكول حماية وتأمين الأرباح (الحالتان) — لعائلة TAMSA حصراً.
      // السلة المتحققة (W/X/Y/AA) تُستثنى: التأمين المبكر (+50 بيب = 5$) يغلق ركّاب
      // الترند عند أول ارتداد، والمحاكاة المعتمدة (TP 12×ATR + خروج القاعدة) بلا تأمين.
      if (gr.break_even.enabled && openTrades.some(o => !BASKET_IDS.includes(o.strategy as never))) {
        for (const tr of openTrades) if (BASKET_IDS.includes(tr.strategy as never)) continue;
        const be1 = gr.be_case1?.enabled ? (gr.be_case1.value ?? 50) : Infinity;   // التأمين الصفري
        const be2 = gr.be_case2?.enabled ? (gr.be_case2.value ?? 100) : Infinity;  // التأمين المتقدم
        const lockPips = gr.be_lock_pips?.value ?? 50;
        for (const tr of openTrades) {
          if (BASKET_IDS.includes(tr.strategy as never)) continue; // السلة: بلا تأمين مبكر (كما تحققت)
          const profitPips = tr.dir === 'buy' ? (bar.h - tr.entry) / PIP : (tr.entry - bar.l) / PIP;
          const beMark = profitPips >= be2 && be2 !== Infinity ? 'lock' : profitPips >= be1 && be1 !== Infinity ? 'be' : null;
          if (!beMark) continue;
          if (beMark === 'be') {
            const newSl = tr.entry;
            const improved = tr.dir === 'buy' ? newSl > tr.sl : newSl < tr.sl;
            if (improved) tr.sl = newSl; // سحب الوقف لنقطة الدخول الصفرية
          } else {
            const lockPrice = tr.dir === 'buy' ? tr.entry + pips(lockPips) : tr.entry - pips(lockPips);
            const improved = tr.dir === 'buy' ? lockPrice > tr.sl : lockPrice < tr.sl;
            if (improved) tr.sl = lockPrice; // حجز ربح مؤمن
          }
        }
      }
      // 3) القاعدة 4: سقف الاحتفاظ الزمني — خروج وقائي صارم قبل التجاوز.
      // الإغلاق على إغلاق آخر شمعة ما زالت الصفقة ضمن السقف: لو انتظرنا أول شمعة
      // بعد التجاوز لانزلقت الصفقة عبر فجوة يومية أو عطلة نهاية الأسبوع إلى أيام
      // فوق السقف. بهذا لا تبقى أي صفقة مفتوحة أكثر من السقف المحدد أبداً
      // (وإغلاق الجمعة الأخيرة يجنب صفقات الخميس/الجمعة فجوة الاثنين).
      if (openTrades.length) {
        const maxH = gr.max_hold_hours.enabled ? (gr.max_hold_hours.value ?? 8) : Infinity;
        if (maxH !== Infinity) {
          const nextT = i + 1 < c5.length ? c5[i + 1].t : endT;
          const capMs = maxH * 3600e3;
          for (const tr of [...openTrades]) {
            if (t - tr.entryT >= minHoldMs && nextT - tr.entryT >= capMs) doClose(tr, bar.c, 'time', t);
          }
        }
      }
      // 4) القاعدتان 7 و8 + الصمام اليومي النسبي: أضيق الحدين هو الحاكم
      if (openTrades.length) {
        let floating = 0;
        for (const tr of openTrades) floating += (tr.dir === 'buy' ? bar.c - tr.entry : tr.entry - bar.c) * (tr.lot / 0.01);
        const equityPnl = dayPnl + floating;
        // الإغلاق القسري للصفقات المفتوحة: القاعدة 7 المطلقة حصراً (50$) — حرفياً من الدليل
        const lossAbs = gr.daily_loss_stop.enabled ? (gr.daily_loss_stop.value ?? 50) : Infinity;
        const profitStop = gr.daily_profit_stop.enabled ? (gr.daily_profit_stop.value ?? 200) : Infinity;
        if (equityPnl <= -lossAbs || equityPnl >= profitStop) {
          dayStopped = equityPnl <= -lossAbs ? 'loss' : 'profit';
          for (const tr of [...openTrades]) doClose(tr, bar.o, 'dayend', t);
          stoppedDays.add(dayKey);
        }
      }
    }

    // ---- تقييم الصمامات الثلاثة كل شمعة بلا استثناء (بصفقات أو بدونها) ----
    // الصمام اليومي 3% والأسبوعي 6%: منع الدخول الجديد فقط — الصفقات المفتوحة تبقى
    // محكومة بوقفها وهدفها (حرفياً كالمحاكاة المعتمدة التي لا تُغلق مواضع قسراً).
    // صمام الإيكويتي 50%: حاجز كارثة فقط — عُبّر عنه نسبةً لقمة الإيكويتي، والعتبة
    // أبعد من أقصى تراجع متحقق للسلة (45.2% في سنتين) فلا تمس السلوك المتحقق أبداً.
    // الإصلاح الجوهري: التقييم كان سابقاً داخل كتلة الصفقات المفتوحة فقط فتجمّد الحالة
    // بعد زوال الصفقات ولا تتعافى أبداً. الآن: إيكويتي = الرصيد + العائم كل شمعة،
    // والعدّ يُحتسب عند الانتقال للحالة (وليس كل شمعة).
    {
      let floatingAll = 0;
      for (const tr of openTrades) floatingAll += (tr.dir === 'buy' ? bar.c - tr.entry : tr.entry - bar.c) * (tr.lot / 0.01);
      const eqNowAll = balance + floatingAll;
      if (fuseEquityPct !== null) {
        eqPeak = Math.max(eqPeak, eqNowAll);
        const nowHalted = eqPeak > 0 && ((eqPeak - eqNowAll) / eqPeak) * 100 >= fuseEquityPct;
        if (nowHalted && !equityHalted) fuseTrips.equity++;
        equityHalted = nowHalted;
      }
      if (fuseWeeklyPct !== null && !weekStopped && (weekPnl + floatingAll) <= -(fuseWeeklyPct / 100) * baseBalance) {
        if (!weekStopped) fuseTrips.weekly++;
        weekStopped = true;
      }
      const wasDayFuse = dayFuseBlocked;
      dayFuseBlocked = fuseDailyPct !== null && (dayPnl + floatingAll) <= -(fuseDailyPct / 100) * baseBalance;
      if (dayFuseBlocked && !wasDayFuse) fuseTrips.daily++;
    }

    // ---- محاولة تنفيذ الأوامر المعلقة (أوامر حد عند سعر الاقتراب المحدد) ----
    if (!warmup && pending.length && sess && openTrades.length < maxConcurrent && (!range?.toT || t <= range.toT)) {
      // القاعدة 21: الترتيب بسلم أولويات الجلسة النشطة ثم الأقدم
      pending.sort((a, b) => rankOf(a.strategy, sess, a.scenario) - rankOf(b.strategy, sess, b.scenario) || a.createdAt - b.createdAt);
      const filledNow = new Set<number>();
      const cancelIds = new Set<number>();
      for (const st of [...pending]) {
        if (filledNow.has(st.id) || cancelIds.has(st.id)) continue;
        // القاعدة 10 على مستوى العائلتين (المعمارية المتحققة):
        // • عائلة TAMSA (A–R): صفقة نشطة واحدة للعائلة كلها — حرفياً كما تحقق خط الأساس (+19$ بعينة 11 صفقة)
        // • السلة المعتمدة (W/X/Y/AA): صفقة واحدة لكل مكوّن — التوازي بين المكوّنات هو مصدر التنويع في المحاكاة
        const tamsaTradeOpen = openTrades.some(o => !BASKET_IDS.includes(o.strategy as never));
        if (!BASKET_IDS.includes(st.strategy as never) && tamsaTradeOpen) { bump('single'); logBlock('single', t, st); continue; }
        if (openTrades.some(o => o.strategy === st.strategy)) { bump('single'); logBlock('single', t, st); continue; }
        // سقف التزامن العام (max_concurrent): امتلأت السعة → لا جديد إطلاقاً
        if (openTrades.length >= maxConcurrent) { bump('concurrent'); logBlock('concurrent', t, st); break; }

        // بروتوكول الجلسات: الأمر المعلق يُلغى فور خروجه من جلساته المسموحة (M/O/Q/D: «يُلغى ويُجمّد بمجرد انتهاء الجلسة»)
        if (st.allowedSessions && !st.allowedSessions.includes(sess)) {
          if (st.levelKey) consumeLevel(st.strategy, st.levelKey);
          cancelIds.add(st.id);
          if (inLogWindow(t)) pushLog({ t, level: Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null, setup: null, condition: 'انتهت جلسة البند المسموحة — إلغاء الأمر المعلق وتجميده', decision: 'إلغاء', sl: null, tp: null, extra: 'protocol:session-end' });
          continue;
        }

        // فلاتر القواعد العليا (المستوى الأول في التسلسل الهرمي)
        // بروتوكول «الفرصة الفائتة»: اقتراب المستوى أثناء الحظر → إتلاف المستوى نهائياً (E/F/N/O/P/Q/R/C)
        if (gr.max_daily_trades.enabled && dayTrades >= (gr.max_daily_trades.value ?? 50)) { bump('maxTrades'); logBlock('maxTrades', t, st); continue; }
        if (dayStopped) { bump('dayStop'); logBlock('dayStop', t, st); continue; }
        if (dayFuseBlocked) { bump('dayFuse'); logBlock('dayFuse', t, st); continue; }
        if (weekStopped) { bump('weeklyStop'); logBlock('weeklyStop', t, st); continue; }
        if (equityHalted) { bump('equityFloor'); logBlock('equityFloor', t, st); continue; }
        if (gr.news_filter.enabled) {
          const n = newsBlock(t, newsWin, beforeMin, afterMin);
          if (n) { bump('news'); logBlock('news', t, st); if (st.levelKey) consumeLevel(st.strategy, st.levelKey); cancelIds.add(st.id); continue; }
        }
        // القاعدة 15: حظر أول 30 دقيقة من افتتاح يوم التداول (01:00 دمشق)
        if (gr.market_open_filter.enabled) {
          const m = (hSy - 1) * 60 + Math.floor((t % 3600e3) / 60e3);
          if (hSy >= 1 && hSy < 2 && m >= 0 && m < (gr.market_open_filter.value ?? 30)) { bump('openFilter'); logBlock('openFilter', t, st); if (st.levelKey) consumeLevel(st.strategy, st.levelKey); cancelIds.add(st.id); continue; }
        }
        // القاعدة 16: حظر آخر 60 دقيقة قبل الإغلاق (22:00–23:00 دمشق)
        if (gr.market_close_filter.enabled) {
          const m = hSy * 60;
          if (m >= 23 * 60 - (gr.market_close_filter.value ?? 60) && m < 23 * 60) { bump('closeFilter'); logBlock('closeFilter', t, st); if (st.levelKey) consumeLevel(st.strategy, st.levelKey); cancelIds.add(st.id); continue; }
        }
        // القاعدة 11: حظر الاستاكنج والهيدج
        if (gr.no_stacking_hedge.enabled && openTrades.some(o => o.strategy === st.strategy && o.dir === st.dir)) { bump('stacking'); logBlock('stacking', t, st); continue; }

        // القاعدة 31: الاحتجاز الاتجاهي — الطرف المزمن الخاسر (PF تراكمي دون العتبة) صفقة واحدة يومياً من ذلك الطرف
        const sideKey = `${st.strategy}:${st.dir}`;
        if (onSideProbation(st.strategy, st.dir)) {
          const done = stratSideDayFills.get(sideKey) ?? 0;
          if (done >= 1) {
            bump('sideGuard');
            sideGuardByStrat[st.strategy] = (sideGuardByStrat[st.strategy] ?? 0) + 1;
            logBlock('sideGuard', t, st);
            continue;
          }
        }
        // القاعدة 32: بوابة الانحسار الزمني — PF آخر 90 يوماً دون 1.00 بعينة ≥ 50 → صفقة واحدة يومياً حتى تعافي النافذة
        if (onDecayProbation(st.strategy, t)) {
          const done = stratDayFills.get(st.strategy) ?? 0;
          if (done >= 1) {
            bump('decayGuard');
            decayGuardByStrat[st.strategy] = (decayGuardByStrat[st.strategy] ?? 0) + 1;
            logBlock('decayGuard', t, st);
            continue;
          }
        }

        // بوابة السبريد (خطة التحويل — القاعدة 2): المحتجَز يُنفّذ صفقة واحدة يومياً كحد أقصى
        if (onSpreadProbation(st.strategy)) {
          const done = stratDayFills.get(st.strategy) ?? 0;
          if (done >= 1) { bump('spreadGuard'); fillBlockedByStrat[st.strategy] = (fillBlockedByStrat[st.strategy] ?? 0) + 1; logBlock('spreadGuard', t, st); continue; }
        }

        // التنفيذ: أوامر السلة المتحققة (market) تنفَّذ ماركت على افتتاح أول شمعة بعد الإشارة
        // — حرفياً باصطلاح المحاكاة المعتمدة «إشارة على إغلاق i → دخول على افتتاح i+1».
        // بقية الاستراتيجيات: أمر حد عند سعر الاقتراب المحدد بالإشارة.
        let fillPrice: number | null = null;
        if (st.market) {
          if (bar.t >= st.createdAt) fillPrice = bar.o;
        } else if (st.dir === 'buy') {
          if (bar.o <= st.entry) fillPrice = bar.o;
          else if (bar.l <= st.entry) fillPrice = st.entry;
        } else {
          if (bar.o >= st.entry) fillPrice = bar.o;
          else if (bar.h >= st.entry) fillPrice = st.entry;
        }
        if (fillPrice === null) continue;

        // الأرقام من الإشارة + سقف القاعدة 12 (قرار المالك: الستوب 15$ حداً أقصى):
        // أي وقف فني أوسع من السقف يُشدّ إلى السقف من سعر التنفيذ الفعلي لحظة الفتح
        const slPipsFinal = capPips(st.slPips);
        const slPrice = st.dir === 'buy' ? fillPrice - pips(slPipsFinal) : fillPrice + pips(slPipsFinal);
        const tpPrice = st.tpPips > 0
          ? (st.dir === 'buy' ? fillPrice + pips(st.tpPips) : fillPrice - pips(st.tpPips))
          : fillPrice; // بلا هدف (مكونات السلة) — القيمة الرمزية لا تُفحص (tpPips=0)

        // القاعدة 33: تحجيم الجودة — اللوت المضاعف للسلة السبعة السليمة النافذة (قرار لحظة التنفيذ — سببي)
        // + بوابة وعي المخاطرة: التضخيم فقط عندما يكون التراجع عن قمة الإيكويتي دون BOOST_DD_MAX%
        let boostOk = false;
        if (qualityBoost(st.strategy, t)) {
          let floatingNow = 0;
          for (const o of openTrades) floatingNow += (o.dir === 'buy' ? bar.c - o.entry : o.entry - bar.c) * (o.lot / 0.01);
          const eqNow = balance + floatingNow;
          const ddNow = eqPeak > 0 ? ((eqPeak - eqNow) / eqPeak) * 100 : 0;
          boostOk = ddNow < BOOST_DD_MAX;
        }
        const trLot = boostOk ? boostLot : lot;
        if (trLot > lot) {
          boostedFills++;
          boostedByStrat[st.strategy] = (boostedByStrat[st.strategy] ?? 0) + 1;
        }
        const tr: Trade = {
          id: tradeId++, strategy: st.strategy, case: st.case, scenario: st.scenario, dir: st.dir,
          entryT: t, exitT: 0, entry: fillPrice, exit: 0,
          sl: slPrice, tp: st.tpPips > 0 ? tpPrice : 0, slPips: slPipsFinal, tpPips: st.tpPips,
          result: 'tp', pnl: 0, session: sess, reason: st.reason,
          lot: trLot,
        };
        (tr as Trade & { levelKey?: string }).levelKey = st.levelKey;
        openTrades.push(tr);
        dayTrades++; dayTraded.add(dayKey); dayWith1Plus.add(dayKey);
        stratDayFills.set(st.strategy, (stratDayFills.get(st.strategy) ?? 0) + 1); // عدّاد بوابة السبريد
        if (inLogWindow(t)) pushLog({
          t, level: Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null,
          setup: (st.strategy === 'A' || st.strategy === 'B') ? st.strategy as 'A' | 'B' : null,
          condition: `اكتملت شروط ${st.strategy}${st.case ? ` (${st.case})` : ''} س${st.scenario ?? 1} — تنفيذ ماركت عند سعر الاقتراب ${fillPrice.toFixed(2)}`,
          decision: 'دخول', sl: slPrice, tp: st.tpPips > 0 ? tpPrice : null,
          extra: st.tpPips > 0 ? undefined : `وقف ${slPrice.toFixed(2)} — بلا هدف ثابت: الخروج بقاعدة الاستراتيجية`,
        });
        filledNow.add(st.id);
      }
      if (filledNow.size || cancelIds.size) pending = pending.filter(x => !filledNow.has(x.id) && !cancelIds.has(x.id));
    }
  }
  void dailyTarget; // (هدف الالتزام اليومي يُستهلك في buildStats)

  // إغلاق أي صفقة عالقة بالنهاية
  for (const tr of [...openTrades]) {
    const last = c5[c5.length - 1];
    tr.exit = last.c; tr.exitT = last.t + TF_MS['5m']; tr.result = 'time';
    tr.pnl = tradePnl(tr.dir, tr.entry, tr.exit, tr.lot, spreadCents);
    const riskD = Math.abs(tr.entry - tr.sl) * (tr.lot / 0.01);
    tr.r = riskD > 0 ? Math.round(tr.pnl / riskD * 100) / 100 : 0;
    balance += tr.pnl;
    trades.push(tr);
    const hist = stratPnlHist.get(tr.strategy) ?? [];
    hist.push(tr.pnl);
    stratPnlHist.set(tr.strategy, hist);
    pushClosed(tr); // اتساق التاريخ حتى مع الإغلاق النهائي
    logClose(tr, tr.exitT);
  }
  openTrades.length = 0;

  // ---------- التقارير ----------
  // شفافية بوابا خطة التحويل: إشارات قتيلة عند التوليد تُدمج في أسباب الحظر + توزيعها لكل استراتيجية
  const gateBlockedByStrat: { dailyTrend: Record<string, number>; erQuiet: Record<string, number> } = { dailyTrend: gateStats.dailyTrend, erQuiet: gateStats.erQuiet };
  for (const v of Object.values(gateStats.dailyTrend)) blocked['dailyTrend'] = (blocked['dailyTrend'] ?? 0) + v;
  for (const v of Object.values(gateStats.erQuiet)) blocked['erQuiet'] = (blocked['erQuiet'] ?? 0) + v;

  const stats = buildStats(trades, {
    startT: c5[0].t, endT, baseBalance, finalBalance: balance,
    spreadCents, lot, tpRatio: 2, signalsCount, fillsBlocked,
    settings, emaState: emaStateAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow),
    dayTraded, dayWith1Plus, stoppedDays,
    blocked,
    sigByStrat, fillBlockedByStrat,
    gateBlockedByStrat,
    adaptiveGates: { sideGuard: sideGuardByStrat, decayGuard: decayGuardByStrat, boostedFills, boostedByStrat },
    dailyTarget,
    fuseTrips,
  });

  const s1h = cache.struct1h!, s4h = cache.struct4h!;
  const lastRP1 = s1h.realPivots[s1h.realPivots.length - 1];
  const lastRP2 = s1h.realPivots[s1h.realPivots.length - 2];
  const finalPending = pending
    .slice()
    .sort((a, b) => rankOf(a.strategy, currentSession(endT), a.scenario) - rankOf(b.strategy, currentSession(endT), b.scenario) || a.createdAt - b.createdAt)
    .slice(0, 40)
    .map(st => ({
      strategy: st.strategy as string,
      case: st.case ?? null,
      scenario: st.scenario ?? (1 as const),
      dir: st.dir,
      entry: st.entry,
      sl: st.dir === 'buy' ? st.entry - pips(capPips(st.slPips)) : st.entry + pips(capPips(st.slPips)),
      tp: st.tpPips > 0 ? (st.dir === 'buy' ? st.entry + pips(st.tpPips) : st.entry - pips(st.tpPips)) : 0,
      tpPips: st.tpPips,
      session: st.session as string,
      reason: st.reason,
      expiresAt: st.expiresAt, createdAt: st.createdAt,
    }));
  return {
    trades,
    stats,
    finalStructure: {
      trend1h: trendAtTime(s1h.trendTimeline, endT),
      trend4h: trendAtTime(s4h.trendTimeline, endT),
      lastRealHigh: [lastRP1, lastRP2].filter(p => p && (p.kind === 'HH' || p.kind === 'LH')).map(p => ({ kind: p.kind, price: p.price, t: p.t }))[0],
      lastRealLow: [lastRP1, lastRP2].filter(p => p && (p.kind === 'LL' || p.kind === 'HL')).map(p => ({ kind: p.kind, price: p.price, t: p.t }))[0],
      lastEvents: s1h.events.slice(-8).map(e => ({ type: e.type, dir: e.dir, level: e.level, t: e.t })),
    },
    finalPending,
    decisionLog,
    emaDirNow: emaStateAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow),
    sessionNow: currentSession(endT),
  };
}

function trendAtTime(tl: { t: number; trend: Dir }[], t: number): Dir {
  let d: Dir = 'range';
  for (const p of tl) { if (p.t <= t) d = p.trend; else break; }
  return d;
}

/** أدنى قيمة في النافذة السابقة الحصرية [i-n, i-1] لكل موضع (deque رتيب — O(n)) */
// حرفياً كمحاكاة السلة: roll_min(vals, n, i) = min(vals[i-n:i]) — الشمعة الحالية مستبعدة
function slidingMin(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (i >= n && dq.length) out[i] = vals[dq[0]];
    while (dq.length && vals[dq[dq.length - 1]] >= vals[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
  }
  return out;
}

/** أعلى قيمة في النافذة السابقة الحصرية [i-n, i-1] لكل موضع (deque رتيب — O(n)) */
function slidingMax(vals: number[], n: number): number[] {
  const out = new Array<number>(vals.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (i >= n && dq.length) out[i] = vals[dq[0]];
    while (dq.length && vals[dq[dq.length - 1]] <= vals[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
  }
  return out;
}

function weekKey(t: number): number {
  const d = new Date(t + SYRIA_OFFSET_MS);
  const day = d.getUTCDay(); // 0=الأحد
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((day + 6) % 7) * 86400e3;
  return monday;
}

function buildStats(trades: Trade[], ctx: {
  startT: number; endT: number; baseBalance: number; finalBalance: number;
  spreadCents: number; lot: number; tpRatio: number; signalsCount: number; fillsBlocked: number;
  sigByStrat?: Record<string, number>; fillBlockedByStrat?: Record<string, number>;
  settings: Settings; emaState: Dir;
  dayTraded: Set<string>; dayWith1Plus: Set<string>; stoppedDays: Set<string>;
  blocked: Record<string, number>;
  dailyTarget: number;
  fuseTrips?: { daily: number; weekly: number; equity: number };
  gateBlockedByStrat?: { dailyTrend: Record<string, number>; erQuiet: Record<string, number> };
  adaptiveGates?: {
    sideGuard: Record<string, number>;
    decayGuard: Record<string, number>;
    boostedFills: number;
    boostedByStrat: Record<string, number>;
  };
}): BacktestStats {
  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const grossWin = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));

  // منحنى الرصيد وأقصى تراجع
  let peak = ctx.baseBalance, maxDD = 0;
  let bal = ctx.baseBalance;
  const equityAll: { t: number; v: number }[] = [{ t: ctx.startT, v: ctx.baseBalance }];
  for (const tr of trades) {
    bal += tr.pnl;
    peak = Math.max(peak, bal);
    maxDD = Math.max(maxDD, peak - bal);
    equityAll.push({ t: tr.exitT, v: bal });
  }
  // تصغير المنحنى — الحفاظ على أول وآخر نقطة وأطراف التراجع
  const MAX_EQ_PTS = 700;
  let equity = equityAll;
  if (equityAll.length > MAX_EQ_PTS) {
    const step = Math.ceil(equityAll.length / (MAX_EQ_PTS - 1));
    equity = [];
    for (let i = 0; i < equityAll.length - 1; i += step) equity.push(equityAll[i]);
    equity.push(equityAll[equityAll.length - 1]);
  }

  // العينة الخارجية: آخر 30% من الفترة
  const midT = ctx.startT + (ctx.endT - ctx.startT) * 0.7;
  const oosTrades = trades.filter(t => t.entryT >= midT);
  const oosWins = oosTrades.filter(t => t.pnl > 0).length;
  const oosWR = oosTrades.length ? oosWins / oosTrades.length * 100 : 0;
  const oosAvgR = oosTrades.length
    ? oosTrades.reduce((a, t) => a + (t.pnl / Math.max(0.01, Math.abs(t.entry - t.sl) * (t.lot / 0.01))), 0) / oosTrades.length
    : 0;
  // لا بوابة نشر في القواعد العليا الـ21 — الأرقام تُعرض كما هي
  const gateEnabled = false;
  const gateThreshold = 70;
  const gatePass = true;

  // مؤشر الالتزام اليومي (القاعدة 6: صفقة واحدة على الأقل)
  const activeDays = [...ctx.dayTraded].filter(d => !ctx.stoppedDays.has(d));
  const days2Plus = [...ctx.dayWith1Plus].filter(d => !ctx.stoppedDays.has(d));

  // أسبوعي وشهري على الرصيد الثابت
  const weekMap = new Map<number, number>();
  const monthMap = new Map<string, number>();
  for (const tr of trades) {
    const wk = weekKey(tr.entryT);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + tr.pnl);
    const mk = new Date(tr.entryT + SYRIA_OFFSET_MS).toISOString().slice(0, 7);
    monthMap.set(mk, (monthMap.get(mk) ?? 0) + tr.pnl);
  }
  const weekly = [...weekMap.entries()].sort((a, b) => a[0] - b[0]).map(([w, net]) => ({ weekStart: w, net, pct: net / ctx.baseBalance * 100 }));
  const monthly = [...monthMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([m, net]) => ({ month: m, net, pct: net / ctx.baseBalance * 100 }));

  // مصفوفة استراتيجية × جلسة
  const matrix: Record<string, Record<string, { net: number; wins: number; losses: number; trades: number; winRate: number }>> = {};
  const totals: Record<string, { net: number; trades: number; wins: number; losses: number; pnlBySession: Record<string, number> }> = {};
  const sessions: SessionId[] = ['asia', 'london', 'londonNY', 'ny'];
  for (const s of Object.keys(STRATEGY_NAMES) as StrategyId[]) {
    matrix[s] = {};
    totals[s] = { net: 0, trades: 0, wins: 0, losses: 0, pnlBySession: {} };
    for (const sess of sessions) matrix[s][sess] = { net: 0, wins: 0, losses: 0, trades: 0, winRate: 0 };
  }
  for (const tr of trades) {
    const m = matrix[tr.strategy][tr.session];
    m.net += tr.pnl; m.trades++;
    if (tr.pnl > 0) m.wins++; else m.losses++;
    m.winRate = m.trades ? m.wins / m.trades * 100 : 0;
    const tt = totals[tr.strategy];
    tt.net += tr.pnl; tt.trades++;
    if (tr.pnl > 0) tt.wins++; else tt.losses++;
    tt.pnlBySession[tr.session] = (tt.pnlBySession[tr.session] ?? 0) + tr.pnl;
  }

  const spanWeeks = Math.max(1, weekly.length);
  const spanMonths = Math.max(1, monthly.length);
  const strategyTotals: BacktestStats['strategyTotals'] = {};
  for (const s of Object.keys(totals)) {
    const tt = totals[s];
    let best: string | null = null, worst: string | null = null;
    const withPnl = sessions.filter(x => tt.pnlBySession[x] !== undefined);
    if (withPnl.length) {
      best = withPnl.reduce((a, b) => tt.pnlBySession[a] >= tt.pnlBySession[b] ? a : b);
      worst = withPnl.reduce((a, b) => tt.pnlBySession[a] <= tt.pnlBySession[b] ? a : b);
    }
    strategyTotals[s] = {
      net: tt.net, trades: tt.trades, wins: tt.wins, losses: tt.losses,
      winRate: tt.trades ? tt.wins / tt.trades * 100 : 0,
      weeklyAvgPct: tt.net / ctx.baseBalance * 100 / spanWeeks,
      monthlyAvgPct: tt.net / ctx.baseBalance * 100 / spanMonths,
      bestSession: best ? SESSION_AR[best as SessionId] : null,
      worstSession: worst ? SESSION_AR[worst as SessionId] : null,
    };
  }
  const ranking = (Object.keys(strategyTotals) as StrategyId[])
    .map(s => ({ strategy: s, net: strategyTotals[s].net, winRate: strategyTotals[s].winRate, trades: strategyTotals[s].trades }))
    .sort((a, b) => b.net - a.net);

  return {
    startT: ctx.startT, endT: ctx.endT,
    totalTrades: trades.length, wins, losses,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    netPnl: ctx.finalBalance - ctx.baseBalance,
    finalBalance: ctx.finalBalance, baseBalance: ctx.baseBalance,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    maxDrawdown: maxDD, maxDrawdownPct: maxDD / ctx.baseBalance * 100,
    oos: { trades: oosTrades.length, winRate: oosWR, avgR: oosAvgR, gatePass, gateEnabled, threshold: gateThreshold, minTrades: 100 },
    dailyKpi: {
      daysTraded: activeDays.length,
      daysWith2Plus: days2Plus.length,
      pct: activeDays.length ? days2Plus.length / activeDays.length * 100 : 0,
      excludedStopDays: ctx.stoppedDays.size,
      target: ctx.dailyTarget,
    },
    weekly, monthly, matrix, strategyTotals, ranking,
    emaEnabled: ctx.settings.indicators.ema, emaState: ctx.emaState,
    spreadCents: ctx.spreadCents, lot: ctx.lot, tpRatio: ctx.tpRatio,
    generatedAt: Date.now(),
    signalsCount: ctx.signalsCount, fillsBlocked: ctx.fillsBlocked,
    blocked: ctx.blocked,
    sigByStrat: ctx.sigByStrat, fillBlockedByStrat: ctx.fillBlockedByStrat,
    gateBlockedByStrat: ctx.gateBlockedByStrat,
    adaptiveGates: ctx.adaptiveGates,
    railHits: { maxTrades: 0, dailyLoss: ctx.fuseTrips?.daily ?? 0, lotClamp: 0, concurrent: 0 },
    fuseTrips: ctx.fuseTrips ?? { daily: 0, weekly: 0, equity: 0 },
    sizing: { mode: 'fixed', riskPct: 0 }, avgScore: 0,
    totalR: Math.round(trades.reduce((a, t) => a + (t.r ?? 0), 0) * 100) / 100,
    avgR: trades.length ? Math.round(trades.reduce((a, t) => a + (t.r ?? 0), 0) / trades.length * 1000) / 1000 : 0,
    equity,
  };
}

export function getCachedStructure() {
  return { struct1h: cache.struct1h, struct4h: cache.struct4h, struct1d: cache.struct1d, cons: cache.cons, data: cache.data };
}

/** مجس تشخيصي: حالة إشارات الكاش وبيانات المحرك */
export function debugSignals(): {
  cached: number; hasData: boolean; c5len?: number; c15len?: number;
  c5first?: number; c5last?: number;
  c5disordered?: number; c15disordered?: number;
  c5lo?: number; c5hi?: number; c15first?: number; c15last?: number;
} {
  let cached = -1;
  if (cache.signals) for (const v of cache.signals.values()) { cached = v.sig.length; break; }
  const data = cache.data;
  if (!data) return { cached, hasData: false };
  let dis5 = 0, dis15 = 0;
  for (let i = 1; i < data.c5.length; i++) if (data.c5[i].t <= data.c5[i - 1].t) dis5++;
  for (let i = 1; i < data.c15.length; i++) if (data.c15[i].t <= data.c15[i - 1].t) dis15++;
  return {
    cached, hasData: true,
    c5len: data.c5.length, c15len: data.c15.length,
    c5first: data.c5[0]?.t, c5last: data.c5[data.c5.length - 1]?.t,
    c5disordered: dis5, c15disordered: dis15,
    c5lo: data.c5[0].l, c5hi: data.c5[data.c5.length - 1].h,
    c15first: data.c15[0]?.t, c15last: data.c15[data.c15.length - 1]?.t,
  };
}

/** حالة السوق اللحظية (للتشغيل الحي) */
export function marketStateNow(_data: EngineData, _t: number): { atrPct: number | null; rng6hPips: number | null } {
  // فلاتر الريجيم والسوق الراكدة غير موجودة في القواعد العليا الـ21 — أُزيلت بأمر المالك
  return { atrPct: null, rng6hPips: null };
}

/** تفريغ ذاكرة التحليل المسبق — تُستدعى عند وصول بيانات حقيقية أحدث من الجسر */
export function resetEngineCache() {
  cache.data = undefined;
  cache.struct1h = undefined;
  cache.struct4h = undefined;
  cache.fib = undefined;
  cache.cons = undefined;
  cache.usLevels = undefined;
  cache.preTrend = undefined;
  cache.signals = undefined;
  cache.ema4h = undefined;
  cache.ema1d = undefined;
  resetTamsaState();
}

// ------------------------------------------------------------
// التقاط الكاش وتبنيه ذرياً — أساس كاش الباك تيست الدائم:
// باك تيست سنة منتهية بياناتها ثابتة، فتُبنى التحليلات مرة واحدة
// وتُخزَّن لقطة كاملة، وكل استدعاء لاحق يتبنى اللقطة في عملية
// متزامنة واحدة (لا تقاطع مع بقية الطلبات) ثم يعيد كاش البث الحي
// كما كان — صفر إعادة بناء وصفر تلوث للصفحات الحية.
// ------------------------------------------------------------
export interface EngineSnapshot {
  data?: EngineData;
  struct1h?: StructureAnalysis;
  struct4h?: StructureAnalysis;
  struct1d?: StructureAnalysis;
  fib?: { fibD: FibAnchor[]; fib4h: FibAnchor[]; fibW: FibAnchor[] };
  cons?: ReturnType<typeof detectConsolidations>;
  usLevels?: { asiaOpenT: number; high: number; low: number }[];
  preTrend?: Map<number, Dir>;
  signals?: Map<string, GeneratedSignals>;
  ema4h?: { fast: number[]; slow: number[] };
  ema1d?: { fast: number[]; slow: number[] };
}

/** لقطة ضحلة لكل حقول الكاش الحالية — مرجعية فقط بلا نسخ ثقيل */
export function snapshotEngine(): EngineSnapshot {
  return {
    data: cache.data, struct1h: cache.struct1h, struct4h: cache.struct4h,
    fib: cache.fib, cons: cache.cons, usLevels: cache.usLevels,
    preTrend: cache.preTrend, signals: cache.signals, ema4h: cache.ema4h, ema1d: cache.ema1d,
  };
}

/** تبني لقطة محفوظة في الكاش العام — يُستدعى داخل كتلة متزامنة حصراً */
export function adoptEngine(s: EngineSnapshot) {
  cache.data = s.data;
  cache.struct1h = s.struct1h;
  cache.struct4h = s.struct4h;
  cache.fib = s.fib;
  cache.cons = s.cons;
  cache.usLevels = s.usLevels;
  cache.preTrend = s.preTrend;
  cache.signals = s.signals;
  cache.ema4h = s.ema4h;
  cache.ema1d = s.ema1d;
}

export type { StructureAnalysis };
