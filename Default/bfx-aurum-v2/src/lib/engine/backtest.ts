// ============================================================
// محرك الباك تيست — Backtest Engine Framework
// من 2025-01-01 حتى اليوم | سبريد ثابت | قواعد عليا | سلم أولويات
// ============================================================
import { Candle, Dir, Setup, StrategyId, TF, TF_MS, Trade, pips, SESSION_AR, SessionId, STRATEGY_NAMES } from './types';
import { STRATEGY_RANK } from './types';
import { currentSession, syriaHour, syriaWeekday, previousUSHighLow, SYRIA_OFFSET_MS, syriaDayNum } from './sessions';
import { analyzeStructure, detectConsolidations, FibAnchor, findFibAnchors, StructureAnalysis } from './structure';
import { DetectorsInput, runAllDetectors, signalToSetup, detectE, roundNumbers } from './strategies';
import { newsBlock, newsCloseNow, resolveConflicts, riskDollars, tradePnl, setupScore, HARD_RAILS } from './rules';
import { Settings } from './rules';
import { atr, emaSeries } from './indicators';
import { PIP } from './types';
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
  /** توزيع أسباب حظر التنفيذ — شفافية كاملة لكل إشارة لم تُنفذ */
  blocked: Record<string, number>;
  /** ضربات الحوكمة الصلبة (الحدود المكتوبة في الكود) */
  railHits: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
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
const cache: {
  data?: EngineData;
  struct1h?: StructureAnalysis;
  struct4h?: StructureAnalysis;
  fib?: { fibD: FibAnchor[]; fib4h: FibAnchor[]; fibW: FibAnchor[] };
  cons?: ReturnType<typeof detectConsolidations>;
  usLevels?: { asiaOpenT: number; high: number; low: number }[];
  preTrend?: Map<number, Dir>;
  signals?: Map<number, import('./strategies').SignalEvent[]>; // مفتاح = tpRatio (لا يعتمد عليه الكاشف فعلياً)
  ema1h?: { fast: number[]; slow: number[] };
  atrD?: number[]; // ATR 14 على اليومي — لفلتر ريجيم السوق
  rng6h?: number[]; // نطاق آخر 6 ساعات على 1h (بيب) — لفلتر السوق الراكدة
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
  if (!cache.ema1h) cache.ema1h = { fast: emaSeries(data.c1h, 20), slow: emaSeries(data.c1h, 90) };
  if (!cache.atrD) cache.atrD = atr(data.c1d, 14);
  if (!cache.rng6h) {
    const c1h = data.c1h, R = 6;
    cache.rng6h = c1h.map((_, i) => {
      let hi = -Infinity, lo = Infinity;
      for (let j = Math.max(0, i - R + 1); j <= i; j++) { hi = Math.max(hi, c1h[j].h); lo = Math.min(lo, c1h[j].l); }
      return (hi - lo) / PIP;
    });
  }
}

function ensureSignals(data: EngineData): import('./strategies').SignalEvent[] {
  ensurePrecompute(data);
  const key = 0;
  if (!cache.signals) cache.signals = new Map();
  if (cache.signals.has(key)) return cache.signals.get(key)!;
  const inp: DetectorsInput = {
    c5: data.c5, c15: data.c15, c30: data.c30, c1h: data.c1h, c4h: data.c4h, c1d: data.c1d, c1w: data.c1w, c1M: data.c1M,
    cons15: cache.cons!,
    fibD: cache.fib!.fibD, fib4h: cache.fib!.fib4h, fibW: cache.fib!.fibW,
    trend1h: cache.struct1h!.trendTimeline, trend4h: cache.struct4h!.trendTimeline,
  };
  const sig = runAllDetectors(inp, cache.preTrend!, cache.usLevels!);
  cache.signals.set(key, sig);
  return sig;
}

// ---------- حالة EMA ----------
function emaDirAt(data: EngineData, t: number, fastP: number, slowP: number): { dir: Dir; lastCrossT: number | null } {
  const { fast, slow } = cache.ema1h!;
  // بحث عن آخر شمعة 1h مغلقة
  let idx = -1;
  let lo = 0, hi = data.c1h.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (data.c1h[mid].t + TF_MS['1h'] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < slowP) return { dir: 'range', lastCrossT: null };
  const diff = fast[idx] - slow[idx];
  const dir: Dir = diff > 0 ? 'up' : 'down';
  // آخر تقاطع
  let cross: number | null = null;
  for (let i = idx; i > slowP; i--) {
    if (Math.sign(fast[i] - slow[i]) !== Math.sign(fast[i - 1] - slow[i - 1])) { cross = data.c1h[i].t + TF_MS['1h']; break; }
  }
  return { dir, lastCrossT: cross };
}

// ---------- فلتر ريجيم السوق ----------
/** نسبة ATR اليومي (14) إلى السعر — من آخر شمعة يومية مغلقة قبل t */
function atrPctAt(data: EngineData, t: number): number | null {
  if (!cache.atrD) cache.atrD = atr(data.c1d, 14);
  const c1d = data.c1d;
  let idx = -1;
  let lo = 0, hi = c1d.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c1d[mid].t + TF_MS['1d'] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 14) return null; // نحتاج فترة ATR كاملة
  const a = cache.atrD[idx];
  if (!isFinite(a) || a <= 0) return null;
  return a / c1d[idx].c * 100;
}

/** نطاق آخر 6 ساعات (بيب) — من آخر شمعة 1h مغلقة قبل t (فلتر السوق الراكدة) */
function range6hPipsAt(data: EngineData, t: number): number | null {
  if (!cache.rng6h) {
    const c1h = data.c1h, R = 6;
    cache.rng6h = c1h.map((_, i) => {
      let hi = -Infinity, lo = Infinity;
      for (let j = Math.max(0, i - R + 1); j <= i; j++) { hi = Math.max(hi, c1h[j].h); lo = Math.min(lo, c1h[j].l); }
      return (hi - lo) / PIP;
    });
  }
  const c1h = data.c1h;
  let idx = -1;
  let lo = 0, hi = c1h.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c1h[mid].t + TF_MS['1h'] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 5) return null;
  return cache.rng6h[idx];
}

// ---------- الباك تيست ----------
export function runBacktest(data: EngineData, settings: Settings, nowMs = Date.now(), realNews: { t: number; name: string; impact?: string }[] = []): BacktestResult {
  ensurePrecompute(data);
  const signals = ensureSignals(data);

  const gr = settings.globalRules;
  const lot = gr.fixed_lot.enabled ? (gr.fixed_lot.value ?? 0.01) : 0.01;
  const spreadCents = gr.fixed_spread.enabled ? (gr.fixed_spread.value ?? 30) : 0;
  const tpRatio = settings.tpRatio;
  // الأخبار: أحداث ForexFactory الحقيقية فقط — لا تقويم تقريبي ولا مواعيد مولّدة.
  // إن لم يتوفر تقويم حقيقي (كاش فارغ) يعمل الباك تيست بلا فلتر أخبار بدل اختراع مواعيد.
  const news: { t: number; name: string }[] = gr.news_filter.enabled
    ? (realNews ?? []).filter(e => Number.isFinite(e.t)).map(e => ({ t: e.t, name: e.name }))
    : [];
  const beforeMin = gr.news_before_min.enabled ? (gr.news_before_min.value ?? 20) : 0;
  const afterMin = gr.news_after_min.enabled ? (gr.news_after_min.value ?? 60) : 0;
  const closeMin = gr.news_close_min.enabled ? (gr.news_close_min.value ?? 15) : 0;
  const baseBalance = gr.fixed_base.enabled ? (gr.fixed_base.value ?? 1000) : 1000;

  const trades: Trade[] = [];
  let balance = baseBalance;
  let tradeId = 1;
  let setupId = 1;
  let signalsCount = 0;
  let fillsBlocked = 0;
  const blocked: Record<string, number> = {};
  const railHits = { maxTrades: 0, dailyLoss: 0, lotClamp: 0, concurrent: 0 };
  // عدّاد داخلي لأسباب الحظر — الشفافية الكاملة (يُعرض في تقرير الباك تيست)
  const bump = (cause: string) => { blocked[cause] = (blocked[cause] ?? 0) + 1; fillsBlocked++; };
  // التعلم التراكبي (walk-forward) أُزيل نهائياً بأمر المالك — كان يغذي بوابة الجودة التي كانت
  // تخنق استراتيجية E وتمنع دخولات أمرت بها المواصفة. لا شيء يحجب إشارة اكتملت شروطها بالترتيب.
  let scoreSum = 0; let scoreN = 0;

  // الحد الأدنى للاحتفاظ: لا إغلاق قسري (زمني/أخبار) قبل مروره — الوقف والهدف ينفذان دائماً
  const minHoldMs = gr.min_hold_min.enabled ? (gr.min_hold_min.value ?? 5) * 60e3 : 0;
  // حدود الوقف من إعدادات المستخدم — دالة مشتركة للتنفيذ ولعرض الأوامر المعلقة (تطابق كامل بين المعروض والمطبق)
  const floorPipsG = (gr.sl_floor.enabled ? (gr.sl_floor.value ?? 10) : 0) * 10;
  const capPipsG = (gr.sl_cap.enabled ? (gr.sl_cap.value ?? 15) : 1e9) * 10;
  const applySlBounds = (slPips: number): number => {
    let v = slPips;
    if (v < floorPipsG) v = floorPipsG;                 // رفع الوقف الضعيف
    if (v > capPipsG) v = Math.max(capPipsG, floorPipsG); // ضيّق الوقف الزائد (لا تُقتل الفرصة)
    return v;
  };
  // السعة: الصفقة الواحدة (المفعلة) أو الحد الأقصى للصفقات المتوازية — مع سقف الحوكمة الصلب
  const maxConcurrent = Math.min(HARD_RAILS.maxConcurrent, gr.single_trade.enabled ? 1
    : Math.max(1, gr.max_concurrent?.enabled ? (gr.max_concurrent.value ?? 2) : 2));
  // الحجم: اللوت الثابت حصراً (قاعدة 4: لا تغيير للوت — المواصفة: 0.01)
  // «الحجم الديناميكي risk_sizing» أُزيل نهائياً بأمر المالك: كان يغيّر اللوت عند تغيّر
  // الرصيد الأساسي، والمواصفة تثبّت اللوت 0.01 في كل صفقة بلا استثناء.
  const baseLot = gr.fixed_lot.enabled ? (gr.fixed_lot.value ?? 0.01) : 0.01;

  let pending: Setup[] = [];
  const openTrades: Trade[] = [];

  let dayNumPrev = -1;
  let dayKey = '';
  let dayTrades = 0;
  let dayPnl = 0;
  let dayStopped: 'loss' | 'profit' | null = null;
  let stoppedDays = new Set<string>();
  let dayTraded = new Set<string>();
  let dayWith2Plus = new Set<string>();
  // استراتيجية E (الأرقام المستديرة): صفقة واحدة لكل رقم في اليوم — القاعدة المجمّدة حرفياً
  const eNumDay = new Set<string>();
  // هدف الالتزام اليومي (min_daily_trades_kpi): الأيام التي بلغت الهدف تُحسب في dailyKpi.pct
  const dailyTarget = gr.min_daily_trades_kpi.enabled ? Math.max(1, gr.min_daily_trades_kpi.value ?? 2) : 2;

  const sigPtr = { i: 0 };

  const c5 = data.c5;
  const doClose = (tr: Trade, exitPrice: number, result: Trade['result'], atT: number) => {
    tr.exit = exitPrice; tr.exitT = atT; tr.result = result;
    tr.pnl = tradePnl(tr.dir, tr.entry, tr.exit, tr.lot, spreadCents);
    // النتيجة بوحدة R = الربح ÷ مخاطرة الوقف بالدولار (تبليغ فقط — لا يغيّر أي قاعدة)
    const riskD = Math.abs(tr.entry - tr.sl) * (tr.lot / 0.01);
    tr.r = riskD > 0 ? Math.round(tr.pnl / riskD * 100) / 100 : 0;
    balance += tr.pnl;
    dayPnl += tr.pnl;
    trades.push(tr);
    logClose(tr, atT); // سجل القرار: إغلاق (وقف/هدف/زمن/أخبار/إغلاق اليوم)
    const idx = openTrades.findIndex(x => x.id === tr.id);
    if (idx >= 0) openTrades.splice(idx, 1);
  };

  // أحدث لحظة صالحة (النهاية)
  const endT = c5[c5.length - 1].t + TF_MS['5m'];

  // ---- سجل قرارات الوكيل بصيغة المواصفة (نافذة آخر 24 ساعة من البيانات) ----
  // «الوقت | الرقم النفسي | الإعداد (A أو B) | الشرط | القرار | الوقف والهدف»
  const LOG_WINDOW_MS = 24 * 3600e3;
  const CLOSE_LABELS: Record<Trade['result'], string> = {
    sl: 'الوقف ضُرب (ينفذ في أي وقت — القاعدة 5)',
    tp: 'الهدف تحقق (نسبة 1:2)',
    time: 'سقف الاحتفاظ الزمني (8 ساعات)',
    news: 'إغلاق قبل خبر بـ15 دقيقة',
    dayend: 'إغلاق يوم التداول 00:00 سوريا / إيقاف اليوم',
  };
  const inLogWindow = (t: number): boolean => t >= endT - LOG_WINDOW_MS;
  const decisionLog: DecisionEntry[] = [];
  const loggedOnce = new Map<number, Set<string>>();
  const pushLog = (e: Omit<DecisionEntry, 'line' | 'syria'>): void => {
    decisionLog.push(formatDecisionLine(e));
    if (decisionLog.length > 800) decisionLog.splice(0, decisionLog.length - 800);
  };
  const logBlock = (cause: string, t: number, st?: { id: number; refLevel: number; setup?: 'A' | 'B' }): void => {
    if (!inLogWindow(t)) return;
    if (st) {
      let set = loggedOnce.get(st.id);
      if (!set) { set = new Set(); loggedOnce.set(st.id, set); }
      if (set.has(cause)) return; // كل سبب يُسجّل مرة واحدة لكل أمر — لا إغراق بالتكرار
      set.add(cause);
    }
    const cancel = CANCEL_CAUSES.has(cause);
    pushLog({
      t, level: st && Number.isFinite(st.refLevel) ? Math.round(st.refLevel) : null,
      setup: st?.setup ?? null,
      condition: BLOCK_REASON_LABELS[cause] ?? cause,
      decision: cancel ? 'إلغاء' : 'لا شيء',
      sl: null, tp: null,
      extra: cancel ? undefined : 'بانتظار إعادة المحاولة — الأمر لم يُلغَ',
    });
  };
  const logClose = (tr: Trade, atT: number): void => {
    if (!inLogWindow(atT)) return;
    pushLog({
      t: atT, level: null, setup: tr.setup ?? null,
      condition: CLOSE_LABELS[tr.result],
      decision: 'إغلاق', sl: null, tp: null,
      extra: `خروج ${(tr.exit ?? 0).toFixed(2)} — النتيجة ${(tr.pnl ?? 0).toFixed(2)}$ (${(tr.r ?? 0).toFixed(2)}R)`,
    });
  };

  // ---- المستويات اليدوية (استراتيجية Z): أوامر مباشرة من المستخدم تعمل كأوامر معلقة limit ----
  if (settings.manualLevels?.enabled && settings.manualLevels.levels.length) {
    // المستوى اليدوي أمر حي من المالك — يُعلّق من «الآن» (نهاية البيانات) لا من بداية التاريخ،
    // وإلا وُلد ميتاً: صلاحيته 30 يوماً تنقضي داخل تاريخ قديم قبل أن يراه المحرك الحي أبداً.
    const startT = c5[c5.length - 1].t;
    for (const lv of settings.manualLevels.levels) {
      if (!Number.isFinite(lv.price) || lv.price <= 0) continue;
      const slD = Math.max(1, lv.slDollars || 10);
      const slP = slD * 10 / (lot / 0.01); // بالبيب (100 بيب = 10$ عند 0.01 لوت)
      pending.push({
        id: setupId++,
        strategy: 'Z',
        dir: lv.dir,
        entry: lv.price,
        slPips: slP,
        sl: lv.dir === 'buy' ? lv.price - pips(slP) : lv.price + pips(slP),
        tp: lv.dir === 'buy' ? lv.price + pips(slP) * tpRatio : lv.price - pips(slP) * tpRatio,
        createdAt: startT,
        expiresAt: startT + 30 * 86400e3,
        session: 'asia',
        reason: `مستوى يدوي ${lv.dir === 'buy' ? 'شراء' : 'بيع'}${lv.note ? ` — ${lv.note}` : ''} (أمر مباشر من المستخدم — بلا فلترة جلسات/EMA)`,
        refLevel: lv.price,
        strategyRank: 0,
      });
    }
  }

  for (let i = 0; i < c5.length; i++) {
    const bar = c5[i];
    const t = bar.t; // بداية الشمعة الحالية = اللحظة الجارية
    const sess = currentSession(t);

    // ---- بداية يوم سوريا جديد ----
    const dn = syriaDayNum(t);
    if (dn !== dayNumPrev) {
      dayNumPrev = dn;
      dayKey = new Date(dn * 86400e3).toISOString().slice(0, 10);
      dayTrades = 0; dayPnl = 0; dayStopped = null;
    }

    // ---- إغلاق يوم التداول عند 00:00 سوريا (قاعدة 16) ----
    const hSy = ((t + SYRIA_OFFSET_MS) % 86400e3) / 3600e3;
    const wdSy = syriaWeekday(t);
    if (gr.syria_day.enabled && openTrades.length && (t + SYRIA_OFFSET_MS) % 86400e3 < 300e3) {
      // أول شمعة بعد منتصف الليل السوري → إغلاق كل الصفقات (قاعدة 16)
      for (const tr of [...openTrades]) doClose(tr, bar.o, 'dayend', t);
    }

    // ---- إدخال الإشارات الجديدة المعروفة ----
    // فلتر الالتزام بالاستراتيجيات المعتمدة: إشارات الاستراتيجيات المعطلة في نافذة
    // الجدولة لا تولد أوامر أصلاً — لا تُنفّذ ولا تُعرض ولا تشغل أماكن في حل التعارضات
    const newSetups: Setup[] = [];
    while (sigPtr.i < signals.length && signals[sigPtr.i].knownAt <= t) {
      const s = signals[sigPtr.i++];
      const scfg = settings.sessions[s.strategy];
      const enabled = s.strategy === 'Z' ? !!(settings.manualLevels?.enabled)
        : (['L', 'M', 'N'].includes(s.strategy)) ? !!(scfg?.asia)
        : !!(scfg && (scfg.asia || scfg.london || scfg.londonNY || scfg.ny));
      if (!enabled) continue; // استراتيجية معطلة من المستخدم — خارج الالتزام تماماً
      signalsCount++;
      // استراتيجيات آسيا الحصرية: جلسة الإشارة = آسيا دائماً
      let session: SessionId = sess ?? 'asia';
      if (['L', 'M', 'N'].includes(s.strategy)) session = 'asia';
      const st = signalToSetup(s, setupId++, session, tpRatio);
      newSetups.push(st);
    }
    if (newSetups.length) {
      const ema = settings.indicators.ema ? emaDirAt(data, t, settings.indicators.emaFast, settings.indicators.emaSlow).dir : null;
      // الأوامر غير المولودة بعد (المستويات اليدوية الحية: createdAt = نهاية البيانات)
      // لا تشارك في حل التعارضات ولا تحجز سعة — تُعاد كما هي بعد الحل.
      const unborn = pending.filter(x => x.createdAt > t);
      const born = pending.filter(x => x.createdAt <= t);
      // سعة الأوامر المعلقة لكل اتجاه = سعة الصفقات المتزامنة التي حددها المستخدم (max_concurrent)
      const { kept, dropped } = resolveConflicts(born, settings.priority, ema === 'range' ? null : ema, newSetups, maxConcurrent);
      pending = [...kept, ...unborn];
      for (const d of dropped) { bump('conflict'); logBlock('conflict', t, d.setup); } // شفافية كاملة: ما سقط بحل التعارضات يُعدّ ويُسجّل
    }

    // ---- إدارة الأوامر المعلقة ----
    const stillPending: Setup[] = [];
    for (const st of pending) {
      if (st.expiresAt <= t) { bump('expired'); logBlock('expired', t, st); continue; } // انتهاء الصلاحية — إلغاء مسجّل
      // أمر لم يُولد بعد (المستويات اليدوية الحية: createdAt = نهاية البيانات):
      // لا إبطال ولا فحص ولا تنفيذ قبل لحظة ولادته — الشموع السابقة ليست تاريخه.
      if (st.createdAt > t) { stillPending.push(st); continue; }
      // استراتيجية E — لحظة الدخول الوحيدة (حرفياً): دخول بسعر السوق عند إغلاق شمعة التأكيد
      // أي فتح أول شمعة بعدها فقط. إن مُنع الدخول في شمعة الولادة (صفقة نشطة/حد يومي/خبر...)
      // فالإعداد لم يعد قائماً بسعر التأكيد — لا دخول لاحقاً بسعر آخر، ويُسجّل الإلغاء (القاعدة 3:
      // لا تدخل، سجّل الحالة وأكمل). هذا يمنع «الدخول المتأخر» الذي كان ينفّذ الإعداد حتى ساعة بعد شمعة التأكيد.
      if (st.strategy === 'E' && st.market && t - st.createdAt >= TF_MS['5m']) {
        bump('E_late'); logBlock('E_late', t, st); continue;
      }
      // إبطال بكسر عكسي (السعر عبر مستوى الوقف قبل الدخول) — للأوامر المنتظرة من شموع سابقة فقط.
      // الدخول الفوري الجديد (market وصل هذه الشمعة) يُنفَّذ بسعر فتحها لحظة الإشارة
      // ولا يُلغى بإغلاق نفس الشمعة — معلومة مستقبلية نسبةً إلى لحظة التنفيذ الفوري.
      const freshMarket = !!st.market && t - st.createdAt < TF_MS['5m'];
      if (!freshMarket) {
        if (st.dir === 'buy' && bar.c < st.sl) { bump('invalid'); logBlock('invalid', t, st); continue; }
        if (st.dir === 'sell' && bar.c > st.sl) { bump('invalid'); logBlock('invalid', t, st); continue; }
      }
      // قاعدة إلغاء عدم الوصول (الجزء السابع — حرفياً): اقترب ≤50 بيب بلا ملامسة
      // ثم انطلق في الاتجاه المتوقع أكثر من 100 بيب ← إلغاء كامل. المستويات اليدوية (Z)
      // والأوامر الفورية (market) مستثناة — الفوري لا ينتظر اقتراباً أصلاً.
      const distPips = Math.abs(bar.c - st.entry) / 0.1;
      const favorable = st.dir === 'buy' ? (bar.c - st.entry) / 0.1 : (st.entry - bar.c) / 0.1;
      if (st.strategy !== 'Z' && !st.market) {
        if (distPips <= 50) st.bestApproach = Math.min(st.bestApproach ?? 999, distPips);
        if ((st.bestApproach ?? 999) <= 50 && favorable > 100) continue;
      }
      stillPending.push(st);
    }
    pending = stillPending;

    // ---- إدارة الصفقات المفتوحة (قد تتعدد وفق الحد الأقصى للصفقات المتوازية) ----
    if (openTrades.length) {
      // 1) وقف أو هدف لكل صفقة (الوقف أولاً تحفظاً)
      for (const tr of [...openTrades]) {
        if (tr.dir === 'buy') {
          if (bar.l <= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (bar.h >= tr.tp) doClose(tr, tr.tp, 'tp', t);
        } else {
          if (bar.h >= tr.sl) doClose(tr, tr.sl, 'sl', t);
          else if (bar.l <= tr.tp) doClose(tr, tr.tp, 'tp', t);
        }
      }
      // 2) خبر قريب → إغلاق بسعر السوق (بعد تجاوز الحد الأدنى للاحتفاظ)
      if (openTrades.length && gr.news_filter.enabled && closeMin > 0) {
        const n = newsCloseNow(t, news, closeMin);
        if (n) for (const tr of [...openTrades]) {
          if (t - tr.entryT >= minHoldMs) doClose(tr, bar.o, 'news', t);
        }
      }
      // 3) حد أقصى للاحتفاظ — استراتيجية E: حد 8 ساعات مثبت بالقاعدة المجمّدة
      if (openTrades.length) {
        const maxH = gr.max_hold_hours.enabled ? (gr.max_hold_hours.value ?? 8) : Infinity;
        for (const tr of [...openTrades]) {
          const effMax = tr.strategy === 'E' ? 8 : maxH;
          if (t - tr.entryT >= effMax * 3600e3 && t - tr.entryT >= minHoldMs) doClose(tr, bar.o, 'time', t);
        }
      }
      // 4) حد الخسارة/الربح اليومي (Equity مع العائمة الكلية) — حماية تتجاوز الحد الأدنى للاحتفاظ
      if (openTrades.length) {
        let floating = 0;
        for (const tr of openTrades) floating += (tr.dir === 'buy' ? bar.c - tr.entry : tr.entry - bar.c) * (tr.lot / 0.01);
        const equityPnl = dayPnl + floating;
        const lossStop = gr.daily_loss_stop.enabled ? (gr.daily_loss_stop.value ?? 50) : Infinity;
        const profitStop = gr.daily_profit_stop.enabled ? (gr.daily_profit_stop.value ?? 30) : Infinity;
        // حوكمة صلبة: سقف خسارة يومي مطلق (5% من الرصيد الأساسي) مكتوب في الكود — أقوى من أي إعداد
        const hardLoss = baseBalance * HARD_RAILS.maxDailyLossPct / 100;
        const effLoss = Math.min(lossStop, hardLoss);
        if (equityPnl <= -effLoss || equityPnl >= profitStop) {
          const stoppedBy: 'loss' | 'profit' = equityPnl <= -effLoss ? 'loss' : 'profit';
          // نعدّ ضربة الحوكمة فقط عندما هي السقف الصلب (وليس إعداد المستخدم) هي التي أوقفت اليوم
          if (stoppedBy === 'loss' && hardLoss < lossStop) railHits.dailyLoss++;
          for (const tr of [...openTrades]) doClose(tr, bar.o, 'dayend', t);
          dayStopped = stoppedBy; stoppedDays.add(dayKey);
        }
      }
    }

    // ---- محاولة تنفيذ الأوامر المعلقة ----
    // نافذة التنفيذ: جلسة معرفة، أو توجد أوامر E/Z — فهذه لا تُقيَّد بتعريف الجلسات
    // (قيود توقيت E مجمدة في موضعها: 02:00-04:00، 23:00-00:00، الأخبار، إغلاق 00:00 سوريا).
    // قبل هذا الإصلاح كانت ساعة 00:00-01:00 سوريا (4,323 شمعة حقيقية) تُعطّل قسم التنفيذ
    // كاملاً فتُحجب دخولات E المسموح بها مواصفاتياً.
    const fillWindowOpen = sess !== null || pending.some(st => st.strategy === 'E' || st.strategy === 'Z');
    if (pending.length && fillWindowOpen && openTrades.length < maxConcurrent) {
      if (openTrades.length >= maxConcurrent) { bump('capacity'); logBlock('capacity', t); }
      // فلاتر ريجيم/راكدة أُزيلت نهائياً من مسار التنفيذ بأمر المالك —
      // كانت شروطاً مضافة خارج المواصفة تمنع دخولات أمرت بها (القاعدة 1 و2).
      {
      // ترتيب حسب سلم الأولوية ثم الأقدم
      pending.sort((a, b) => a.strategyRank - b.strategyRank || a.createdAt - b.createdAt);
      const filledNow = new Set<number>();
      for (const st of [...pending]) {
        if (filledNow.has(st.id)) continue;
        if (st.createdAt > t) continue; // أمر لم يُولد بعد — لا تنفيذ تاريخي قبل ولادته (المستويات اليدوية الحية)
        if (openTrades.length >= maxConcurrent) break; // امتلأت السعة
        // بوابة الجلسة — قانون صارم (الدليل الجزء 12 + طلب المستخدم: «يلتزم فقط بما أحدده له»):
        // كل استراتيجية تُنفَّذ فقط في الجلسات التي فعّلها المستخدم لها من نافذة الجدولة.
        // — استراتيجية E (الأرقام المستديرة): الجلسات الأربع كلها مفعّلة لها = تعمل طوال فتح السوق،
        //   وتوقيتها تحكمه قيودها المجمدة حصراً (حظر 02:00-04:00، حظر 23:00-00:00، الأخبار، إغلاق 00:00)
        //   — أُزيل حجبها في فجوة ما بين الجلسات (00:00-01:00 سوريا) التي كانت تمنع دخولات مسموحة مواصفاتياً.
        // — L/M/N حصرية آسيا بتصميم الدليل نفسه («مخصّصة لآسيا حصرياً»)
        // — Z (مستويات يدوية) أمر مباشر من المستخدم: تتجاوز بوابات الجلسات وEMA
        const cfg = settings.sessions[st.strategy];
        const allowed = st.strategy === 'E' ? true
          : st.strategy === 'Z' ? true
          : (['L', 'M', 'N'].includes(st.strategy)) ? (sess === 'asia' && !!cfg?.asia)
          : !!(cfg && sess && cfg[sess]);
        if (!allowed) { bump('session'); logBlock('session', t, st); continue; }
        // حظر الاستاكنج: قيمة القاعدة (من إعدادات المستخدم) = أقصى عدد متزامن لنفس الاستراتيجية.
        // الاتجاه المعاكس مسموح ضمن السقف الإجمالي للصفقات المتوازية (يفحصه break الحلقة أعلاه)
        if (gr.no_stacking_hedge.enabled && openTrades.length) {
          const stackMax = Math.max(1, gr.no_stacking_hedge.value ?? 0);
          if (openTrades.filter(o => o.strategy === st.strategy).length >= stackMax) { bump('stacking'); logBlock('stacking', t, st); continue; } // استاكنج
        }
        // فلاتر السوق والأخبار والعدادات
        if (hSy >= 23) { bump('hour23'); logBlock('hour23', t, st); continue; } // حظر 23:00-00:00 (قاعدة 16)
        if (gr.market_open_filter.enabled && wdSy === 0) {
          // حظر أول دقائق من افتتاح الأسبوع (الأحد 01:00 سوريا = أول جلسة بعد الإغلاق الأسبوعي)
          const m = (hSy - 1) * 60 + Math.floor((t % 3600e3) / 60e3);
          if (m >= 0 && m < (gr.market_open_filter.value ?? 120)) { bump('openWeek'); logBlock('openWeek', t, st); continue; }
        }
        if (gr.market_close_filter.enabled) {
          const m = hSy * 60;
          if (m >= 23 * 60 - (gr.market_close_filter.value ?? 60) && m < 23 * 60) { bump('closeDay'); logBlock('closeDay', t, st); continue; }
        }
        if (gr.max_daily_trades.enabled && dayTrades >= (gr.max_daily_trades.value ?? 6)) { bump('maxTrades'); logBlock('maxTrades', t, st); continue; }
        // حوكمة صلبة: سقف مطلق للصفقات اليومية مكتوب في الكود — لا يتأثر بالإعدادات
        if (dayTrades >= HARD_RAILS.maxTradesPerDay) { railHits.maxTrades++; bump('maxTrades'); logBlock('maxTrades', t, st); continue; }
        if (dayStopped) { bump('dayStop'); logBlock('dayStop', t, st); continue; }
        if (gr.news_filter.enabled) {
          const n = newsBlock(t, news, beforeMin, afterMin);
          if (n) { bump('news'); logBlock('news', t, st); continue; }
        }
        // فلتر EMA (خارج المواصفة المجمدة لاستراتيجية E — لا شرط EMA في قاعدة الأرقام المستديرة،
        // والمستويات اليدوية Z مستثناة أصلاً — تعليمات مباشرة من المستخدم)
        if (settings.indicators.ema && st.strategy !== 'Z' && st.strategy !== 'E') {
          const ed = emaDirAt(data, t, settings.indicators.emaFast, settings.indicators.emaSlow).dir;
          if (ed !== 'range') {
            if (st.dir === 'buy' && ed !== 'up') { bump('ema'); logBlock('ema', t, st); continue; }
            if (st.dir === 'sell' && ed !== 'down') { bump('ema'); logBlock('ema', t, st); continue; }
          }
        }
        // قاعدة الأرقام المستديرة (E) — قيود التنفيذ المجمّدة حرفياً:
        if (st.strategy === 'E') {
          if (hSy >= 2 && hSy < 4) { bump('E_open'); logBlock('E_open', t, st); continue; } // قيد الافتتاح 02:00-04:00 بتوقيت سوريا
          if (openTrades.some(o => o.strategy === 'E')) { bump('E_single'); logBlock('E_single', t, st); continue; } // صفقة واحدة مفتوحة في كل وقت
          if (eNumDay.has(`${Math.round(st.refLevel)}:${dayKey}`)) { bump('E_numDay'); logBlock('E_numDay', t, st); continue; } // صفقة واحدة على نفس الرقم في اليوم
        }
        // بوابة جودة الإشارة: أُزيلت نهائياً بأمر المالك — كانت تمنع دخولات اكتملت شروطها
        // (القاعدة 1: اكتملت الشروط بالترتيب ← دخول، والقاعدة 2: لا شروط مضافة).
        // الدرجة البنيوية للعرض والإحصاء فقط.
        const fillScore = setupScore(st);
        // حدود الوقف — استراتيجية E: وقف مطلق مثبت بالقاعدة (قمة/قاع شمعة التأكيد ±1$)
        // وتُطبق قواعدها الخاصة (أرضية 10$/إلغاء فوق 15$/هدف 1:2 ثابت) دون حدود الوقف العامة
        const isE = typeof st.slAnchor === 'number' && Number.isFinite(st.slAnchor);
        const slPipsPre = isE ? st.slPips : applySlBounds(st.slPips);
        const slAdjusted = !isE && Math.abs(slPipsPre - st.slPips) > 1e-9;

        // التنفيذ: فوري بسعر السوق لكل الاستراتيجيات (طلب المستخدم — الدخول المباشر لحظة الإشارة)
        // — المستويات اليدوية Z وحدها تبقى limit بسعرها الذي حدده المستخدم
        let fillPrice: number | null = null;
        if (st.market) {
          fillPrice = bar.o; // تنفيذ فوري بسعر السوق (فتح أول شمعة بعد اكتمال شروط الإشارة) — لا انتظار إعادة اختبار
        } else if (st.dir === 'buy') {
          if (bar.o <= st.entry) fillPrice = bar.o;
          else if (bar.l <= st.entry) fillPrice = st.entry;
        } else {
          if (bar.o >= st.entry) fillPrice = bar.o;
          else if (bar.h >= st.entry) fillPrice = st.entry;
        }
        if (fillPrice === null) continue;

        // الوقف والهدف النهائيان من سعر التنفيذ الفعلي:
        // — استراتيجية E (القاعدة المجمّدة): الوقف المرساة (1$ خلف قمة/قاع التأكيد)،
        //   يُرفع إلى 10$ إن قلّت المسافة، وتُلغى الصفقة إذا تجاوزت 15$، والهدف 1:2 ثابت.
        // — بقية الاستراتيجيات: الوقف المسافة الكاملة من سعر الدخول الحقيقي
        //   (حدود الأدنى/الأقصى من إعداداتك) والهدف = tpRatio × الوقف.
        let slPipsFinal: number;
        let slPrice: number;
        let tpPrice: number;
        if (isE) {
          const rawPips = Math.abs(fillPrice - (st.slAnchor as number)) / PIP;
          if (rawPips / 10 > 15) { bump('E_SL15'); logBlock('E_SL15', t, st); continue; } // الوقف أكثر من 15$ → إلغاء الصفقة
          slPipsFinal = Math.max(rawPips, 100); // أرضية 10$ = 100 بيب (الرفع من سعر الدخول)
          slPrice = st.dir === 'buy' ? fillPrice - pips(slPipsFinal) : fillPrice + pips(slPipsFinal);
          tpPrice = st.dir === 'buy' ? fillPrice + pips(slPipsFinal) * 2 : fillPrice - pips(slPipsFinal) * 2; // 1:2 ثابت
        } else {
          slPipsFinal = slPipsPre;
          slPrice = st.dir === 'buy' ? fillPrice - pips(slPipsFinal) : fillPrice + pips(slPipsFinal);
          tpPrice = st.dir === 'buy' ? fillPrice + pips(slPipsFinal) * tpRatio : fillPrice - pips(slPipsFinal) * tpRatio;
        }
        // اللوت الثابت حصراً — لا تغيير للوت (القاعدة 4)
        const lotNow = baseLot;

        scoreSum += fillScore; scoreN++;
        openTrades.push({
          id: tradeId++, strategy: st.strategy, dir: st.dir,
          entryT: t, exitT: 0, entry: fillPrice, exit: 0,
          sl: slPrice, tp: tpPrice, slPips: slPipsFinal,
          tpPips: isE ? slPipsFinal * 2 : slPipsFinal * tpRatio, // E: الهدف 1:2 ثابت بالقاعدة
          result: 'tp', pnl: 0, session: sess ?? 'asia', reason: slAdjusted
            ? `${st.reason} — [الوقف المطبق فعلياً ${(slPipsFinal / 10).toFixed(1)}$ بعد حدود الوقف الأدنى/الأقصى من إعداداتك]`
            : st.reason,
          lot: lotNow,
          score: fillScore,
        });
        dayTrades++; dayTraded.add(dayKey);
        if (inLogWindow(t)) pushLog({
          t, level: st.strategy === 'E' ? Math.round(st.refLevel) : null,
          setup: st.setup ?? null,
          condition: st.strategy === 'E'
            ? `اكتملت شروط ${st.setup === 'B' ? 'الإعداد B (الكسر وإعادة الاختبار)' : 'الإعداد A (الرفض)'} — دخول بسعر السوق ${fillPrice.toFixed(2)}`
            : `اكتملت شروط أمر ${st.strategy} — دخول بسعر السوق ${fillPrice.toFixed(2)}`,
          decision: 'دخول', sl: slPrice, tp: tpPrice,
        });
        if (st.strategy === 'E') eNumDay.add(`${Math.round(st.refLevel)}:${dayKey}`); // احتساب صفقة الرقم لليوم
        if (dayTrades >= dailyTarget) dayWith2Plus.add(dayKey); // يوم حقق التزام الهدف اليومي
        filledNow.add(st.id);
        // ملاحظة: لم نعد نمسح الأوامر المعلقة المعاكسة بعد الدخول — حظر الهيدج
        // يُطبق لحظة التنفيذ (بوابة fill أعلاه)، وتبقى الأوامر حية لتُنفذ بعد إغلاق المفتوح.
      }
      if (filledNow.size) pending = pending.filter(x => !filledNow.has(x.id));
      }
    }
  }

  // إغلاق أي صفقة عالقة بالنهاية
  for (const tr of [...openTrades]) {
    const last = c5[c5.length - 1];
    tr.exit = last.c; tr.exitT = last.t + TF_MS['5m']; tr.result = 'time';
    tr.pnl = tradePnl(tr.dir, tr.entry, tr.exit, tr.lot, spreadCents);
    const riskD = Math.abs(tr.entry - tr.sl) * (tr.lot / 0.01);
    tr.r = riskD > 0 ? Math.round(tr.pnl / riskD * 100) / 100 : 0;
    balance += tr.pnl;
    trades.push(tr);
    logClose(tr, tr.exitT);
  }
  openTrades.length = 0;

  // ---------- التقارير ----------
  const stats = buildStats(trades, {
    startT: c5[0].t, endT, baseBalance, finalBalance: balance,
    spreadCents, lot, tpRatio, signalsCount, fillsBlocked,
    settings, emaState: emaDirAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow).dir,
    dayTraded, dayWith2Plus, stoppedDays,
    blocked, railHits,
    sizing: { mode: 'fixed' as const, riskPct: 0 },
    avgScore: scoreN ? scoreSum / scoreN : 0,
  });

  const s1h = cache.struct1h!, s4h = cache.struct4h!;
  const lastRP1 = s1h.realPivots[s1h.realPivots.length - 1];
  const lastRP2 = s1h.realPivots[s1h.realPivots.length - 2];
  // الأوامر المعلقة الحية عند نهاية البيانات — نافذة الإشارات الحية
  // (SL/TP بنفس حدود الوقف المطبقة عند التنفيذ + نص سبب صادق — المعروض = ما سيُنفذ)
  const finalPending = pending
    .slice()
    .sort((a, b) => a.strategyRank - b.strategyRank || a.createdAt - b.createdAt)
    .slice(0, 40)
    .map(st => {
      // استراتيجية E — القاعدة المجمّدة: عرض الوقف المثبت (قمة/قاع التأكيد ±1$) والهدف 1:2
      if (typeof st.slAnchor === 'number' && Number.isFinite(st.slAnchor)) {
        const rawD = Math.abs(st.entry - st.slAnchor);
        const finD = rawD > 15 ? rawD : Math.max(rawD, 10); // نفس منطق التنفيذ (من سعر الإشارة)
        const slPriceE = st.dir === 'buy' ? st.entry - finD : st.entry + finD;
        const tpPriceE = st.dir === 'buy' ? st.entry + finD * 2 : st.entry - finD * 2;
        return {
          strategy: st.strategy as string,
          dir: st.dir,
          setup: st.setup ?? null,
          entry: st.entry, sl: slPriceE, tp: tpPriceE,
          session: st.session as string,
          reason: rawD > 15
            ? `${st.reason} — [ستُلغى عند التنفيذ: مسافة الوقف ${rawD.toFixed(1)}$ تتجاوز 15$]`
            : st.reason,
          expiresAt: st.expiresAt, createdAt: st.createdAt,
          fibConfirmed: st.fibConfirmed ?? false,
        };
      }
      const slP = applySlBounds(st.slPips);
      const slAdj = Math.abs(slP - st.slPips) > 1e-9;
      const slPrice = st.dir === 'buy' ? st.entry - pips(slP) : st.entry + pips(slP);
      const tpPrice = st.dir === 'buy' ? st.entry + pips(slP) * tpRatio : st.entry - pips(slP) * tpRatio;
      return {
        strategy: st.strategy as string,
        dir: st.dir,
        setup: st.setup ?? null,
        entry: st.entry, sl: slPrice, tp: tpPrice,
        session: st.session as string,
        reason: slAdj
          ? `${st.reason} — [الوقف المطبق فعلياً ${(slP / 10).toFixed(1)}$ بعد حدود الوقف الأدنى/الأقصى من إعداداتك]`
          : st.reason,
        expiresAt: st.expiresAt, createdAt: st.createdAt,
        fibConfirmed: st.fibConfirmed ?? false,
      };
    });
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
    emaDirNow: emaDirAt(data, endT, settings.indicators.emaFast, settings.indicators.emaSlow).dir,
    sessionNow: currentSession(endT),
  };
}

function trendAtTime(tl: { t: number; trend: Dir }[], t: number): Dir {
  let d: Dir = 'range';
  for (const p of tl) { if (p.t <= t) d = p.trend; else break; }
  return d;
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
  settings: Settings; emaState: Dir;
  dayTraded: Set<string>; dayWith2Plus: Set<string>; stoppedDays: Set<string>;
  blocked: Record<string, number>;
  railHits: { maxTrades: number; dailyLoss: number; lotClamp: number; concurrent: number };
  sizing: { mode: 'fixed' | 'risk'; riskPct: number };
  avgScore: number;
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
  // بوابة النشر تُحترم كما ضبطها المستخدم: معطلة من الإعدادات = بلا حكم نشر
  // (تُعرض الأرقام للاطلاع مع وسم «البوابة معطلة» — بلا إنكار أو تزوير للنتيجة)
  const gateEnabled = ctx.settings.globalRules.winrate_gate.enabled;
  const gateThreshold = gateEnabled ? (ctx.settings.globalRules.winrate_gate.value ?? 70) : 70;
  const gatePass = gateEnabled
    ? (oosWR >= gateThreshold && oosTrades.length >= 100 && oosAvgR > 0)
    : true;

  // مؤشر الصفقات اليومية المتوقعة (يستثني أيام التوقف)
  const activeDays = [...ctx.dayTraded].filter(d => !ctx.stoppedDays.has(d));
  const days2Plus = [...ctx.dayWith2Plus].filter(d => !ctx.stoppedDays.has(d));

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
      target: ctx.settings.globalRules.min_daily_trades_kpi.enabled ? (ctx.settings.globalRules.min_daily_trades_kpi.value ?? 2) : 2,
    },
    weekly, monthly, matrix, strategyTotals, ranking,
    emaEnabled: ctx.settings.indicators.ema, emaState: ctx.emaState,
    spreadCents: ctx.spreadCents, lot: ctx.lot, tpRatio: ctx.tpRatio,
    generatedAt: Date.now(),
    signalsCount: ctx.signalsCount, fillsBlocked: ctx.fillsBlocked,
    blocked: ctx.blocked, railHits: ctx.railHits,
    sizing: ctx.sizing, avgScore: Math.round(ctx.avgScore * 10) / 10,
    totalR: Math.round(trades.reduce((a, t) => a + (t.r ?? 0), 0) * 100) / 100,
    avgR: trades.length ? Math.round(trades.reduce((a, t) => a + (t.r ?? 0), 0) / trades.length * 1000) / 1000 : 0,
    equity,
  };
}

export function getCachedStructure() {
  return { struct1h: cache.struct1h, struct4h: cache.struct4h, cons: cache.cons, data: cache.data };
}

/** مجس تشخيصي مؤقت: حالة إشارات الكاش + فحص detectE مباشر على بيانات الكاش */
export function debugSignals(): {
  cached: number; hasData: boolean; c5len?: number; c15len?: number;
  c5first?: number; c5last?: number; detectEDirect?: number;
  c5disordered?: number; c15disordered?: number; levels?: number[];
  c5lo?: number; c5hi?: number; c15first?: number; c15last?: number;
} {
  const cached = cache.signals?.get(0)?.length ?? -1;
  const data = cache.data;
  if (!data) return { cached, hasData: false };
  let dis5 = 0, dis15 = 0;
  for (let i = 1; i < data.c5.length; i++) if (data.c5[i].t <= data.c5[i - 1].t) dis5++;
  for (let i = 1; i < data.c15.length; i++) if (data.c15[i].t <= data.c15[i - 1].t) dis15++;
  const direct = detectE({ c5: data.c5, c15: data.c15 } as Parameters<typeof detectE>[0]);
  return {
    cached, hasData: true,
    c5len: data.c5.length, c15len: data.c15.length,
    c5first: data.c5[0]?.t, c5last: data.c5[data.c5.length - 1]?.t,
    detectEDirect: direct.length,
    c5disordered: dis5, c15disordered: dis15,
    levels: roundNumbers(data.c5[0].l, data.c5[data.c5.length - 1].h),
    c5lo: data.c5[0].l, c5hi: data.c5[data.c5.length - 1].h,
    c15first: data.c15[0]?.t, c15last: data.c15[data.c15.length - 1]?.t,
  };
}

/** حالة السوق اللحظية (للتشغيل الحي): تقلب يومي % + نطاق 6 ساعات بيب */
export function marketStateNow(data: EngineData, t: number): { atrPct: number | null; rng6hPips: number | null } {
  return { atrPct: atrPctAt(data, t), rng6hPips: range6hPipsAt(data, t) };
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
  cache.ema1h = undefined;
  cache.atrD = undefined;
  cache.rng6h = undefined;
}

export type { StructureAnalysis };
