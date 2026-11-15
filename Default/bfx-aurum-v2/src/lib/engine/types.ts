// ============================================================
// الأنواع الأساسية لمحرك بوت الذهب XAUUSD
// وفق دليل هندسة الهيكل الفني (ملف القواعد)
// ============================================================

export interface Candle {
  t: number; // open time (ms UTC)
  o: number; h: number; l: number; c: number; v: number;
}

export type Dir = 'up' | 'down' | 'range';

export type TF = '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';

export const TF_MS: Record<string, number> = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
  '1h': 3600e3, '4h': 14400e3, '1d': 86400e3, '1w': 604800e3, '1M': 2592000e3,
};

// ---------- الهيكل السوقي ----------
export type SwingKind = 'high' | 'low';

/** قمة/قاع مكتشف (pivot) على فريم معين — معلوم لحظة تأكيده فقط */
export interface Swing {
  tf: TF;
  kind: SwingKind;
  price: number;      // أقصى/أدنى نقطة (طرف الذيل)
  idx: number;        // index في مصفوفة الفريم
  t: number;          // وقت الشمعة (open time)
  confirmedAt: number;// وقت الشمعة التي أكدت الاكتشاف (بعد k شموع)
}

export type RealKind = 'HH' | 'HL' | 'LH' | 'LL';

/** قمة/قاع حقيقي معتمد وفق الجزء الثاني من الدليل */
export interface RealPivot {
  kind: RealKind;
  tf: TF;            // الفريم الذي اعتُمد عليه (1h أساسياً)
  price: number;
  t: number;         // وقت الشمعة الحقيقية
  confirmedAt: number; // وقت اعتماده رسمياً (إغلاق شمعة 1h فوق/تحت)
  trendAtConfirm: Dir;
}

export interface StructureEvent {
  type: 'BOS' | 'CHoCH' | 'liquidity_sweep';
  tf: TF;
  dir: 'up' | 'down';
  level: number;
  t: number;         // وقت حدوث الكسر (إغلاق الشمعة الكاسرة)
  fvg?: boolean;     // مع كسر اندفاعي + فجوة سعرية
}

export interface StructureState {
  trend: Dir;                 // الاتجاه المعتمد على الفريم
  lastRealHigh?: RealPivot;   // آخر قمة حقيقية معتمدة
  lastRealLow?: RealPivot;    // آخر قاع حقيقي معتمد
  pendingTrendFlip?: Dir;     // فرضية سحب سيولة (سيناريو 1 خطوة 1)
  flipCorrectionSwing?: Swing;// القمة/القاع التصحيحي الجديد (خطوة 2)
  lastClose: number;
}

// ---------- التجميع (Consolidation) ----------
export interface Consolidation {
  top: number; bottom: number;    // حدود النطاق (أعلى قمة داخلية / أدنى قاع داخلي)
  startT: number;
  endT?: number;
  broken?: 'up' | 'down';         // اتجاه الكسر
  brokenAt?: number;
  extensionPips?: number;         // مسافة الإغلاق خارج النطاق بالبيب
  stillInside: boolean;
}

// ---------- الإشارات والصفقات ----------
// Z = المستويات اليدوية: أوامر مباشرة يحددها المستخدم من الواجهة (بلا كاشف آلي)
export type StrategyId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'Z';

export type SessionId = 'asia' | 'london' | 'londonNY' | 'ny';

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  A: 'إعادة اختبار كسر التجميع والامتداد',
  B: 'التلاعب والاختراق الثاني (اختراق كاذب)',
  C: 'الأوردر بلوك المؤسسي والإمبالانس',
  D: 'ذيول الشموع الكبرى (شهرية/أسبوعية)',
  E: 'الأرقام المئوية النفسية',
  F: 'تبادل الأدوار 1H/4H',
  G: 'تبادل الأدوار والزخم 5M/15M',
  H: 'نموذج الكويزومودو 1H/4H',
  I: 'الكويزومودو 15M',
  J: 'مناطق العرض والطلب',
  K: 'فيبوناتشي متعدد الفريمات',
  L: 'فيبوناتشي جلسة آسيا (+23.6%)',
  M: 'سحب سيولة قمة/قاع أمريكا',
  N: 'سحب سيولة ذيول الشموع الكبيرة',
  O: 'شمعة بيبا الانعكاسية',
  Z: 'المستويات اليدوية (أوامر مباشرة منك)',
};

export interface Setup {
  id: number;
  strategy: StrategyId;
  dir: 'buy' | 'sell';
  entry: number;          // سعر أمر الدخول المعلق (limit)
  slPips: number;         // الوقف الأصلي بالبيب (قبل تعديل حدود 10-15$)
  sl: number;             // سعر الوقف بعد التطبيق
  tp: number;             // الهدف بعد نسبة الربح
  createdAt: number;
  expiresAt: number;
  session: SessionId;
  reason: string;         // مسبب الدخول الفني (نص تقرير)
  refLevel: number;       // المستوى المرجعي (حد النطاق/الرقم/المستوى...)
  bestApproach?: number;  // أقرب مسافة اقتربت بها من الدخول (للإلغاء)
  fibConfirmed?: boolean; // مؤكدة بفيبو/كسر هيكلي (للأفضلية)
  setup?: 'A' | 'B';      // تسمية المواصفة للإعداد: A = الرفض، B = الكسر وإعادة الاختبار (استراتيجية E)
  slAnchor?: number;      // وقف مطلق مثبت بالقاعدة (E: قمة/قاع شمعة التأكيد ±1$) — يطبق كما هو دون حدود عامة
  market?: boolean;       // تنفيذ فوري بسعر السوق عند أول شمعة (كل الاستراتيجيات — دخول مباشر بطلب المستخدم؛ المستويات اليدوية Z تبقى limit بسعرها)
  strategyRank: number;   // رتبة السلم الزمني 1..4
}

export interface Trade {
  id: number;
  strategy: StrategyId;
  dir: 'buy' | 'sell';
  entryT: number; exitT: number;
  entry: number; exit: number; sl: number; tp: number;
  slPips: number; tpPips: number;
  result: 'tp' | 'sl' | 'time' | 'dayend' | 'news';
  pnl: number;            // بالدولار بعد السبريد
  session: SessionId;
  reason: string;
  lot: number;
  score?: number;         // درجة جودة الإشارة عند الدخول (بوابة الجودة)
  setup?: 'A' | 'B';      // تسمية المواصفة للإعداد (استراتيجية E)
  r?: number;             // نتيجة الصفقة بوحدة R (الربح ÷ مخاطرة الوقف بالدولار)
}

// ---------- الإعدادات ----------
export interface StrategySessionCfg { asia: boolean; london: boolean; londonNY: boolean; ny: boolean }

export interface GlobalRuleCfg { enabled: boolean; value?: number }

/** مستوى يدوي يحدده المستخدم من الواجهة — يُدار كأمر معلق limit */
export interface ManualLevel {
  id: string;            // معرف فريد
  price: number;         // سعر الدخول
  dir: 'buy' | 'sell';
  slDollars: number;     // مسافة الوقف بالدولار (تُطبق عليها حدود floor/cap)
  note?: string;         // ملاحظة اختيارية
  createdAt: number;
}

export interface Settings {
  sessions: Record<StrategyId, StrategySessionCfg>;
  priority: string[];                    // ترتيب بنود حل التعارضات الثلاثة
  globalRules: Record<string, GlobalRuleCfg>;
  indicators: {
    sessionTiming: boolean;
    ema: boolean; emaFast: number; emaSlow: number;
  };
  tpRatio: number;                       // 2 أو 3 (الافتراض 1:2)
  manualLevels: {                        // المستويات اليدوية (استراتيجية Z)
    enabled: boolean;
    levels: ManualLevel[];
  };
}

// بيب الذهب: 1 بيب = 0.10 دولار حركة سعرية (30 سنت سبريد = 3 بيبز)
export const PIP = 0.1;
export const pips = (n: number) => n * PIP;
export const pipsBetween = (a: number, b: number) => Math.abs(a - b) / PIP;

// الجلسات بتوقيت سوريا (UTC+3 ثابت)
export const SESSION_TIMES: Record<SessionId, { start: number; end: number }> = {
  asia: { start: 1, end: 10 },      // 01:00 - 10:00
  london: { start: 10, end: 15 },   // 10:00 - 15:00
  londonNY: { start: 15, end: 19 }, // 15:00 - 19:00
  ny: { start: 19, end: 23 },       // 19:00 - 23:00
};

export const SESSION_AR: Record<SessionId, string> = {
  asia: 'آسيا', london: 'لندن', londonNY: 'لندن ونيويورك', ny: 'نيويورك',
};

// رتب السلم الزمني للأفضلية (الجزء الحادي عشر)
// Z = المستويات اليدوية: أعلى أولوية مطلقة لأنها تعليمات مباشرة من المستخدم
export const STRATEGY_RANK: Record<StrategyId, number> = {
  Z: 0,
  D: 1, K: 1, F: 1, H: 1,
  C: 2, E: 2, J: 2,
  A: 3, B: 3, G: 3, I: 3, O: 3,
  L: 4, M: 4, N: 4,
};

export const BALANCE_BASE_DEFAULT = 1000;
