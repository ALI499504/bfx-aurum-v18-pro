// ============================================================
// معاملات الاستراتيجيات A–R — أرقام حرفية من ملف XAU-TAMSA7.pdf
// كل رقم هنا هو القيمة الافتراضية المذكورة نصاً في الدليل، وقابلة
// للتعديل من الواجهة بأسهم التعديل (^/v) كما يفرض أمر الواجهة (ص75-76).
// ============================================================

export type TamsaCaseKey =
  | 'main'      // بند وحيد
  | 'case1' | 'case2'      // A
  | 'e1' | 'e2' | 'e3'     // E
  | 'f1' | 'f2' | 'f3'     // F
  | 'bear' | 'bull'        // J / K
  | 'r1' | 'r2'            // R
  | 'rev' | 'brk'          // ارتداد / كسر-إعادة اختبار (L, M, N, O, G)
  | 'd1' | 'd2'             // D
  | 'upper' | 'lower';      // Q (ذيول آسيا: علوي/سفلي)

export interface CaseCfg {
  enabled: boolean;
  s1: { asia: boolean; london: boolean; londonNY: boolean; ny: boolean }; // متوافق الترند
  s2: { asia: boolean; london: boolean; londonNY: boolean; ny: boolean }; // عكسي الترند
}

const S = () => ({ asia: true, london: true, londonNY: true, ny: true });
const caseCfg = (enabled = true): CaseCfg => ({ enabled, s1: S(), s2: S() });

// ---------- A: كسر النطاق العرضي لشموع 4H ----------
export interface AParams {
  enabled: boolean;
  case1: CaseCfg;            // الشموع المحصورة (Inside Bars)
  case2: CaseCfg;            // الاكتساح المزدوج (Engulfing)
  insideBars: number;        // عدد شموع الحصار (3)
  smallCandles: number;      // عدد الشموع الصغيرة قبل الاكتساح (3)
  minExtPips: number;        // الحد الأدنى للتجاوز على 5M (50)
  maxExtPips: number;        // الحد الأقصى للتجاوز على 5M (400)
  entryPips: number;         // الدخول عند اختبار الخط مباشرة (0 — خطة التحويل: لا دخول إلا على إعادة اختبار الخط)
  slPips: number;            // الوقف خلف الخط المكسور (80)
  tpPips: number;            // الهدف (150)
}

// ---------- B: التلاعب والاختراق الثاني ----------
export interface BParams {
  enabled: boolean;
  main: CaseCfg;
  realBreakPips: number;     // قاعدة الاختراق الحقيقي (500)
  bodyBreakMin: number;      // الحد الأدنى لكسر الطرف الثاني بالجسم (50)
  bodyBreakMax: number;      // الحد الأقصى للتجاوز (400)
  entryPips: number;         // الدخول عند اختبار خط الاختراق الثاني مباشرة (0 — خطة التحويل: اصطياد الكاذب عند العودة للخط)
  slPips: number;            // الوقف خلف الخط الثاني (100)
  tpPips: number;            // الهدف الثابت (200)
}

// ---------- C: سحب سيولة عكس ترند كبير + فيبو اسكالبينج ----------
export interface CParams {
  enabled: boolean;
  case1: CaseCfg;            // سحب آخر قمة حقيقية في ترند هابط
  case2: CaseCfg;            // سحب آخر قاع حقيقي في ترند صاعد
  minLevelBreakPips: number; // تجاوز مستوى 4H الصريح (100)
  internalBreakMin: number;  // الحد الأدنى لكسر الداخلي (100)
  internalBreakMax: number;  // الحد الأقصى (500)
  fibTouch: number;          // مستوى الدخول 61.8%
  slFlexMaxPips: number;     // سقف المسافة المرنة للوقف (200)
  forcedFibLevel: number;    // مستوى الوقف الإجباري عند التجاوز (80.0)
  rr: number;                // الهدف = ضعف الوقف (2.0)
}

// ---------- D: فجوة الافتتاح اليومي (آسيا) ----------
export interface DParams {
  enabled: boolean;
  d1: CaseCfg;               // صفقة الكسر الأول
  d2: CaseCfg;               // صفقة الكسر المضاد
  gapMinPips: number;        // الحد الأدنى للفجوة (12 — خطة التحويل: توسيع نافذة التجربة الظلية)
  gapMaxPips: number;        // الحد الأقصى (200 — خطة التحويل)
  bodyBreakMin: number;      // كسر الجسم خارج الخط (50)
  totalMin: number;          // التجاوز الإجمالي الأدنى (100)
  totalMax: number;          // التجاوز الإجمالي الأقصى (300)
  realBreakPips: number;     // قاعدة إلغاء D2 (500)
  entryPips: number;         // الدخول قبل الخط (20)
  slPips: number;            // الوقف (80)
  tpPips: number;            // الهدف (150)
}

// ---------- E: العرض والطلب المؤسسي ----------
export interface EParams {
  enabled: boolean;
  e1: CaseCfg;               // القاعدة الكلاسيكية
  e2: CaseCfg;               // RBD / DBR
  e3: CaseCfg;               // تلاصق 20%
  minCandles: number;        // شموع القاعدة الكلاسيكية (3)
  imp1: number;              // موجة الاندفاع الأولى RBD (3)
  imp2: number;              // موجة الاندفاع الثانية (2)
  proximityPct: number;      // نسبة التقارب (20%)
  expansionMinPips: number;  // شرط الابتعاد الأدنى (200)
  capMaxPips: number;        // سقف الابتعاد الأقصى (500)
  firstMitigationOnly: boolean; // قاعدة المرة الأولى (حرفياً: مفعلة دائماً)
  entryPips: number;         // الدخول قبل المنطقة (20)
  slPips: number;            // الوقف خلف المنطقة (50)
  tpPips: number;            // الهدف (150)
}

// ---------- F: ذيول الشموع الكبرى (شهرية/أسبوعية/يومية) ----------
export interface F1Exec {
  entryPips: number;         // ارتداد: 30
  slPips: number;            // 50
  tpPips: number;            // 100
  brkEntryPips: number;      // كسر: 30
  brkSlPips: number;         // 50
  brkTpPips: number;         // 100
  bodyBreakMin: number;      // كسر جسم 15M (50)
  totalMin: number;          // تجاوز أدنى (100)
  totalMax: number;          // تجاوز أقصى (300)
}
export interface FParams {
  enabled: boolean;
  f1: CaseCfg;               // الشهرية التاريخية
  f2: CaseCfg;               // الأسبوعية (آخر شمعة + المستودع)
  f3: CaseCfg;               // اليومية (آخر شمعة + المستودع)
  absenceHours: number;      // شرط غياب السعر F1 (48)
  absencePips: number;       // شرط الابتعاد F1 (500)
  weeklyOpenPips: number;    // ابتعاد الافتتاح الأسبوعي (300)
  dailyOpenPips: number;     // ابتعاد الافتتاح اليومي (300)
  exec: F1Exec;
  phase1Continuation?: boolean; // خطة التحويل — قلب كامل: Phase 1 يدخل مع اتجاه اليوم لا عكس الذيل (default false)
}

// ---------- G: الأرقام المئوية النفسية ----------
export interface GParams {
  enabled: boolean;
  rev: CaseCfg;              // صفقات الارتداد
  brk: CaseCfg;              // صفقات الكسر وإعادة الاختبار
  absenceHours: number;      // شرط الغياب (48)
  absencePips: number;       // شرط الابتعاد (500)
  revEntryPips: number;      // دخول الارتداد عند اختبار الرقم مباشرة (0 — خطة التحويل: انتظر اختبار الرقم لا مجرد اقترابه)
  revSlPips: number;         // وقف الارتداد (40)
  revTpPips: number;         // هدف الارتداد (150)
  breakBodyMin: number;      // كسر جسم 15M (30)
  breakTotalMin: number;     // تجاوز أدنى (100)
  breakTotalMax: number;     // تجاوز أقصى (300)
  windowHours: number;       // نافذة الكسر الزمنية (12)
  brkEntryPips: number;      // دخول الكسر (40)
  brkSlPips: number;         // وقف الكسر (40)
  brkTpPips: number;         // هدف الكسر (150)
}

// ---------- H: تبادل الأدوار 1H/4H ----------
export interface HParams {
  enabled: boolean;
  main: CaseCfg;
  breakPips: number;         // موجة الكسر الصافية (200)
  conflictPips: number;      // عتبة تعارض المستويات (100)
  conflictSlPips: number;    // وقف التعارض خلف المستوى الثاني (30)
  entryPips: number;         // الدخول قبل المستوى (30)
  slPips: number;            // الوقف الثابت (70)
  tpPips: number;            // الهدف (150)
}

// ---------- I: تبادل الأدوار والزخم 5M/15M ----------
export interface IParams {
  enabled: boolean;
  main: CaseCfg;
  waveMinPips: number;       // الحد الأدنى لموجة الزخم (200)
  waveMaxPips: number;       // الحد الأقصى (400)
  conflictPips: number;      // تعارض المستويات (100)
  conflictSlPips: number;    // وقف التعارض (30)
  entryPips: number;         // الدخول قبل المستوى (20)
  slPips: number;            // الوقف (30)
  tpPips: number;            // الهدف (100)
}

// ---------- J: الرأس والكتفين 1H/4H ----------
export interface HSExec {
  entryPips: number;         // J: 0 (خطة التحويل: عودة مؤكدة عند خط الرقبة) / K: 20
  slPips: number;            // J: 70 / K: 30
  dTargetMinPips: number;    // شرط الهدف الفني عند D (100)
  fixedTpPips: number;       // J: 150 / K: 100
  tpUseD: boolean;           // مفتاح الهدف الثنائي: D أولاً ثم الثابت
}
export interface JParams {
  enabled: boolean;
  bear: CaseCfg;
  bull: CaseCfg;
  sepCandles: number;        // شموع الفاصل الزمني (3)
  headBreakMin: number;      // كسر الرأس أدنى (100)
  headBreakMax: number;      // كسر الرأس أقصى (400)
  dZoneNear: number;         // مجال D: فوق/تحت الخط الأول (50)
  dZoneFar: number;          // وإلى المسافة الأبعد (100)
  windowMinMin: number;      // أقل مدة للعودة (60 دقيقة)
  windowMinMax: number;      // أقصى مدة (1440 دقيقة)
  exec: HSExec;
}

// ---------- K: الرأس والكتفين 5M/15M ----------
export type KParams = JParams;

// ---------- L: فيبوناتشي متعدد الفريمات ----------
export interface FibExec {
  revEntryPips: number;      // ارتداد: 40
  revSlPips: number;         // 40
  revTpPips: number;         // 150
  breakBodyMin: number;      // كسر جسم 15M (30)
  breakTotalMin: number;     // تجاوز أدنى (100)
  breakTotalMax: number;     // تجاوز أقصى (300)
  brkEntryPips: number;      // كسر: 40
  brkSlPips: number;         // 40
  brkTpPips: number;         // 150
}
export interface LParams {
  enabled: boolean;
  rev: CaseCfg;
  brk: CaseCfg;
  levels: number[];          // 38.2 / 50 / 61.8
  exec: FibExec;
}

// ---------- M: فيبوناتشي جلسة آسيا (+23.6%) ----------
export interface MParams {
  enabled: boolean;
  rev: CaseCfg;
  brk: CaseCfg;
  extraLevel: number;        // المستوى المضاف 23.6
  exec: FibExec;
}

// ---------- N: مستويات أمريكا التاريخية (آسيا + أمريكا) ----------
export interface NOExec {
  revEntryPips: number;
  revSlPips: number;
  revTpPips: number;
  bodyBreakMin: number;
  totalMin: number;
  totalMax: number;
  brkEntryPips: number;
  brkSlPips: number;
  brkTpPips: number;
}
export interface NParams {
  enabled: boolean;
  rev: CaseCfg;
  brk: CaseCfg;
  approachPips: number;      // مسافة الاقتراب والإلغاء (150)
  openDistPips: number;      // مسافة الابتعاد عند الافتتاح (250)
  // خطة التحويل (إصلاح N): الدخول عند اختبار المستوى مباشرة (revEntryPips=0) — سحب السيولة لا يُطارد قبل اختباره
  exec: NOExec;
}

// ---------- O: مستويات آسيا التاريخية (آسيا) ----------
export interface OParams {
  enabled: boolean;
  rev: CaseCfg;
  brk: CaseCfg;
  approachPips: number;      // (150)
  exec: NOExec;
  recencyDays?: number;      // خطة التحويل — حداثة المستوى: آخر 20 جلسة آسيا فقط (default 30)
}

// ---------- P: احترام أمريكا لمستوياتها (لندن ونيويورك + نيويورك) ----------
export interface PParams {
  enabled: boolean;
  rev: CaseCfg;
  approachPips: number;      // (150)
  entryPips: number;         // الدخول عند اختبار المستوى مباشرة (0 — خطة التحويل: حارس لا مطارد، أوامر عند المستوى لا قبله)
  slPips: number;            // (50)
  tpPips: number;            // (150)
}

// ---------- Q: ذيول آسيا المنفردة الكبيرة (آسيا) ----------
export interface QParams {
  enabled: boolean;
  upper: CaseCfg;            // الذيل العلوي → بيع
  lower: CaseCfg;            // الذيل السفلي → شراء
  wickMinPips: number;       // طول الذيل الأدنى (80 — خطة التحويل: تخفيف لجمع عينة)
  checkCandles: number;      // شموع الفحص قبل/بعد (3)
  isolationPips: number;     // مسافة العزل (120 — خطة التحويل)
  asiaOpenMinPips: number;   // عتبة الافتتاح الآسيوي (200)
  entryPips: number;         // (20)
  slPips: number;            // (40)
  tpPips: number;            // (150)
}

// ---------- R: شمعة بيبا الانعكاسية ----------
export interface RBeba {
  enabled: boolean;
  trendFilter: boolean;      // فلتر الترند الخاص (R1: صاعد فقط / R2: هابط فقط)
  sessions: { asia: boolean; london: boolean; londonNY: boolean; ny: boolean };
  lookback: number;          // شموع فحص القمة/القاع (5)
  minTotalPips: number;      // الطول الإجمالي الأدنى (100)
  bodyMinPct: number;        // الجسم أدنى (25%)
  bodyMaxPct: number;        // الجسم أقصى (40%)
  tailMaxPct: number;        // الذيل الصغير أقصى (5%)
  slPips: number;            // (70)
  tpPips: number;            // (200)
}
export interface RParams {
  enabled: boolean;
  r1: RBeba;
  r2: RBeba;
  tfs: { m5: boolean; m15: boolean; m30: boolean; h1: boolean };
}

// ---------- T: انفجار ضغط التقلب TTM Squeeze (Aurum VolatilitySqueeze) ----------
export interface TParams {
  enabled: boolean;
  main: CaseCfg;
  n: number;                 // فترة البولنجر/كيلتنر/الزخم (20 — Aurum)
  bbK: number;               // مضاعف البولنجر (2.0)
  kcMult: number;            // مضاعف كيلتنر × ATR (1.5)
  minSqueeze: number;        // أقل عدد شموع انضغاط قبل الانفجار (6)
  momN: number;              // فترة زخم الاتجاه (20)
  slAtrMult: number;         // الوقف = ×ATR (1.5)
  tpAtrMult: number;         // الهدف = ×ATR (3.0)
  holdBars: number;          // صلاحية الإشارة بعد الانفجار بشموع H1 (12)
}

// ---------- U: ارتداد RSI(2) كونورز (Aurum RSI2) ----------
export interface UParams {
  enabled: boolean;
  main: CaseCfg;
  rsiN: number;              // فترة RSI (2 — كونورز)
  lower: number;             // عتبة الشراء (10)
  upper: number;             // عتبة البيع (90)
  trendN: number;            // فلتر الترند SMA على 15m (200)
  slPips: number;            // الوقف (40)
  tpPips: number;            // الهدف (80)
}

// ---------- V: تلاشي الانحراف الز مع بوابة الكفاءة (Aurum ZScoreFade) ----------
export interface VParams {
  enabled: boolean;
  main: CaseCfg;
  n: number;                 // نافذة الز على H1 (48 — Aurum)
  entryZ: number;            // عتبة الدخول |z| (2.5 — خطة التحويل: عتبة أعلى جودة)
  exitZ: number;             // عتبة الخروج (0.5)
  erN: number;               // نافذة نسبة الكفاءة (48)
  erMax: number;             // بوابة السوق غير الاتجاهي (0.3)
  slPips: number;            // الوقف (60)
  tpPips: number;            // الهدف نحو المتوسط (90)
}

// ---------- W: زخم 30 يوماً TSMOM-30d — النسخة المتحقق منها في المحاكاة على أساس 1000$ ----------
// زخم بسيط: (الإغلاق ÷ إغلاق قبل horizonDays يوماً) − 1؛ إشارة عند انقلاب اتجاه الزخم،
// وقف 3×ATR(14) على الساعة، بلا هدف ثابت — الربح يُترك يجري والخروج بانعكاس الزخم
// (خروج قاعدة داخل محرك التنفيذ). لا بوابة ER عليها (أضرت بها في التجارب: +2141$ ← ‎−29$).
export interface WParams {
  enabled: boolean;
  main: CaseCfg;
  horizonDays: number;       // أفق الزخم بالأيام (30 — TSMOM-30d)
  atrN: number;              // فترة ATR على الساعة (14)
  slAtrMult: number;         // الوقف = ×ATR (3.0 — المتحقق)
  expHours: number;          // صلاحية أمر الدخول بالساعات (8)
}

// ---------- Y: زخم EWMAC 32/128 — Aurum (تحقق مزدوج: سنة +494$ PF1.26 / سنتان +1108$ PF1.43) ----------
export interface YParams {
  enabled: boolean;
  main: CaseCfg;
  fast: number;              // EMA السريع (32)
  slow: number;              // EMA البطيء (128)
  atrN: number;              // فترة ATR على الساعة (14)
  slAtrMult: number;         // الوقف = ×ATR (3.0 — المتحقق)
  expHours: number;          // صلاحية أمر الدخول بالساعات (8)
}

// ---------- AA: اختراق قناة دونشييان 120/60 — Aurum (تحقق مزدوج: سنة +529$ PF1.40 / سنتان +847$ PF1.41) ----------
export interface AAParams {
  enabled: boolean;
  main: CaseCfg;
  entryN: number;            // نافذة القناة للدخول بالشموع الساعية (120)
  exitN: number;             // نافذة القناة المعاكسة للخروج (60)
  atrN: number;              // فترة ATR على الساعة (14)
  slAtrMult: number;         // الوقف = ×ATR (2.0 — المتحقق)
  reassertBars: number;      // إعادة تأكيد الإشارة كل N شمعة ما دام الشرط قائماً (24)
  expHours: number;          // صلاحية أمر الدخول بالساعات (6)
}

// ---------- X: بولباك ويندو Sunrise Ogle (ilahuerta-IA — محقق بحثياً على بيانات MT5) ----------
export interface XParams {
  enabled: boolean;
  main: CaseCfg;
  emaFast: number;           // EMA السريع (14 — Ogle)
  emaMid: number;            // EMA الأوسط (18)
  emaSlow: number;           // EMA البطيء (24)
  pullMax: number;           // أقصى شموع بولباك تحت/فوق EMA السريع (1-3 — Ogle)
  atrN: number;              // فترة ATR (14)
  slAtrMult: number;         // الوقف = ×ATR (2.5 — Ogle)
  tpAtrMult: number;         // الهدف = ×ATR (12 — Ogle: نسبة العائد غير المتماثلة هي مصدر الحافة)
  expHours: number;          // صلاحية أمر الدخول (إعادة اختبار سعر الكسر) بالساعات (12)
}

// ---------- الحاوية الكاملة ----------

// ---------- Z: انجراف السيولة وإعادة الاستحواذ (SMC — Liquidation Sweep & Reclaim) ----------
// صيد الستوبات: شمعة ساعية تكسر قاع/قمة محور مؤكد بوشّها فقط ثم تُغلق من جديد فوق/تحته
// (إفشال الاختراق = استحواذ) — دخول ماركت على الافتتاح التالي، وقف خلف ذيل السحبة
// مع هامش، هدف = rr × الوقف (عائد غير متماثل كما في مقارنة X البحثية).
export interface ZParams {
  enabled: boolean;
  main: CaseCfg;
  pivotStrength: number;    // شموع تأكيد المحور على كل جانب (3)
  lookback: number;         // نافذة بحث المحور المؤكد بالشموع الساعية (40)
  minSweepPips: number;     // عمق السحبة الأدنى خلف المحور بالبيبز (15)
  slBufPips: number;        // هامش الوقف خلف ذيل السحبة بالبيبز (15)
  rr: number;               // الهدف = rr × مسافة الوقف (2.0)
  expHours: number;         // صلاحية الأمر بالساعات (2)
}

// ---------- BB: اختراق افتتاح لندن (Aurum London Breakout) ----------
// النطاق = أول rangeMin دقيقة بعد افتتاح جلسة لندن بالتوقيت السوري (10:00)،
// الدخول بأمر سوق عند إغلاق شمعة 5m يتجاوز النطاق + هامش، إشارة واحدة يومياً.
export interface BBParams {
  enabled: boolean;
  main: CaseCfg;
  rangeMin: number;         // دقائق نطاق الافتتاح (30)
  bufferPips: number;       // هامش الاختراق فوق/تحت النطاق بالبيبز (10)
  minRangePips: number;     // أقل عرض نطاق مقبول بالبيبز (40 — لا أيام ميتة)
  maxRangePips: number;     // أكبر عرض نطاق مقبول بالبيبز (600 — لا أيام مجنونة)
  slAtrMult: number;        // الوقف = ×ATR(14) على 5m (1.2)
  minSlPips: number;        // أرضية الوقف بالبيبز (25)
  tpR: number;              // الهدف = tpR × مسافة الوقف (2.0)
  entryUntilHour: number;   // آخر ساعة سورية للدخول (15 — لندن + لندن/نيويورك)
}

// ---------- CC: سلحفاة دونشييان 55 ساعي (Aurum Turtle) ----------
// اختراق إغلاق ساعي لأعلى/أدنى 55 شمعة سابقة، وقف 2×ATR(22)، هدف 4×ATR (2R)،
// آلة حالة: لا إشارة جديدة بنفس الاتجاه قبل كسر قناة الخروج 20 ضد الصفقة.
export interface CCParams {
  enabled: boolean;
  main: CaseCfg;
  entryN: number;           // فترة قناة الدخول بالساعات (55)
  exitN: number;            // فترة قناة الخروج/إعادة الضبط بالساعات (20)
  atrN: number;             // فترة ATR بالساعات (22)
  slAtrMult: number;        // الوقف = ×ATR (2.0 — وحدة السلحفاة N)
  tpAtrMult: number;        // الهدف = ×ATR (4.0 — هدف 2R)
  minSlPips: number;        // أرضية الوقف بالبيبز (40)
}

// ---------- DD: ارتداد EMA20/50 مع الاتجاه على 15 دقيقة (Aurum Pullback) ----------
// ترندينت: الإغلاق فوق EMA50 و EMA20>EMA50 (صعود) أو عكسه (هبوط). انتظار لمس
// EMA20 ثم شمعة مغلقة صاعدة فوقه → دخول سوقي. وقف 1.5×ATR(14) وهدف 2R.
export interface DDParams {
  enabled: boolean;
  main: CaseCfg;
  fastN: number;            // فترة EMA السريعة (20)
  slowN: number;            // فترة EMA البطيئة (50)
  armedMaxBars: number;     // صلاحية انتظار التفعيل بعد لمس EMA20 بالشموع (6)
  stateMaxBars: number;     // أقصى شموع قبل إعادة ضبط آلة الحالة (24)
  slAtrMult: number;        // الوقف = ×ATR(14) على 15m (1.5)
  minSlPips: number;        // أرضية الوقف بالبيبز (20)
  tpR: number;              // الهدف = tpR × مسافة الوقف (2.0)
}

export interface TamsaParams {
  A: AParams; B: BParams; C: CParams; D: DParams; E: EParams; F: FParams;
  G: GParams; H: HParams; I: IParams; J: JParams; K: KParams; L: LParams;
  M: MParams; N: NParams; O: OParams; P: PParams; Q: QParams; R: RParams;
  T: TParams; U: UParams; V: VParams; W: WParams; X: XParams; Y: YParams; AA: AAParams; BB: BBParams; CC: CCParams; DD: DDParams; Z: ZParams;
}

export const DEFAULT_TAMSA_PARAMS: TamsaParams = {
  A: {
    enabled: true,
    case1: caseCfg(true), case2: caseCfg(true),
    insideBars: 3, smallCandles: 3,
    minExtPips: 50, maxExtPips: 400,
    entryPips: 0, slPips: 80, tpPips: 150, // خطة التحويل: دخول عند إعادة اختبار الخط — الوقف يبقى 80 بيب خلفه
  },
  B: {
    enabled: false,
    main: caseCfg(true),
    realBreakPips: 500, bodyBreakMin: 50, bodyBreakMax: 400,
    entryPips: 0, slPips: 100, tpPips: 200, // خطة التحويل: الدخول عند اختبار الخط الثاني لا قبله
  },
  C: {
    enabled: false,
    case1: caseCfg(true), case2: caseCfg(true),
    minLevelBreakPips: 100, internalBreakMin: 100, internalBreakMax: 500,
    fibTouch: 61.8, slFlexMaxPips: 200, forcedFibLevel: 80.0, rr: 2.0,
  },
  D: {
    enabled: false,
    d1: caseCfg(true), d2: caseCfg(true),
    gapMinPips: 12, gapMaxPips: 200,
    bodyBreakMin: 50, totalMin: 100, totalMax: 300, realBreakPips: 500,
    entryPips: 20, slPips: 80, tpPips: 150,
  },
  E: {
    enabled: true,
    e1: caseCfg(true), e2: caseCfg(true), e3: caseCfg(true),
    minCandles: 3, imp1: 3, imp2: 2, proximityPct: 20,
    expansionMinPips: 200, capMaxPips: 500, firstMitigationOnly: true,
    entryPips: 20, slPips: 50, tpPips: 150,
  },
  F: {
    enabled: true,
    f1: caseCfg(true), f2: caseCfg(true), f3: caseCfg(true),
    absenceHours: 48, absencePips: 500,
    weeklyOpenPips: 300, dailyOpenPips: 300,
    exec: { entryPips: 30, slPips: 50, tpPips: 100, brkEntryPips: 30, brkSlPips: 50, brkTpPips: 100, bodyBreakMin: 50, totalMin: 100, totalMax: 300 },
  },
  G: {
    enabled: false,
    rev: caseCfg(true), brk: caseCfg(true),
    absenceHours: 48, absencePips: 500,
    revEntryPips: 0, revSlPips: 40, revTpPips: 150, // خطة التحويل: انتظر اختبار الرقم لا مجرد اقترابه
    breakBodyMin: 30, breakTotalMin: 100, breakTotalMax: 300, windowHours: 12,
    brkEntryPips: 40, brkSlPips: 40, brkTpPips: 150,
  },
  H: {
    enabled: true,
    main: caseCfg(true),
    breakPips: 200, conflictPips: 100, conflictSlPips: 30,
    entryPips: 30, slPips: 70, tpPips: 150,
  },
  I: {
    enabled: false,
    main: caseCfg(true),
    waveMinPips: 200, waveMaxPips: 400, conflictPips: 100, conflictSlPips: 30,
    entryPips: 20, slPips: 30, tpPips: 100,
  },
  J: {
    enabled: false,
    bear: caseCfg(true), bull: caseCfg(true),
    sepCandles: 3, headBreakMin: 100, headBreakMax: 400,
    dZoneNear: 50, dZoneFar: 100,
    windowMinMin: 60, windowMinMax: 1440,
    exec: { entryPips: 0, slPips: 70, dTargetMinPips: 100, fixedTpPips: 150, tpUseD: true }, // خطة التحويل: عودة مؤكدة عند خط الرقبة لا قبله
  },
  K: {
    enabled: true,
    bear: caseCfg(true), bull: caseCfg(true),
    sepCandles: 3, headBreakMin: 100, headBreakMax: 400,
    dZoneNear: 50, dZoneFar: 100,
    windowMinMin: 60, windowMinMax: 1440,
    exec: { entryPips: 20, slPips: 30, dTargetMinPips: 100, fixedTpPips: 100, tpUseD: true },
  },
  L: {
    enabled: true,
    rev: caseCfg(true), brk: caseCfg(true),
    levels: [38.2, 50.0, 61.8],
    exec: { revEntryPips: 40, revSlPips: 40, revTpPips: 150, breakBodyMin: 30, breakTotalMin: 100, breakTotalMax: 300, brkEntryPips: 40, brkSlPips: 40, brkTpPips: 150 },
  },
  M: {
    enabled: true,
    rev: caseCfg(true), brk: caseCfg(true),
    extraLevel: 23.6,
    exec: { revEntryPips: 40, revSlPips: 40, revTpPips: 150, breakBodyMin: 30, breakTotalMin: 100, breakTotalMax: 300, brkEntryPips: 40, brkSlPips: 40, brkTpPips: 150 },
  },
  N: {
    enabled: true,
    rev: caseCfg(true), brk: caseCfg(true),
    approachPips: 150, openDistPips: 250,
    exec: { revEntryPips: 0, revSlPips: 60, revTpPips: 150, bodyBreakMin: 50, totalMin: 100, totalMax: 300, brkEntryPips: 40, brkSlPips: 40, brkTpPips: 150 }, // خطة التحويل: سحب السيولة عند اختبار المستوى مباشرة
  },
  O: {
    enabled: false,
    rev: caseCfg(true), brk: caseCfg(true),
    approachPips: 150,
    exec: { revEntryPips: 20, revSlPips: 40, revTpPips: 100, bodyBreakMin: 50, totalMin: 100, totalMax: 300, brkEntryPips: 40, brkSlPips: 40, brkTpPips: 150 },
  },
  P: {
    enabled: false,
    rev: caseCfg(true),
    approachPips: 150, entryPips: 0, slPips: 50, tpPips: 150, // خطة التحويل: حارس لا مطارد — أمر عند المستوى لا قبله
  },
  Q: {
    enabled: false,
    upper: caseCfg(true), lower: caseCfg(true),
    wickMinPips: 80, checkCandles: 3, isolationPips: 120, asiaOpenMinPips: 200,
    entryPips: 20, slPips: 40, tpPips: 150,
  },
  R: {
    enabled: false,
    r1: { enabled: true, trendFilter: true, sessions: S(), lookback: 5, minTotalPips: 100, bodyMinPct: 25, bodyMaxPct: 40, tailMaxPct: 5, slPips: 70, tpPips: 200 },
    r2: { enabled: true, trendFilter: true, sessions: S(), lookback: 5, minTotalPips: 100, bodyMinPct: 25, bodyMaxPct: 40, tailMaxPct: 5, slPips: 70, tpPips: 200 },
    tfs: { m5: true, m15: true, m30: true, h1: true },
  },
  // سلسلة Aurum (T–AA) — القيم بعد التحقق المزدوج (سنة + سنتان على شموع MT5 الحقيقية):
  // رُفضت نهائياً: ORB-S (حُذف نهائياً PF 0.78) وT.squeeze وU.rsi2 وV.zfade (PF<1 في النافذتين)
  // وقُبلت: W.tsmom وX.ogle (السلة المعتمدة) وY.ewmac وAA.donchian (PF>1.26 في النافذتين)
  T: {
    enabled: false,
    main: caseCfg(true),
    n: 20, bbK: 2.0, kcMult: 1.5, minSqueeze: 6, momN: 20,
    slAtrMult: 1.5, tpAtrMult: 3.0, holdBars: 12,
  },
  U: {
    enabled: false,
    main: caseCfg(true),
    rsiN: 2, lower: 10, upper: 90, trendN: 200,
    slPips: 40, tpPips: 80,
  },
  V: {
    enabled: false,
    main: caseCfg(true),
    n: 48, entryZ: 2.5, exitZ: 0.5, erN: 48, erMax: 0.3,
    slPips: 60, tpPips: 90,
  },
  W: {
    // معطل في المحرك الحي: مكوّن السلة المعتمدة يعمل في مساره الظلي المستقل
    // (src/lib/engine/basket.ts) — القياس الحي أثبت أن تشغيله داخل المحرك
    // المزدحم يخنقه (3 صفقات بدل 26) ويسيء تمثيل نتائج الاعتماد
    enabled: false,
    main: caseCfg(true),
    horizonDays: 30, atrN: 14, slAtrMult: 3.0, expHours: 8,
  },
  Y: {
    enabled: false,
    main: caseCfg(true),
    fast: 32, slow: 128, atrN: 14, slAtrMult: 3.0, expHours: 8,
  },
  AA: {
    enabled: false,
    main: caseCfg(true),
    entryN: 120, exitN: 60, atrN: 14, slAtrMult: 2.0, reassertBars: 24, expHours: 6,
  },
  X: {
    enabled: false,
    main: caseCfg(true),
    emaFast: 14, emaMid: 18, emaSlow: 24, pullMax: 3,
    atrN: 14, slAtrMult: 2.5, tpAtrMult: 12, expHours: 12,
  },
  Z: {
    enabled: false,
    main: caseCfg(true),
    pivotStrength: 3, lookback: 40, minSweepPips: 15,
    slBufPips: 15, rr: 2.0, expHours: 2,
  },
  BB: {
    enabled: false,
    main: caseCfg(true),
    rangeMin: 30, bufferPips: 10, minRangePips: 40, maxRangePips: 600,
    slAtrMult: 1.2, minSlPips: 25, tpR: 2.0, entryUntilHour: 15,
  },
  CC: {
    enabled: false,
    main: caseCfg(true),
    entryN: 55, exitN: 20, atrN: 22,
    slAtrMult: 2.0, tpAtrMult: 4.0, minSlPips: 40,
  },
  DD: {
    enabled: false,
    main: caseCfg(true),
    fastN: 20, slowN: 50, armedMaxBars: 6, stateMaxBars: 24,
    slAtrMult: 1.5, minSlPips: 20, tpR: 2.0,
  },
};

/** الجلسات المسموحة حرفياً لكل استراتيجية وفق الدليل (تقفل البقية برمز القفل الرمادي) */
export const ALLOWED_SESSIONS: Record<keyof TamsaParams, SessionKey[]> = {
  A: ['asia', 'london', 'londonNY', 'ny'],
  B: ['asia', 'london', 'londonNY', 'ny'],
  C: ['asia', 'london', 'londonNY', 'ny'],
  D: ['asia'],
  E: ['asia', 'london', 'londonNY', 'ny'],
  F: ['asia', 'london', 'londonNY', 'ny'],
  G: ['asia', 'london', 'londonNY', 'ny'],
  H: ['asia', 'london', 'londonNY', 'ny'],
  I: ['asia', 'london', 'londonNY', 'ny'],
  J: ['asia', 'london', 'londonNY', 'ny'],
  K: ['asia', 'london', 'londonNY', 'ny'],
  L: ['asia', 'london', 'londonNY', 'ny'],
  M: ['asia'],
  N: ['asia', 'ny'],
  O: ['asia'],
  P: ['londonNY', 'ny'],
  Q: ['asia'],
  R: ['asia', 'london', 'londonNY', 'ny'],
  T: ['asia', 'london', 'londonNY', 'ny'],
  U: ['asia', 'london', 'londonNY', 'ny'],
  V: ['asia', 'london', 'londonNY', 'ny'],
  W: ['asia', 'london', 'londonNY', 'ny'],
  X: ['asia', 'london', 'londonNY', 'ny'],
  Y: ['asia', 'london', 'londonNY', 'ny'],
  AA: ['asia', 'london', 'londonNY', 'ny'],
  BB: ['london', 'londonNY'],
  CC: ['asia', 'london', 'londonNY', 'ny'],
  DD: ['london', 'londonNY', 'ny'],
  Z: ['asia', 'london', 'londonNY', 'ny'],
};

export type SessionKey = 'asia' | 'london' | 'londonNY' | 'ny';

/** خريطة البنود لعرضها في واجهة الاستراتيجيات (شجرة A–R) */
export const CASE_LABELS: Record<string, string> = {
  main: 'البند الرئيسي',
  case1: 'الحالة الأولى (شموع الحصار)', case2: 'الحالة الثانية (الاكتساح المزدوج)',
  e1: 'E1: القاعدة الكلاسيكية', e2: 'E2: الارتكاز المبتلع RBD/DBR', e3: 'E3: تلاصق 20%',
  f1: 'F1: الشهرية التاريخية', f2: 'F2: الأسبوعية', f3: 'F3: اليومية',
  bear: 'النموذج الهابط', bull: 'النموذج الصاعد المقلوب',
  r1: 'R1: بيبا شرائية في القيعان', r2: 'R2: بيبا بيعية في القمم',
  rev: 'صفقات الارتداد الأولى', brk: 'صفقات الكسر وإعادة الاختبار',
  d1: 'D1: الكسر الأول', d2: 'D2: الكسر المضاد',
  upper: 'الذيل العلوي (بيع)', lower: 'الذيل السفلي (شراء)',
};

/**
 * تسميات بنود خاصة لكل استراتيجية — تفوق CASE_LABELS عند وجود تسمية
 * خاصة. مثلاً C: case1 = سحب آخر قمة، case2 = سحب آخر قاع (وليس شموع
 * الحصار/الاكتساح كـ A). تستخدمها واجهة الاستراتيجيات لعرض أسماء حرفية.
 */
export const STRATEGY_CASE_LABELS: Record<string, Record<string, string>> = {
  C: {
    case1: 'الحالة 1: سحب آخر قمة 4H (ترند هابط → بيع)',
    case2: 'الحالة 2: سحب آخر قاع 4H (ترند صاعد → شراء)',
  },
};

/** بنود كل استراتيجية بالترتيب — لبناء الشجرة في الواجهة */
export const STRATEGY_CASES: Record<keyof TamsaParams, TamsaCaseKey[]> = {
  A: ['case1', 'case2'],
  B: ['main'],
  C: ['case1', 'case2'],
  D: ['d1', 'd2'],
  E: ['e1', 'e2', 'e3'],
  F: ['f1', 'f2', 'f3'],
  G: ['rev', 'brk'],
  H: ['main'],
  I: ['main'],
  J: ['bear', 'bull'],
  K: ['bear', 'bull'],
  L: ['rev', 'brk'],
  M: ['rev', 'brk'],
  N: ['rev', 'brk'],
  O: ['rev', 'brk'],
  P: ['rev'],
  Q: ['upper', 'lower'],
  R: ['r1', 'r2'],
  T: ['main'],
  U: ['main'],
  V: ['main'],
  W: ['main'],
  X: ['main'],
  Y: ['main'],
  AA: ['main'],
  BB: ['main'],
  CC: ['main'],
  DD: ['main'],
  Z: ['main'],
};


