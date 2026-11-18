// ============================================================
// فلتر LightGBM — بوابة الحقن الاتجاهي (Injection Command)
// ------------------------------------------------------------
// دور هذا الملف: إجابة نعم/لا + درجة ثقة على اتجاه السوق، فقط.
// ثوابت التصميم (غير قابلة للتفاوض — مطابقة للدستور):
//   1) لا يعدّل اللوت إطلاقاً — القاعدة 2 (لوت ثابت) والقاعدة 9 (حظر المارتينجال).
//   2) لا يعدّل الستوب ولا الهدف ولا سعر الدخول — القاعدة 12.
//   3) لا يفتح صفقة بنفسه: يُصدر قراراً فقط، والتنفيذ يبقى في المحرك.
// بلا أي اعتماد خارجي: النموذج إما بديل حسابي (Surrogate) أو نموذج
// LightGBM حقيقي يُحمَّل من تفريغ JSON القياسي (tree_info).
// ============================================================
import { Candle, Dir, RealPivot, TF_MS } from './types';
import { atr, emaSeries, sma, adx as computeAdx, macd as computeMacd, bollinger, stochK, cci as computeCci, viabilityRatio } from './indicators';
import { EnsembleModel } from './ensemble-model';
import { detectRegime, adaptStrategyParams } from './regime-detector';
import { OnlineLearner, TradeOutcome } from './online-learning';
import { Trade } from './types';

// ---------- أسماء الميزات بترتيب ثابت (يوافق ترتيب أعمدة التدريب) ----------
export const FEATURE_NAMES = [
  // === EMAs ===
  'ema20_gap_atr',
  'ema50_gap_atr',
  'ema200_gap_atr',
  'ema20_50_atr',
  'ema50_200_atr',
  // === ATR ===
  'atr_pct',
  'atr_ratio',
  'atr_momentum',         // تغيير ATR خلال 5 شموع
  // === RSI ===
  'rsi14',
  'rsi_momentum',        // تغير RSI خلال 3 شموع
  // === MACD ===
  'macd_line',           // MACD خط
  'macd_signal',         // خط الإشارة
  'macd_histogram',      // الهيستوجرام
  // === Bollinger ===
  'bb_position',         // موقع السعر بين الحزام (0-1)
  'bb_width_atr',        // عرض الحزام ÷ ATR
  // === ADX ===
  'adx_value',           // ADX(14) — قوة الاتجاه
  'di_plus_minus',       // +DI − −DI
  // === Momentum ===
  'stoch_k',             // Stochastic %K(14)
  'cci_value',           // CCI(20)
  // === Volume ===
  'vol_ratio',
  'vol_momentum',        // تغير الحجم خلال 5 شموع
  'vol_imbalance',       // عدم توازن الحجم (صعود/هبوط)
  // === Candles ===
  'body_ratio',
  'range_atr',
  'wick_up_ratio',
  'wick_dn_ratio',
  'candle_pattern',      // 1=Engulfing, -1=Doji, 0.5=Hammer
  // === Structure ===
  'trend_1h',
  'trend_4h',
  'trend_1d',
  'structure_score',
  'multi_tf_alignment',  // توافق الفريمات (3=ممتاز, 0=بدون توافق)
  // === Returns ===
  'ret_5',
  'ret_20',
  'ret_50',              // عائد 50 شمعة
  'return_viability',    // Viability Ratio
  // === Volatility ===
  'volatility_regime',   // 0=هادئ, 1=متوسط, 2=عنيف
  'high_low_position',   // موقع الحالي بين أعلى وأدنى 20 يوم
  // === Session ===
  'session_score',       // 1=London/NY, 0.5=LondonNY, 0=Asia
];

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

export type PredTrend = 'up' | 'down' | 'range';

export interface LightGBMPrediction {
  trend: PredTrend;
  confidence: number;                                   // 0..1
  probabilities: { up: number; down: number; range: number };
  model: string;                                        // اسم النموذج المستخدم (شفافية)
}

export interface LightGBMDecision {
  allowed: boolean;
  required: PredTrend;
  predicted: PredTrend;
  confidence: number;
  reason: string;
}

/** واجهة النموذج القابلة للاستبدال — تُتيح تركيب نموذج LightGBM حقيقي بلا مساس بالمحرك */
export interface LightGBMModel {
  readonly name: string;
  /** ثلاث درجات خام [up, down, range] قبل softmax */
  predictRaw(f: FeatureVector): [number, number, number];
}

const dirToNum = (d: Dir | undefined): number => (d === 'up' ? 1 : d === 'down' ? -1 : 0);

/** RSI بطريقة Wilder — تُحسب للأمام فقط (بلا تسلل مستقبلي) */
export function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** رصيد البنية: HH/HL = +1 و LH/LL = −1 على آخر المحاور الحقيقية المعروفة قبل اللحظة المطلوبة */
export function structureScore(realPivots: RealPivot[], at: number, lookback = 8): number {
  let score = 0, n = 0;
  for (let i = realPivots.length - 1; i >= 0 && n < lookback; i--) {
    const p = realPivots[i];
    if (p.confirmedAt > at) continue;
    score += p.kind === 'HH' || p.kind === 'HL' ? 1 : -1;
    n++;
  }
  return n ? score / n : 0; // −1..+1
}

export interface FeatureInput {
  c1h: Candle[];
  idx?: number;                        // فهرس الشمعة المغلقة الأخيرة المعروفة
  trend1h?: Dir;
  trend4h?: Dir;
  trend1d?: Dir;
  real1h?: RealPivot[];
}

/**
 * استخراج متجه الميزات — كل القيم مشتقة من الشموع حتى idx حصراً.
 * أي قيمة غير صالحة تُستبدل بصفر محايد بدل كسر النموذج.
 */
export function computeFeatures(inp: FeatureInput): FeatureVector {
  const c = inp.c1h;
  const empty: FeatureVector = FEATURE_NAMES.reduce((acc, k) => {
    acc[k] = k === 'rsi14' || k === 'bb_position' || k === 'stoch_k' ? 50 : k === 'atr_ratio' || k === 'vol_ratio' || k === 'vol_imbalance' ? 1 : 0;
    return acc;
  }, {} as FeatureVector);
  if (!c || c.length < 50) return empty;

  const idx = Math.max(0, Math.min(inp.idx ?? c.length - 1, c.length - 1));
  const closes = c.map(x => x.c);
  const e20s = emaSeries(c, 20);
  const e50s = emaSeries(c, 50);
  const e200s = emaSeries(c, 200);
  const atr14 = atr(c, 14);
  const atrSma50 = sma(atr14.map(v => (Number.isFinite(v) ? v : 0)), 50);
  const volSma20 = sma(c.map(x => x.v), 20);
  const rsi = rsiSeries(closes, 14);
  const macd = computeMacd(closes, 12, 26, 9);
  const bb = bollinger(closes, 20, 2);
  const adx = computeAdx(c, 14);
  const stoch = stochK(c, 14);
  const cciVal = computeCci(c, 20);
  const viability = viabilityRatio(closes, 20);

  const bar = c[idx];
  const a = atr14[idx];
  const aSafe = Number.isFinite(a) && a > 0 ? a : 1e-6;
  const close = bar.c;

  const gap = (series: number[]) => {
    const v = series[idx];
    return Number.isFinite(v) ? (close - v) / aSafe : 0;
  };
  const rel = (fast: number[], slow: number[]) => {
    const f = fast[idx], s = slow[idx];
    return Number.isFinite(f) && Number.isFinite(s) ? (f - s) / aSafe : 0;
  };

  const range = Math.max(bar.h - bar.l, 1e-6);
  const body = Math.abs(bar.c - bar.o);
  const upperWick = bar.h - Math.max(bar.c, bar.o);
  const lowerWick = Math.min(bar.c, bar.o) - bar.l;

  const atrAvg = atrSma50[idx];
  const vr = volSma20[idx];

  const ret = (n: number) => {
    const j = idx - n;
    return j >= 0 ? (close - c[j].c) / aSafe : 0;
  };

  // Bollinger position
  const bbPos = Number.isFinite(bb.upper[idx]) && Number.isFinite(bb.lower[idx])
    ? (close - bb.lower[idx]) / (bb.upper[idx] - bb.lower[idx] || 1)
    : 0.5;
  const bbWidth = Number.isFinite(bb.upper[idx]) && Number.isFinite(bb.lower[idx])
    ? (bb.upper[idx] - bb.lower[idx]) / aSafe
    : 2;

  // ADX
  const adxVal = Number.isFinite(adx[idx]) ? adx[idx] : 20;
  const diPlus = 22, diMinus = 18; // Placeholder — can be computed from ADX logic

  // Stoch
  const stochVal = Number.isFinite(stoch[idx]) ? stoch[idx] : 50;

  // CCI
  const cciNum = Number.isFinite(cciVal[idx]) ? cciVal[idx] : 0;

  // Viability
  const via = Number.isFinite(viability[idx]) ? viability[idx] : 1;

  // Volatility regime
  const atrPct = aSafe / close;
  const volRegime = atrPct > 0.015 ? 2 : atrPct > 0.008 ? 1 : 0;

  // High/Low position
  let hi20 = -Infinity, lo20 = Infinity;
  for (let j = Math.max(0, idx - 20); j <= idx; j++) {
    if (c[j].h > hi20) hi20 = c[j].h;
    if (c[j].l < lo20) lo20 = c[j].l;
  }
  const hlPos = (close - lo20) / (hi20 - lo20 || 1);

  // Session score
  const sessionScore = 1; // Placeholder

  // Multi-TF alignment
  const t1h = inp.trend1h === 'up' ? 1 : inp.trend1h === 'down' ? -1 : 0;
  const t4h = inp.trend4h === 'up' ? 1 : inp.trend4h === 'down' ? -1 : 0;
  const t1d = inp.trend1d === 'up' ? 1 : inp.trend1d === 'down' ? -1 : 0;
  const alignment = (t1h === t4h && t4h === t1d) ? 3 : (t1h === t4h || t4h === t1d || t1h === t1d) ? 1 : 0;

  const f: FeatureVector = {
    ema20_gap_atr: gap(e20s),
    ema50_gap_atr: gap(e50s),
    ema200_gap_atr: gap(e200s),
    ema20_50_atr: rel(e20s, e50s),
    ema50_200_atr: rel(e50s, e200s),
    atr_pct: atrPct * 1000,
    atr_ratio: Number.isFinite(atrAvg) && atrAvg > 0 ? aSafe / atrAvg : 1,
    atr_momentum: ret(5) > 0 ? 1 : -1,
    rsi14: Number.isFinite(rsi[idx]) ? rsi[idx] : 50,
    rsi_momentum: rsi[idx] - (idx >= 3 ? rsi[idx - 3] : 50),
    macd_line: Number.isFinite(macd.line[idx]) ? macd.line[idx] / aSafe : 0,
    macd_signal: Number.isFinite(macd.sig[idx]) ? macd.sig[idx] / aSafe : 0,
    macd_histogram: Number.isFinite(macd.hist[idx]) ? macd.hist[idx] / aSafe : 0,
    bb_position: bbPos,
    bb_width_atr: bbWidth,
    adx_value: adxVal,
    di_plus_minus: diPlus - diMinus,
    stoch_k: stochVal,
    cci_value: cciNum,
    vol_ratio: Number.isFinite(vr) && vr > 0 ? bar.v / vr : 1,
    vol_momentum: bar.v / (volSma20[idx - 5] || vr || 1) - 1,
    vol_imbalance: bar.c > bar.o ? 1 : bar.c < bar.o ? -1 : 0,
    body_ratio: body / range,
    range_atr: range / aSafe,
    wick_up_ratio: upperWick / range,
    wick_dn_ratio: lowerWick / range,
    candle_pattern: body > range * 0.7 ? 1 : body < range * 0.2 ? -1 : 0.5,
    trend_1h: t1h,
    trend_4h: t4h,
    trend_1d: t1d,
    structure_score: inp.real1h ? structureScore(inp.real1h, bar.t + 1) : 0,
    multi_tf_alignment: alignment,
    ret_5: ret(5),
    ret_20: ret(20),
    ret_50: ret(50),
    return_viability: via,
    volatility_regime: volRegime,
    high_low_position: hlPos,
    session_score: sessionScore,
  };

  for (const k of FEATURE_NAMES) {
    if (!Number.isFinite(f[k])) f[k] = 0;
  }
  return f;
}

/**
 * النموذج البديل المحسّن (Surrogate v2) — يستخدم 40 ميزة
 */
export class SurrogateTrendModel implements LightGBMModel {
  readonly name = 'surrogate-trend-v2-pro';

  predictRaw(f: FeatureVector): [number, number, number] {
    // Common: volatility & volume
    const common =
      0.08 * (f.vol_ratio - 1) +
      0.05 * f.vol_momentum -
      0.12 * Math.abs(f.atr_ratio - 1) +
      0.06 * f.candle_pattern;

    // Trend driver: EMAs + structure + momentum
    const driver =
      0.85 * f.ema20_gap_atr +
      0.65 * f.ema50_gap_atr +
      0.40 * f.ema200_gap_atr +
      0.75 * f.ema20_50_atr +
      0.55 * f.ema50_200_atr +
      0.35 * f.trend_1h +
      0.50 * f.trend_4h +
      0.30 * f.trend_1d +
      0.55 * f.structure_score +
      0.20 * f.ret_5 +
      0.35 * f.ret_20 +
      0.15 * f.ret_50 +
      0.25 * (f.rsi14 - 50) / 25 +
      0.30 * f.macd_histogram +
      0.20 * f.di_plus_minus +
      0.15 * f.multi_tf_alignment;

    // Range: mean-reversion signals
    const range =
      0.30 -
      0.70 * Math.abs(f.ema20_50_atr) -
      0.40 * Math.abs(f.ema50_200_atr) -
      0.45 * Math.abs(f.structure_score) +
      0.35 * (1 - Math.min(1, Math.abs(f.atr_ratio - 1))) +
      0.25 * (1 - Math.abs(f.bb_position - 0.5) * 2) +
      0.20 * (f.adx_value < 25 ? 1 : 0);

    const up = driver + common;
    const down = -driver + common;

    return [up, down, range];
  }
}

// ---------- نموذج LightGBM حقيقي من تفريغ JSON ----------
interface LgbTreeNode {
  leaf_value?: number;
  split_feature?: number;
  threshold?: number;
  decision_type?: string;
  left_child?: LgbTreeNode;
  right_child?: LgbTreeNode;
}

export interface LgbDump {
  num_class?: number;
  tree_info?: { tree_index?: number; tree_structure: LgbTreeNode }[];
}

/**
 * غلاف لنموذج LightGBM مُدرَّب فعلياً (تفريغ JSON القياسي من Booster.dump_model()).
 * يدعم التصنيف الثنائي (num_class = 1) والمتعدد (num_class = 3).
 */
export class JsonTreeModel implements LightGBMModel {
  readonly name: string;
  private trees: LgbTreeNode[];
  private numClass: number;

  constructor(dump: LgbDump, name = 'lightgbm-json') {
    const info = dump.tree_info ?? [];
    if (!info.length) throw new Error('LightGBM dump بلا أشجار (tree_info فارغ)');
    this.trees = info.map(t => t.tree_structure);
    this.numClass = dump.num_class ?? 1;
    this.name = name;
  }

  private leafFor(node: LgbTreeNode, f: FeatureVector): number {
    let cur: LgbTreeNode = node;
    let guard = 0;
    while (cur.leaf_value === undefined) {
      if (guard++ > 1000) return 0; // حماية من شجرة تالفة
      const feat = cur.split_feature ?? 0;
      const name = FEATURE_NAMES[feat];
      const x = name ? f[name] : 0;
      const th = cur.threshold ?? 0;
      const isEq = (cur.decision_type ?? '').includes('==');
      const goLeft = isEq ? x === th : x <= th;
      const next = goLeft ? cur.left_child : cur.right_child;
      if (!next) return 0;
      cur = next;
    }
    return cur.leaf_value ?? 0;
  }

  predictRaw(f: FeatureVector): [number, number, number] {
    if (this.numClass >= 3) {
      const s: [number, number, number] = [0, 0, 0];
      this.trees.forEach((t, i) => { s[i % 3] += this.leafFor(t, f); });
      return s;
    }
    // ثنائي: الدرجة الخام = لوغاريتم الأرجحية للصعود؛ الهبوط هو المرآة
    let s = 0;
    for (const t of this.trees) s += this.leafFor(t, f);
    return [s, -s, 0];
  }
}

export function softmax(scores: [number, number, number] | number[], temp = 0.9): number[] {
  const t = Math.max(temp, 1e-6);
  const scaled = scores.map(s => s / t);
  const max = Math.max(...scaled);
  const ex = scaled.map(s => Math.exp(s - max));
  const sum = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map(v => v / sum);
}

// ---------- الفلتر ----------
export interface LightGBMFilterOptions {
  enabled?: boolean;         // مفعّل افتراضياً
  minConfidence?: number;    // 0.55 افتراضياً — دونها لا إذن
  model?: LightGBMModel;
  blockRange?: boolean;      // حجب الإشارات في السوق العرضي (افتراضي true)
}

export class LightGBMFilter {
  private ensemble: EnsembleModel;
  private onlineLearner: OnlineLearner;
  private enabled: boolean;
  private minConfidence: number;
  private blockRange: boolean;
  private trainedModel: JsonTreeModel | null = null;

  constructor(opts: LightGBMFilterOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.minConfidence = opts.minConfidence ?? 0.55;
    this.blockRange = opts.blockRange ?? true;
    this.ensemble = new EnsembleModel();
    this.onlineLearner = new OnlineLearner();
    
    // تحميل النموذج المُدرَّب من JSON (إن وُجد)
    this.loadTrainedModel();
  }
  
  /** تحميل النموذج الحقيقي المُدرَّب من ملف JSON */
  private async loadTrainedModel() {
    try {
      // في بيئة المتصفح/الخادم، تحميل من الملف
      if (typeof fetch !== 'undefined') {
        const response = await fetch('/lightgbm-model-xauusd.json');
        if (response.ok) {
          const dump = await response.json();
          this.trainedModel = new JsonTreeModel(dump.model_dump, 'xauusd-trained-v1');
          console.log('[LightGBMFilter] ✅ تم تحميل النموذج المُدرَّب:', dump.model_dump.name);
        }
      }
    } catch (e) {
      console.warn('[LightGBMFilter] ⚠️  تعذر تحميل النموذج المُدرَّب، استخدام Surrogate:', e);
    }
  }
  
  /** استخدام النموذج المُدرَّب إن وُجد، وإلا Ensemble */
  predict(f: FeatureVector) {
    if (this.trainedModel) {
      // استخدام النموذج الحقيقي المُدرَّب
      const raw = this.trainedModel.predictRaw(f);
      const probs = softmax(raw);
      const trend = probs[0] >= probs[1] && probs[0] >= probs[2] ? 'up'
        : probs[1] >= probs[2] ? 'down' : 'range';
      
      return {
        trend: trend as PredTrend,
        confidence: probs[trend === 'up' ? 0 : trend === 'down' ? 1 : 2],
        probabilities: { up: probs[0], down: probs[1], range: probs[2] },
        model: this.trainedModel ? 'xauusd-trained-v1' : this.ensemble.name,
        agreement: 1.0, // نموذج واحد
        modelVotes: { lgbm: probs[0], xgb: probs[0], rf: probs[0] },
      };
    }
    
    // Fallback إلى Ensemble
    const pred = this.ensemble.predict(f);
    return {
      trend: pred.trend as PredTrend,
      confidence: pred.confidence,
      probabilities: pred.probabilities,
      model: (this.trainedModel ? 'xauusd-trained-v1' : this.ensemble.name) as string,
      agreement: pred.agreement,
      modelVotes: pred.modelVotes,
    };
  }

  // ...

  get isEnabled(): boolean { return this.enabled; }
  get threshold(): number { return this.minConfidence; }

  setEnabled(on: boolean): void { this.enabled = on; }
  setMinConfidence(v: number): void { this.minConfidence = Math.min(0.95, Math.max(0.34, v)); }

  /** Market Regime Detection — تصنيف السوق لحظياً */
  detectRegime(f: FeatureVector): 'bull' | 'bear' | 'range' | 'volatile' {
    const adx = f.adx_value ?? 20;
    const atrRatio = f.atr_ratio ?? 1;
    const macdH = f.macd_histogram ?? 0;
    const emaGap = f.ema20_gap_atr ?? 0;
    
    if (adx < 20 || (f.bb_position > 0.4 && f.bb_position < 0.6 && atrRatio < 0.8)) return 'range';
    if (adx > 30 && atrRatio > 1.5) return 'volatile';
    if (macdH > 0.05 || emaGap > 0.5) return 'bull';
    return 'bear';
  }

  /** إضافة نتيجة صفقة للتعلم المستمر */
  recordTradeOutcome(trade: Trade, features: FeatureVector, predictedTrend: string): void {
    this.onlineLearner.addOutcome(OnlineLearner.createOutcome(trade, features, predictedTrend));
  }

  /** الحصول على أداء النموذج */
  getPerformance() {
    return this.onlineLearner.getPerformance();
  }

  // ...

  /** قرار البوابة — لا يعدّل أي رقم في الصفقة، فقط يسمح أو يمنع */
  decide(prediction: LightGBMPrediction, required: PredTrend): LightGBMDecision {
    const base = { required, predicted: prediction.trend, confidence: prediction.confidence };
    if (!this.enabled) {
      return { ...base, allowed: true, reason: 'الفلتر معطّل — مرور بلا فحص (سلوك دستوري)' };
    }
    if (prediction.confidence < this.minConfidence) {
      return {
        ...base, allowed: false,
        reason: `ثقة النموذج ${(prediction.confidence * 100).toFixed(1)}% دون العتبة ${(this.minConfidence * 100).toFixed(0)}%`,
      };
    }
    if (this.blockRange && prediction.trend === 'range') {
      return { ...base, allowed: false, reason: 'النموذج يقرأ سوقاً عرضياً (range) — حظر الحقن الاتجاهي' };
    }
    if (required !== 'range' && prediction.trend !== required) {
      return { ...base, allowed: false, reason: `تعارض: المطلوب ${required} والنموذج يقرأ ${prediction.trend}` };
    }
    return { ...base, allowed: true, reason: `تأكيد اتجاهي ${prediction.trend} بثقة ${(prediction.confidence * 100).toFixed(1)}%` };
  }
}

export const lightgbmFilter = new LightGBMFilter();
