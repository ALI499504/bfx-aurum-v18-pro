
// ============================================================
// TAMSA Engine — المحرك الموحّد
// ------------------------------------------------------------
// خط الأنابيب (بالترتيب الإلزامي — القاعدة 21: التسلسل الهرمي):
//   1) هيكل السوق      HH/HL/LH/LL + BOS/CHoCH + مناطق التجميع
//   2) بوابة الحقن     LightGBM — اتجاه أم لا
//   3) التأكيد الرباعي LL→HH→HL→HH / HH→LL→LH→LL
//   4) الكاشفات        A–R + W/X/Y/AA/BB/CC/DD/Z عبر المعاملات الحرفية
//   5) القواعد العليا  اللوت/الستوب/الأخبار/الجلسات — تُقرأ ولا تُحسب
//
// ⛔ ثوابت لا يمسّها هذا الملف (بأمر المالك):
//   • اللوت يأتي حرفياً من الإعدادات (fixed_lot) — لا ضرب ولا تصغير ولا تكبير.
//   • الستوب يأتي من معاملات الاستراتيجية حرفياً — لا تعديل إلا شدّ لسقف
//     القاعدة 12 إن كان السقف مفعّلاً (الشدّ يضيّق فقط، لا يوسّع أبداً).
//   • لا مارتينجال، لا هيدج، لا استاكنج، لا تأمين/تريلينغ (القاعدة 20 ملغاة).
//   • المحرك لا ينفّذ: يُصدر «مقترحات» جاهزة، والتنفيذ يبقى لطبقة الأمر.
// ============================================================
import {
  Candle, Consolidation, Dir, PIP, RealPivot, SessionId, Setup, StrategyId, TF, TF_MS, pips,
} from './types';
import {
  StructureAnalysis, analyzeStructure, confirm4Points, detectConsolidations, pivotSequence,
  FourPointsConfirmation,
} from './structure';
import {
  DetectorsCtx, DetectorsInput, SignalEvent, resetTamsaState, runAllDetectors, signalToSetup,
} from './strategies';
import { ALLOWED_SESSIONS, SessionKey, TamsaParams, DEFAULT_TAMSA_PARAMS } from './tamsa-params';
import { GlobalRuleCfg, Settings, slCapPips } from './rules';
import { emaSeries } from './indicators';
import { currentSession } from './sessions';
import {
  LightGBMFilter, LightGBMPrediction, PredTrend, computeFeatures,
} from './lightgbm-filter';

// ------------------------------------------------------------
// الأنواع
// ------------------------------------------------------------
export type GateMode = 'strict' | 'scenario' | 'off';

export interface TAMSAConfig {
  /** فلتر LightGBM — مفعّل افتراضياً */
  lightGBM?: boolean;
  /** عتبة الثقة الدنيا للنموذج (0.55 افتراضياً) */
  minConfidence?: number;
  /** سلوك بوابة الحقن:
   *   strict   : اتجاه النموذج يجب أن يطابق اتجاه الصفقة دائماً
   *   scenario : مطابقة صارمة للسيناريو المتوافق (1)، ومنع فقط عند ثقة عالية معاكسة للعكسي (2)  ← الافتراضي
   *   off      : الفلتر يعمل ويُسجّل لكن لا يحجب
   */
  lightGBMMode?: GateMode;
  /** أقصى ثقة معاكسة يُسمح بها لصفقة عكس الاتجاه في وضع scenario (0.70 افتراضياً) */
  counterTrendMaxConfidence?: number;

  /** التأكيد الرباعي — مفعّل افتراضياً */
  fourPoints?: boolean;
  /** veto (افتراضي): يمنع فقط عند نمط مؤكد معاكس للصفقة — لا يخنق صفقات العكس
   *  strict : يشترط نمطاً مؤكداً موافقاً لاتجاه الصفقة
   *  off    : بلا بوابة */
  fourPointsMode?: 'veto' | 'strict' | 'off';
  /** أقل جودة أسعار للنمط (0..1) — 1 = كل الشروط الرقمية (افتراضي) */
  fourPointsMinScore?: number;
  /** أقصى محاور مسموحة بعد النقطة الرابعة قبل إسقاط الاعتماد (12 افتراضي) */
  fourPointsMaxTrailing?: number;
  /** أقصى عدد محاور وسيطة مسموح بين نقاط النمط (2 افتراضي) */
  fourPointsMaxGap?: number;

  /** شدّ الستوب إلى سقف القاعدة 12 عند تجاوزه (تضييق فقط) — افتراضي true */
  enforceSlCap?: boolean;
  /** حجب الإشارات خارج جلساتها المسموحة (افتراضي true) */
  enforceSessions?: boolean;
  /** إعادة تهيئة سجل الاستهلاك قبل كل تحليل (افتراضي true — تحليل قابل للتكرار) */
  resetState?: boolean;
  /** أقصى عمر مقبول للإشارة قبل لحظة التحليل (افتراضي 24 ساعة).
   *  الإشارات الأقدم تُعدّ تاريخية ولا تُقترح للتنفيذ — تبقى في التشخيص فقط. */
  signalMaxAgeMs?: number;
  /** حجب الإشارات منتهية الصلاحية (expiresAt < now) — افتراضي true */
  honorExpiry?: boolean;
  /** سقف عدد المحاور الحقيقية المُغذاة للكاشفات (افتراضي 400 — الأحدث فقط).
   *  بلا سقف تنفجر التكلفة: 2043 محوراً × 23 كاشفاً = 201 ثانية وتحجير
   *  لحلقة Node الواحدة (يُجمّد الشارت وكل الـ APIs). المحاور الأقدم من
   *  آخر 400 لا تُنتج إشارات حيّة أصلاً لأن صلاحيتها ساعات لا أسابيع. */
  maxPivots?: number;
  /** نموذج مخصّص (اختبارات/توليد) */
  filter?: LightGBMFilter;
}

export interface RiskContext {
  /** صافي ربح اليوم بالدولار (سالب = خسارة) */
  dayPnL?: number;
  /** عدد الصفقات المنفذة اليوم */
  dayTrades?: number;
  /** هل توجد صفقة نشطة لعائلة TAMSA؟ (القاعدة 10) */
  activeTrade?: boolean;
}

export interface RiskVerdict {
  canOpen: boolean;
  blocks: string[];
  /** اللوت المعتمد للتنفيذ — منقول حرفياً من القاعدة 2 */
  lot: number;
  /** سقف مسافة الستوب بالبيب من القاعدة 12 (Infinity = بلا سقف) */
  slCap: number;
}

export interface BlockedSignal {
  strategy: StrategyId;
  dir: 'buy' | 'sell';
  scenario?: 1 | 2;
  gate: 'session' | 'lightgbm' | 'fourpoints' | 'constitution' | 'duplicate' | 'stale';
  reason: string;
  entry: number;
  knownAt: number;
}

export interface Proposal {
  setup: Setup;
  /** اللوت الثابت المعتمد — لا يُحسب هنا، يُنقل من الإعدادات */
  lot: number;
  /** قيمة المخاطرة بالدولار عند هذا اللوت وهذا الوقف (للعرض فقط) */
  riskDollars: number;
  /** أدلة البوابات التي مرّت */
  evidence: {
    trend1h: Dir;
    trend4h: Dir;
    fourPoints: string;
    lightGBM: string;
    mlConfidence: number;
  };
}

export interface TAMSASnapshot {
  at: number;
  structure: {
    h1: StructureAnalysis;
    h4: StructureAnalysis;
    d1: StructureAnalysis;
    trend1h: Dir;
    trend4h: Dir;
    trend1d: Dir;
    sequence1h: string;
    consolidations: Consolidation[];
  };
  lightGBM?: {
    trend: PredTrend;
    confidence: number;
    model: string;
    features: Record<string, number>;
  };
  fourPoints: FourPointsConfirmation;
  signals: SignalEvent[];
  blocked: BlockedSignal[];
  proposals: Proposal[];
  risk: RiskVerdict;
  diagnostics: {
    signalsRaw: number;
    passed: number;
    blockedByGate: Record<string, number>;
    durationMs: number;
  };
  /** قراءة بشرية جاهزة للواجهة */
  summary: string;
}

// ------------------------------------------------------------
// أدوات داخلية
// ------------------------------------------------------------
const EMPTY: Candle[] = [];

/** اتجاه الهيكل عند لحظة محددة من الخط الزمني */
export function trendAt(timeline: { t: number; trend: Dir }[], t: number): Dir {
  let d: Dir = 'range';
  for (const p of timeline) {
    if (p.t <= t) d = p.trend; else break;
  }
  return d;
}

/** اتجاه EMA(سريع/بطيء) على 4H واليومي — مطابق لمنطق الباكتيست */
function makeEmaAt(c4h: Candle[], c1d: Candle[], fastP: number, slowP: number) {
  const e4f = emaSeries(c4h, fastP), e4s = emaSeries(c4h, slowP);
  const eDf = emaSeries(c1d, fastP), eDs = emaSeries(c1d, slowP);
  const at = (c: Candle[], ef: number[], es: number[], ms: number, t: number): Dir | null => {
    let lo = 0, hi = c.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].t + ms <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx < slowP || !Number.isFinite(ef[idx]) || !Number.isFinite(es[idx])) return null;
    return ef[idx] - es[idx] > 0 ? 'up' : 'down';
  };
  return (t: number): 'up' | 'down' | 'range' | null => {
    const d4 = at(c4h, e4f, e4s, TF_MS['4h'], t);
    const dD = at(c1d, eDf, eDs, TF_MS['1d'], t);
    if (!d4 && !dD) return 'range';
    if (d4 && dD && d4 !== dD) return 'range'; // تشابك الخطين → عرضي
    return d4 ?? dD ?? 'range';
  };
}

const ruleOn = (gr: Record<string, GlobalRuleCfg>, key: string) => {
  const r = gr[key];
  return !!r && r.enabled !== false;
};
const ruleVal = (gr: Record<string, GlobalRuleCfg>, key: string, fallback: number) => {
  const v = gr[key]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** مخاطرة الصفقة بالدولار — 1$ لكل 0.10$ حركة على لوت 0.01 (عقد الذهب القياسي) */
export function riskOf(entry: number, sl: number, lot: number): number {
  return Math.abs(entry - sl) * (lot / 0.01);
}

// ------------------------------------------------------------
// المحرك
// ------------------------------------------------------------
export class TAMSAEngine {
  private filter: LightGBMFilter;
  private config: Required<Omit<TAMSAConfig, 'filter'>>;

  constructor(config: TAMSAConfig = {}) {
    this.config = {
      lightGBM: config.lightGBM ?? true,
      minConfidence: config.minConfidence ?? 0.55,
      lightGBMMode: config.lightGBMMode ?? 'scenario',
      counterTrendMaxConfidence: config.counterTrendMaxConfidence ?? 0.70,
      fourPoints: config.fourPoints ?? true,
      fourPointsMode: config.fourPointsMode ?? 'veto',
      fourPointsMinScore: config.fourPointsMinScore ?? 1,
      fourPointsMaxTrailing: config.fourPointsMaxTrailing ?? 12,
      fourPointsMaxGap: config.fourPointsMaxGap ?? 2,
      enforceSlCap: config.enforceSlCap ?? true,
      enforceSessions: config.enforceSessions ?? true,
      resetState: config.resetState ?? true,
      signalMaxAgeMs: config.signalMaxAgeMs ?? 24 * 3600e3,
      honorExpiry: config.honorExpiry ?? true,
      maxPivots: config.maxPivots ?? 400,
    };
    this.filter = config.filter ?? new LightGBMFilter({
      enabled: this.config.lightGBM,
      minConfidence: this.config.minConfidence,
    });
  }

  get lightGBM(): LightGBMFilter { return this.filter; }
  get settings(): Readonly<typeof this.config> { return this.config; }

  /** تركيب نموذج LightGBM مُدرَّب (تفريغ JSON) — للتوافق فقط */
  loadModel(dump: any, name?: string): void {
    // النموذج يُحمّل تلقائياً في LightGBMFilter constructor
    console.log('[TAMSA] نموذج LightGBM سيُحمّل تلقائياً من JSON');
  }

  /** تحديث الإعدادات دون إعادة بناء */
  configure(patch: Partial<TAMSAConfig>): void {
    Object.assign(this.config, patch);
    if (patch.lightGBM !== undefined) this.filter.setEnabled(patch.lightGBM);
    if (patch.minConfidence !== undefined) this.filter.setMinConfidence(patch.minConfidence);
  }

  // ---------- القواعد العليا: قراءة فقط ----------
  /**
   * حكم القواعد العليا على فتح صفقة جديدة.
   * يقرأ القواعد 2 (اللوت)، 5 (سقف اليوم)، 7 (وقف الخسارة)، 8 (هدف الربح)، 10 (صفقة واحدة).
   * لا يخترع حدوداً جديدة ولا يغيّر رقماً واحداً.
   */
  riskVerdict(settings: Partial<Settings> | undefined, ctx: RiskContext = {}): RiskVerdict {
    const gr = (settings?.globalRules ?? {}) as Record<string, GlobalRuleCfg>;
    const blocks: string[] = [];

    // القاعدة 2: اللوت الثابت — يُنقل كما هو
    const lot = Math.max(0.01, ruleVal(gr, 'fixed_lot', 0.01));

    // القاعدة 12: سقف مسافة الوقف
    const slCap = this.config.enforceSlCap ? slCapPips(gr) : Infinity;

    // القاعدة 7: حد الخسارة اليومي
    if (ruleOn(gr, 'daily_loss_stop') && typeof ctx.dayPnL === 'number') {
      const lim = ruleVal(gr, 'daily_loss_stop', 0);
      if (lim > 0 && ctx.dayPnL <= -lim) {
        blocks.push(`القاعدة 7: خسارة اليوم ${ctx.dayPnL.toFixed(2)}$ بلغت حد الإيقاف ${lim}$`);
      }
    }
    // القاعدة 8: هدف الربح اليومي (حظر تداول إضافي)
    if (ruleOn(gr, 'daily_profit_stop') && typeof ctx.dayPnL === 'number') {
      const lim = ruleVal(gr, 'daily_profit_stop', 0);
      if (lim > 0 && ctx.dayPnL >= lim) {
        blocks.push(`القاعدة 8: ربح اليوم ${ctx.dayPnL.toFixed(2)}$ بلغ المستهدف ${lim}$ — حظر التداول الانتقامي`);
      }
    }
    // القاعدة 5: سقف الصفقات اليومية
    if (ruleOn(gr, 'max_daily_trades') && typeof ctx.dayTrades === 'number') {
      const lim = ruleVal(gr, 'max_daily_trades', 0);
      if (lim > 0 && ctx.dayTrades >= lim) {
        blocks.push(`القاعدة 5: عدد صفقات اليوم ${ctx.dayTrades} بلغ السقف ${lim}`);
      }
    }
    // القاعدة 10: صفقة نشطة واحدة
    if (ruleOn(gr, 'single_trade') && ctx.activeTrade) {
      blocks.push('القاعدة 10: توجد صفقة نشطة — لا تكرار قبل إغلاقها');
    }
    return { canOpen: blocks.length === 0, blocks, lot, slCap };
  }

  // ---------- البوابات ----------
  private decideLightGBM(
    pred: LightGBMPrediction | undefined,
    dir: 'buy' | 'sell',
    scenario: 1 | 2,
  ): { ok: boolean; reason: string } {
    if (!this.config.lightGBM || !pred) return { ok: true, reason: 'فلتر LightGBM معطّل' };
    const mode = this.config.lightGBMMode;
    if (mode === 'off') return { ok: true, reason: `تسجيل فقط: النموذج يقرأ ${pred.trend} (${(pred.confidence * 100).toFixed(0)}%)` };

    const want: PredTrend = dir === 'buy' ? 'up' : 'down';
    const opposite: PredTrend = dir === 'buy' ? 'down' : 'up';

    if (mode === 'strict' || scenario === 1) {
      const d = this.filter.decide(pred, want);
      return { ok: d.allowed, reason: d.reason };
    }
    // سيناريو عكسي (2): لا نمنع العكس إلا إذا كان النموذج واثقاً من الاتجاه المعاكس
    if (pred.trend === opposite && pred.confidence >= this.config.counterTrendMaxConfidence) {
      return {
        ok: false,
        reason: `صفقة عكسية مرفوضة: النموذج واثق من ${opposite} بنسبة ${(pred.confidence * 100).toFixed(1)}% (العتبة ${(this.config.counterTrendMaxConfidence * 100).toFixed(0)}%)`,
      };
    }
    return {
      ok: true,
      reason: `صفقة عكسية مسموحة: النموذج يقرأ ${pred.trend} بثقة ${(pred.confidence * 100).toFixed(1)}% دون عتبة المنع`,
    };
  }

  private decideFourPoints(
    fp: FourPointsConfirmation,
    dir: 'buy' | 'sell',
  ): { ok: boolean; reason: string } {
    if (!this.config.fourPoints || this.config.fourPointsMode === 'off') {
      return { ok: true, reason: 'بوابة الأربع نقاط معطّلة' };
    }
    if (!fp.confirmed) {
      // في وضع veto لا نمط مؤكد = لا مانع؛ في strict = مانع
      return this.config.fourPointsMode === 'strict'
        ? { ok: false, reason: `لا تأكيد رباعي بعد — ${fp.reason}` }
        : { ok: true, reason: `لا نمط مؤكد (لا تعارض) — ${fp.reason}` };
    }
    const want: Dir = dir === 'buy' ? 'up' : 'down';
    if (fp.trend === want) return { ok: true, reason: fp.reason };
    return {
      ok: false,
      reason: `تعارض بنيوي: النمط المؤكد ${fp.trend} مقابل صفقة ${dir} — ${fp.reason}`,
    };
  }

  /** فلترة الجلسات من إعدادات المستخدم حرفياً (القاعدة 21، المستوى الثاني) */
  private decideSession(
    settings: Partial<Settings> | undefined,
    st: StrategyId,
    cs: string | undefined,
    scenario: 1 | 2,
    at: number,
  ): { ok: boolean; reason: string } {
    if (!this.config.enforceSessions) return { ok: true, reason: 'فحص الجلسات معطّل' };
    const sk = currentSession(at) as SessionKey | null;
    if (!sk) return { ok: false, reason: 'خارج أي جلسة تداول (عطلة/إغلاق)' };

    const node = settings?.scenarioSessions?.[st]?.[cs ?? 'main'] as
      | Record<string, { enabled?: boolean; asia: boolean; london: boolean; londonNY: boolean; ny: boolean } | undefined>
      | undefined;
    const key = scenario === 1 ? 's1' : 's2';
    const v = node?.[key];

    if (v?.enabled === false) {
      return { ok: false, reason: `السيناريو ${scenario} معطّل يدوياً للبند ${cs ?? 'main'}` };
    }
    // بلا إعدادات: نستخدم الجلسات المسموحة حرفياً من المعاملات
    const allowed = ALLOWED_SESSIONS[st] ?? [];
    if (v) {
      const on = v[sk];
      return on
        ? { ok: true, reason: `الجلسة ${sk} مسموحة للسيناريو ${scenario}` }
        : { ok: false, reason: `الجلسة ${sk} مقفلة لهذا البند` };
    }
    return allowed.includes(sk)
      ? { ok: true, reason: `الجلسة ${sk} ضمن المسموح للاستراتيجية ${st}` }
      : { ok: false, reason: `الجلسة ${sk} خارج المسموح للاستراتيجية ${st}` };
  }

  // ---------- التحليل الكامل ----------
  analyze(
    candles: Partial<Record<TF, Candle[]>>,
    params: TamsaParams = DEFAULT_TAMSA_PARAMS,
    settings?: Partial<Settings>,
    riskCtx: RiskContext = {},
    at?: number,
  ): TAMSASnapshot {
    const t0 = Date.now();
    const c5 = candles['5m'] ?? EMPTY;
    const c15 = candles['15m'] ?? EMPTY;
    const c30 = candles['30m'] ?? EMPTY;
    const c1h = candles['1h'] ?? EMPTY;
    const c4h = candles['4h'] ?? EMPTY;
    const c1d = candles['1d'] ?? EMPTY;
    const c1w = candles['1w'] ?? EMPTY;
    const c1M = candles['1M'] ?? EMPTY;

    const now = at ?? (c1h.length ? c1h[c1h.length - 1].t + TF_MS['1h'] : Date.now());
    const risk = this.riskVerdict(settings, riskCtx);

    const blocked: BlockedSignal[] = [];
    const diag = { signalsRaw: 0, passed: 0, blockedByGate: {} as Record<string, number>, durationMs: 0 };
    const bump = (g: string) => { diag.blockedByGate[g] = (diag.blockedByGate[g] ?? 0) + 1; };

    // ---------- 1) هيكل السوق ----------
    const h1: StructureAnalysis = c1h.length > 6 ? analyzeStructure(c1h, '1h') : { pivots: [], realPivots: [], events: [], trendTimeline: [] };
    const h4: StructureAnalysis = c4h.length > 6 ? analyzeStructure(c4h, '4h') : { pivots: [], realPivots: [], events: [], trendTimeline: [] };
    const d1: StructureAnalysis = c1d.length > 6 ? analyzeStructure(c1d, '1d') : { pivots: [], realPivots: [], events: [], trendTimeline: [] };

    const trend1h = trendAt(h1.trendTimeline, now);
    const trend4h = trendAt(h4.trendTimeline, now);
    const trend1d = trendAt(d1.trendTimeline, now);
    const consolidations = detectConsolidations(c15);

    // ---------- 2) بوابة الحقن ----------
    let prediction: LightGBMPrediction | undefined;
    let features: Record<string, number> | undefined;
    if (this.config.lightGBM && c1h.length > 30) {
      const f = computeFeatures({
        c1h,
        idx: c1h.length - 1,
        trend1h,
        trend4h,
        trend1d,
        real1h: h1.realPivots,
      });
      prediction = this.filter.predict(f);
      features = f as unknown as Record<string, number>;
    }

    // ---------- 3) التأكيد الرباعي ----------
    const fourPoints: FourPointsConfirmation = confirm4Points(h1.realPivots, trend1h, {
      minScore: this.config.fourPointsMinScore,
      maxTrailing: this.config.fourPointsMaxTrailing,
      maxGap: this.config.fourPointsMaxGap,
      tf: '1h',
      asOf: now,
    });

    // ---------- 4) الكاشفات ----------
    if (this.config.resetState) resetTamsaState();
    // سقف المحاور: الأحدث فقط — يحمي حلقة الأحداث من الانفجار الحسابي
    const cap = <T>(list: T[]): T[] =>
      list.length > this.config.maxPivots ? list.slice(list.length - this.config.maxPivots) : list;
    const inp: DetectorsInput = {
      c5, c15, c30, c1h, c4h, c1d, c1w, c1M,
      cons15: consolidations,
      trend1h: h1.trendTimeline,
      trend4h: h4.trendTimeline,
      trend1d: d1.trendTimeline,
      real1h: cap(h1.realPivots),
      real4h: cap(h4.realPivots),
    };
    const emaCfg = settings?.indicators;
    const emaAt = emaCfg && emaCfg.ema && c4h.length && c1d.length
      ? makeEmaAt(c4h, c1d, emaCfg.emaFast ?? 20, emaCfg.emaSlow ?? 90)
      : () => null;

    const ctx: DetectorsCtx = {
      params,
      emaAt,
      sessionsOf: (st, cs, scenario) => {
        const node = settings?.scenarioSessions?.[st]?.[cs ?? 'main']?.[scenario === 1 ? 's1' : 's2'];
        return {
          enabled: node?.enabled !== false,
          asia: node?.asia ?? true,
          london: node?.london ?? true,
          londonNY: node?.londonNY ?? true,
          ny: node?.ny ?? true,
        };
      },
      regimeGates: {
        dailyTrend: ruleOn((settings?.globalRules ?? {}) as Record<string, GlobalRuleCfg>, 'gate_daily_trend'),
        erQuiet: ruleOn((settings?.globalRules ?? {}) as Record<string, GlobalRuleCfg>, 'gate_er_quiet'),
      },
    };

    const signals = (c1h.length > 30 ? runAllDetectors(inp, ctx) : []) as SignalEvent[];
    diag.signalsRaw = signals.length;

    // ---------- 5) تصفية: جلسات → ML → أربع نقاط → دستور ----------
    const passed: SignalEvent[] = [];
    const seen = new Set<string>();
    for (const s of signals) {
      const scenario: 1 | 2 = s.scenario ?? 1;

      // 0) الترشيح الزمني: إشارة تاريخية أو منتهية الصلاحية لا تُقترح للتنفيذ
      const age = now - s.knownAt;
      const expired = this.config.honorExpiry && s.expiresAt !== undefined && s.expiresAt < now;
      if (age > this.config.signalMaxAgeMs || age < 0 || expired) {
        blocked.push({
          strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'stale',
          reason: expired
            ? `إشارة منتهية الصلاحية (انتهت قبل ${Math.round((now - (s.expiresAt ?? now)) / 60000)} دقيقة)`
            : `إشارة تاريخية عمرها ${(age / 3600e3).toFixed(1)} ساعة — خارج نافذة التنفيذ`,
          entry: s.entry, knownAt: s.knownAt,
        });
        bump('stale');
        continue;
      }

      const gs = this.decideSession(settings, s.strategy, s.case, scenario, s.knownAt);
      if (!gs.ok) {
        blocked.push({ strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'session', reason: gs.reason, entry: s.entry, knownAt: s.knownAt });
        bump('session');
        continue;
      }

      const gm = this.decideLightGBM(prediction, s.dir, scenario);
      if (!gm.ok) {
        blocked.push({ strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'lightgbm', reason: gm.reason, entry: s.entry, knownAt: s.knownAt });
        bump('lightgbm');
        continue;
      }

      const gf = this.decideFourPoints(fourPoints, s.dir);
      if (!gf.ok) {
        blocked.push({ strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'fourpoints', reason: gf.reason, entry: s.entry, knownAt: s.knownAt });
        bump('fourpoints');
        continue;
      }

      if (!risk.canOpen) {
        blocked.push({ strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'constitution', reason: risk.blocks.join(' | '), entry: s.entry, knownAt: s.knownAt });
        bump('constitution');
        continue;
      }

      const dedupe = `${s.strategy}:${s.dir}:${s.levelKey}`;
      if (seen.has(dedupe)) {
        blocked.push({ strategy: s.strategy, dir: s.dir, scenario: s.scenario, gate: 'duplicate', reason: 'تكرار لنفس المستوى في نفس اللقطة', entry: s.entry, knownAt: s.knownAt });
        bump('duplicate');
        continue;
      }
      seen.add(dedupe);
      passed.push(s);
    }

    // ---------- 6) تحويل الإشارات إلى مقترحات جاهزة ----------
    const session = (currentSession(now) ?? 'london') as SessionId;
    const proposals: Proposal[] = [];
    for (let i = 0; i < passed.length; i++) {
      const s = passed[i];
      const setup = signalToSetup(s, i + 1, session);

      // القاعدة 12: شدّ الوقف إلى السقف إن تجاوزه — تضييق فقط، ولا يوسّع أبداً
      const lot = risk.lot; // القاعدة 2: اللوت يُنقل حرفياً ولا يُحسب هنا
      if (Number.isFinite(risk.slCap) && setup.slPips > risk.slCap) {
        const capPips = risk.slCap;
        setup.slPips = capPips;
        setup.sl = setup.dir === 'buy' ? setup.entry - pips(capPips) : setup.entry + pips(capPips);
        setup.reason += ` | [القاعدة 12] شُدّ الوقف إلى سقف ${capPips} بيب`;
      }

      const riskUsd = riskOf(setup.entry, setup.sl, lot);

      proposals.push({
        setup,
        lot,
        riskDollars: Math.round(riskUsd * 100) / 100,
        evidence: {
          trend1h,
          trend4h,
          fourPoints: fourPoints.confirmed ? `${fourPoints.trend} (${(fourPoints.score * 100).toFixed(0)}%)` : 'غير مؤكد',
          lightGBM: prediction ? `${prediction.trend} ${(prediction.confidence * 100).toFixed(0)}%` : 'معطّل',
          mlConfidence: prediction?.confidence ?? 0,
        },
      });
    }

    diag.passed = proposals.length;
    diag.durationMs = Date.now() - t0;

    const snapshot: TAMSASnapshot = {
      at: now,
      structure: {
        h1, h4, d1,
        trend1h, trend4h, trend1d,
        sequence1h: pivotSequence(h1.realPivots, 6),
        consolidations,
      },
      lightGBM: prediction
        ? { trend: prediction.trend, confidence: prediction.confidence, model: prediction.model, features: features ?? {} }
        : undefined,
      fourPoints,
      signals: passed,
      blocked,
      proposals,
      risk,
      diagnostics: diag,
      summary: '',
    };
    snapshot.summary = this.describe(snapshot);
    return snapshot;
  }

  /** ملخّص عربي جاهز للعرض في الواجهة/السجل */
  describe(s: TAMSASnapshot): string {
    const parts: string[] = [];
    parts.push(`الهيكل: 1H ${s.structure.trend1h} · 4H ${s.structure.trend4h} · يومي ${s.structure.trend1d}`);
    parts.push(`تتابع المحاور: ${s.structure.sequence1h || '—'}`);
    parts.push(
      s.lightGBM
        ? `LightGBM: ${s.lightGBM.trend} بثقة ${(s.lightGBM.confidence * 100).toFixed(0)}% (${s.lightGBM.model})`
        : 'LightGBM: معطّل',
    );
    parts.push(s.fourPoints.confirmed ? `الأربع نقاط: ${s.fourPoints.reason}` : `الأربع نقاط: لا تأكيد`);
    if (!s.risk.canOpen) parts.push(`⛔ القواعد العليا: ${s.risk.blocks.join(' | ')}`);
    parts.push(
      s.proposals.length
        ? `مقترحات جاهزة: ${s.proposals.length} — ${s.proposals.map(p => `${p.setup.strategy}/${p.setup.dir}`).join(', ')}`
        : 'لا مقترحات مطابقة للبوابات',
    );
    if (s.blocked.length) {
      const by: Record<string, number> = {};
      for (const b of s.blocked) by[b.gate] = (by[b.gate] ?? 0) + 1;
      parts.push(`محجوب: ${Object.entries(by).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    }
    return parts.join(' — ');
  }
}

// ---------- نسخة واحدة جاهزة للاستخدام من الـ API ----------
export const tamsaEngine = new TAMSAEngine();

// ---------- مساعدات للتصدير ----------
export { PIP, pips };
export type { Setup, StrategyId, RealPivot };
