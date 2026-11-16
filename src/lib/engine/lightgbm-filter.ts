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
import { Candle, Dir, RealPivot } from './types';
import { atr, emaSeries, sma } from './indicators';

// ---------- أسماء الميزات بترتيب ثابت (يوافق ترتيب أعمدة التدريب) ----------
export const FEATURE_NAMES = [
  'ema20_gap_atr',   // (close − EMA20) ÷ ATR
  'ema50_gap_atr',   // (close − EMA50) ÷ ATR
  'ema200_gap_atr',  // (close − EMA200) ÷ ATR
  'ema20_50_atr',    // (EMA20 − EMA50) ÷ ATR
  'ema50_200_atr',   // (EMA50 − EMA200) ÷ ATR
  'atr_pct',         // ATR ÷ close × 1000
  'atr_ratio',       // ATR ÷ متوسط ATR(50)
  'rsi14',           // RSI(14) — 0..100
  'body_ratio',      // |close − open| ÷ المدى
  'range_atr',       // المدى ÷ ATR
  'vol_ratio',       // الحجم ÷ متوسط الحجم(20)
  'trend_1h',        // −1 / 0 / +1
  'trend_4h',
  'trend_1d',
  'structure_score', // رصيد HH/HL مقابل LH/LL في المحاور الحقيقية الأخيرة
  'ret_5',           // عائد 5 شموع ÷ ATR
  'ret_20',          // عائد 20 شمعة ÷ ATR
  'wick_up_ratio',   // الذيل العلوي ÷ المدى
  'wick_dn_ratio',   // الذيل السفلي ÷ المدى
] as const;

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
    acc[k] = k === 'rsi14' ? 50 : k === 'atr_ratio' || k === 'vol_ratio' ? 1 : 0;
    return acc;
  }, {} as FeatureVector);
  if (!c || c.length < 3) return empty;

  const idx = Math.max(0, Math.min(inp.idx ?? c.length - 1, c.length - 1));
  const closes = c.map(x => x.c);
  const e20s = emaSeries(c, 20);
  const e50s = emaSeries(c, 50);
  const e200s = emaSeries(c, 200);
  const atr14 = atr(c, 14);
  const atrSma50 = sma(atr14.map(v => (Number.isFinite(v) ? v : 0)), 50);
  const volSma20 = sma(c.map(x => x.v), 20);
  const rsi = rsiSeries(closes, 14);

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

  const f: FeatureVector = {
    ema20_gap_atr: gap(e20s),
    ema50_gap_atr: gap(e50s),
    ema200_gap_atr: gap(e200s),
    ema20_50_atr: rel(e20s, e50s),
    ema50_200_atr: rel(e50s, e200s),
    atr_pct: (aSafe / Math.max(close, 1e-9)) * 1000,
    atr_ratio: Number.isFinite(atrAvg) && atrAvg > 0 ? aSafe / atrAvg : 1,
    rsi14: Number.isFinite(rsi[idx]) ? rsi[idx] : 50,
    body_ratio: body / range,
    range_atr: range / aSafe,
    vol_ratio: Number.isFinite(vr) && vr > 0 ? bar.v / vr : 1,
    trend_1h: dirToNum(inp.trend1h),
    trend_4h: dirToNum(inp.trend4h),
    trend_1d: dirToNum(inp.trend1d),
    structure_score: inp.real1h ? structureScore(inp.real1h, bar.t + 1) : 0,
    ret_5: ret(5),
    ret_20: ret(20),
    wick_up_ratio: upperWick / range,
    wick_dn_ratio: lowerWick / range,
  };

  for (const k of FEATURE_NAMES) {
    if (!Number.isFinite(f[k])) f[k] = 0;
  }
  return f;
}

/**
 * النموذج البديل (Surrogate) — محاكاة سلوك شجرة تعزيز اتجاهي بلا أي اعتماد.
 * الأوزان موثقة وثابتة؛ يُستبدل بنموذج LightGBM حقيقي عبر loadModelJSON.
 */
export class SurrogateTrendModel implements LightGBMModel {
  readonly name = 'surrogate-trend-v1';

  predictRaw(f: FeatureVector): [number, number, number] {
    const common = 0.10 * (f.vol_ratio - 1) - 0.15 * Math.abs(f.atr_ratio - 1);
    const driver =
      0.95 * f.ema20_gap_atr +
      0.70 * f.ema50_gap_atr +
      0.45 * f.ema200_gap_atr +
      0.85 * f.ema20_50_atr +
      0.65 * f.ema50_200_atr +
      0.30 * f.trend_1h +
      0.55 * f.trend_4h +
      0.35 * f.trend_1d +
      0.60 * f.structure_score +
      0.25 * f.ret_5 +
      0.45 * f.ret_20 +
      0.20 * (f.rsi14 - 50) / 25;

    const up = driver + common;
    const down = -driver + common;

    // فئة العرض: تتقوى بضعف التراص واقتراب ATR من معدله وذبول البنية
    const range =
      0.35 -
      0.80 * Math.abs(f.ema20_50_atr) -
      0.45 * Math.abs(f.ema50_200_atr) -
      0.50 * Math.abs(f.structure_score) +
      0.40 * (1 - Math.min(1, Math.abs(f.atr_ratio - 1)));

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

function softmax(scores: [number, number, number] | number[], temp = 0.9): number[] {
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
  private model: LightGBMModel;
  private enabled: boolean;
  private minConfidence: number;
  private blockRange: boolean;

  constructor(opts: LightGBMFilterOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.minConfidence = opts.minConfidence ?? 0.55;
    this.blockRange = opts.blockRange ?? true;
    this.model = opts.model ?? new SurrogateTrendModel();
  }

  /** تركيب نموذج مُدرَّب حقيقي (تفريغ JSON) — يُبقي كل شيء آخر كما هو */
  loadModelJSON(dump: LgbDump, name?: string): void {
    this.model = new JsonTreeModel(dump, name);
  }

  get modelName(): string { return this.model.name; }
  get isEnabled(): boolean { return this.enabled; }
  get threshold(): number { return this.minConfidence; }

  setEnabled(on: boolean): void { this.enabled = on; }
  setMinConfidence(v: number): void { this.minConfidence = Math.min(0.95, Math.max(0.34, v)); }

  predict(f: FeatureVector): LightGBMPrediction {
    const p = softmax(this.model.predictRaw(f));
    const probs = { up: p[0], down: p[1], range: p[2] };
    const trend: PredTrend =
      probs.up >= probs.down && probs.up >= probs.range ? 'up'
        : probs.down >= probs.range ? 'down'
          : 'range';
    return { trend, confidence: probs[trend], probabilities: probs, model: this.model.name };
  }

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
