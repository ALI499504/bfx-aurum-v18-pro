// ============================================================
// الأنواع الأساسية لمحرك بوت الذهب XAUUSD
// وفق دليل XAU-TAMSA7.pdf — الاستراتيجيات A–R الحرفية
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

// ---------- الهيكل السوقي (الجزء صفر) ----------
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

/** قمة/قاع حقيقي معتمد وفق الجزء صفر من الدليل */
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

// ---------- التجميع (Consolidation Zone — 6 ساعات حرفياً) ----------
export interface Consolidation {
  top: number; bottom: number;    // حدود النطاق
  startT: number;
  endT?: number;
  broken?: 'up' | 'down';         // اتجاه الكسر
  brokenAt?: number;
  extensionPips?: number;         // مسافة الإغلاق خارج النطاق بالبيب
  stillInside: boolean;
}

// ---------- الإشارات والصفقات ----------
// T–X = سلسلة Aurum المنقولة من مستودع zero-was-here/tradingbot (محققة بحثياً)
// Y/AA = إضافات Aurum الحاصلة على التحقق المزدوج (نافذة سنة + سنتين) من المقارنة الشاملة
// Z = المستويات اليدوية: أوامر مباشرة يحددها المستخدم من الواجهة (خارج دليل A–R)
// ملاحظة: الرمز S كان ORB وحُذف نهائياً بقرار التحقق (PF 0.78 — أدنى مرفوض)،
// والرمز محجوز للتاريخ ولا يُعاد استخدامه حفاظاً على سلامة سجلات الصفقات القديمة.
export type StrategyId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'AA' | 'BB' | 'CC' | 'DD' | 'Z';

export type SessionId = 'asia' | 'london' | 'londonNY' | 'ny';

/** الأسماء الحرفية من الدليل (ص75: القائمة الرئيسية الحاكمة) */
export const STRATEGY_NAMES: Record<StrategyId, string> = {
  A: 'كسر النطاق العرضي لشموع الأربع ساعات',
  B: 'التلاعب والاختراق الثاني (الاختراق الكاذب)',
  C: 'سحب سيولة عكس ترند كبير وترميم اسكالبينج الفيبو',
  D: 'كسر فجوة الافتتاح اليومي',
  E: 'مناطق العرض والطلب المؤسسية',
  F: 'ذيول الشموع الكبرى الكلية والتاريخية',
  G: 'الأرقام المئوية النفسية القوية',
  H: 'تبادل الأدوار الفني للفريمات الكبيرة 1H/4H',
  I: 'تبادل الأدوار للفريمات الصغيرة والزخم الحاد 5M/15M',
  J: 'نموذج الرأس والكتفين الهندسي المطور 1H/4H',
  K: 'نموذج الرأس والكتفين للفريمات الصغيرة 5M/15M',
  L: 'صفقات فيبوناتشي العامة للفريمات المتعددة',
  M: 'فيبوناتشي جلسة آسيا المعدل (+23.6%)',
  N: 'تتبع وسحب سيولة قمم وقيعان أمريكا التاريخية',
  O: 'ارتداد وسحب سيولة قمم وقيعان آسيا التاريخية',
  P: 'احترام صانع السوق لقمم وقيعان أمريكا التاريخية',
  Q: 'سحب سيولة ذيول الشموع الكبيرة المخصصة لآسيا',
  R: 'نموذج شمعة بيبا الانعكاسية المطورة',
  T: 'انفجار ضغط التقلب TTM Squeeze (Aurum — معطل بالتحقق)',
  U: 'ارتداد RSI(2) كونورز مع فلتر الترند (Aurum — معطل بالتحقق)',
  V: 'تلاشي الانحراف الز مع بوابة الكفاءة (Aurum — معطل بالتحقق)',
  W: 'زخم 30 يوماً TSMOM-30d — مكوّن السلة المعتمدة (مسار الظل المستقل على أساس 1000$)',
  X: 'بولباك ويندو Sunrise Ogle — مكوّن السلة المعتمدة (مسار الظل المستقل على أساس 1000$)',
  Y: 'زخم EWMAC 32/128 — تحت المراقبة في جدول السلة (خارج المحرك)',
  AA: 'اختراق قناة دونشييان 120/60 — تحت المراقبة في جدول السلة (خارج المحرك)',
  BB: 'اختراق افتتاح لندن (نطاق أول 30 دقيقة — مرشح Aurum تحت التحقق)',
  CC: 'سلحفاة دونشييان 55 ساعي (خروج 20 — مرشح Aurum تحت التحقق)',
  DD: 'ارتداد EMA20/50 مع الاتجاه على 15 دقيقة (Pullback — مرشح Aurum تحت التحقق)',
  Z: 'انجراف السيولة وإعادة الاستحواذ (SMC) — صيد الستوبات ثم الاستحواذ',
};

export interface Setup {
  id: number;
  strategy: StrategyId;
  case?: string;          // البند الفرعي (case1/case2/rev/brk/...)
  scenario?: 1 | 2;       // السيناريو: 1 = متوافق الترند، 2 = عكسي
  dir: 'buy' | 'sell';
  entry: number;          // سعر التنفيذ الماركت (عند اقتراب السعر من الخط)
  slPips: number;         // الوقف بالبيب من سعر الدخول
  tpPips: number;         // الهدف بالبيب من سعر الدخول
  sl: number;
  tp: number;
  createdAt: number;
  expiresAt: number;
  session: SessionId;
  reason: string;         // مسبب الدخول الفني (نص تقرير)
  refLevel: number;       // المستوى المرجعي (حد النطاق/الرقم/المستوى...)
  bestApproach?: number;  // أقرب مسافة اقتربت بها من الدخول (قاعدة 19)
  approachExtreme?: number; // أقصى تمدد بعد الاقتراب (قاعدة 19)
  levelKey?: string;      // مفتاح الاستهلاك (قاعدة المرة الواحدة)
  allowedSessions?: SessionId[]; // الجلسات المسموح بها للبند — تُفحص لحظة التنفيذ
  slAnchor?: number;      // وقف مطلق مثبت بالقاعدة (C: مستوى فيبو 80%)
  market?: boolean;       // تنفيذ فوري بسعر السوق عند بلوغ نقطة الدخول
}

export interface Trade {
  id: number;
  strategy: StrategyId;
  case?: string;
  scenario?: 1 | 2;
  dir: 'buy' | 'sell';
  entryT: number; exitT: number;
  entry: number; exit: number; sl: number; tp: number;
  slPips: number; tpPips: number;
  result: 'tp' | 'sl' | 'time' | 'dayend' | 'news' | 'rule';
  pnl: number;            // بالدولار بعد السبريد
  session: SessionId;
  reason: string;
  lot: number;
  r?: number;             // نتيجة الصفقة بوحدة R (الربح ÷ مخاطرة الوقف)
  levelKey?: string;      // مفتاح الاستهلاك (قاعدة المرة الواحدة)
}

// ---------- الإعدادات المرجعية ----------
/** مستوى يدوي يحدده المستخدم من الواجهة — يُدار كأمر معلق limit */
export interface ManualLevel {
  id: string;
  price: number;
  dir: 'buy' | 'sell';
  slDollars: number;
  note?: string;
  createdAt: number;
}

// بيب الذهب: 1 بيب = 0.10 دولار حركة سعرية (30 سنت سبريد = 3 بيبز) — قاعدة 18
export const PIP = 0.1;
export const pips = (n: number) => n * PIP;
export const pipsBetween = (a: number, b: number) => Math.abs(a - b) / PIP;

// الجلسات بتوقيت دمشق (UTC+3 ثابت)
export const SESSION_TIMES: Record<SessionId, { start: number; end: number }> = {
  asia: { start: 1, end: 10 },      // 01:00 - 10:00
  london: { start: 10, end: 15 },   // 10:00 - 15:00
  londonNY: { start: 15, end: 19 }, // 15:00 - 19:00
  ny: { start: 19, end: 23 },       // 19:00 - 23:00
};

export const AURUM_SERIES_IDS: StrategyId[] = ['T', 'U', 'V', 'W', 'X', 'Y', 'AA'];

/** مكوّنات السلة المعتمدة (المحاكاة على أساس 1000$) — تعمل في مسارها الظلي المستقل
 *  (src/lib/engine/basket.ts + /api/basket) ولا تُدار من محرك TAMSA ولا من المدير الآلي */
export const BASKET_IDS: StrategyId[] = ['W', 'X', 'Y', 'AA'];

export const SESSION_AR: Record<SessionId, string> = {
  asia: 'آسيا', london: 'لندن', londonNY: 'لندن ونيويورك', ny: 'نيويورك',
};

export const BALANCE_BASE_DEFAULT = 1000; // قاعدة 13
