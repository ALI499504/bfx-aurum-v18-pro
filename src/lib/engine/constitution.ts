// ============================================================
// الدستور التشغيلي المُلزم — وفق ملف XAU-TAMSA7.pdf حصراً
// «أنت وكيل تنفيذ قواعد نظام TAMSA على XAUUSD. دورك تطبيق القواعد
//  المكتوبة بالحرف، لا تحليل حر ولا اجتهاد شخصي. إذا تعارض أي شيء
//  تفعله أو تظنه مع الدليل، الدليل ينتصر.»
//
// التسلسل الهرمي (قاعدة 21): القواعد العليا ← سلم أولويات الجلسة ←
// الشروط الداخلية لكل استراتيجية. كل الأرقام قابلة للتعديل من الواجهة
// بأسهم التعديل كما يفرض أمر الواجهة — لا حقول مجمّدة خارج الدليل.
// ============================================================

/** خريطة البنود — تسمية المواصفة الحرفية من الدليل */
export const SETUP_MAP: Record<'A' | 'B', string> = {
  A: 'كسر النطاق العرضي لشموع الأربع ساعات',
  B: 'التلاعب والاختراق الثاني (الاختراق الكاذب)',
};

/** النص الإلزامي — القواعد العليا الـ21 (ص80–83) ملخصة حرفياً */
export const CONSTITUTION_RULES: string[] = [
  '1) التداول على XAUUSD حصراً — تجميد ومنع أي أصل آخر.',
  '2) لوت ثابت 0.01 دائماً دون أي تغيير ديناميكي.',
  '3) لا إغلاق أي صفقة قبل مرور 4 دقائق كاملة من فتحها.',
  '4) إغلاق الصفقة إجبارياً فور بلوغ 72 ساعة (ثلاثة أيام) من فتحها — سقف المالك المعتمد («لا أريد صفقة أكثر من يومين أو ثلاثة أيام»)، لا صفقة تبقى مفتوحة أكثر من ثلاثة أيام أبداً.',
  '5) التوقف التام عند تنفيذ 50 صفقة في اليوم الواحد.',
  '6) مراقبة تحقيق صفقة واحدة على الأقل يومياً (تنبيه ومراقبة).',
  '7) إيقاف العمل فوراً عند خسارة يومية صافية 50 دولاراً.',
  '8) حظر التداول عند تحقيق ربح يومي صافٍ 200 دولار.',
  '9) منع قاطع للمارتنجال والمضاعفات بعد الخسارة.',
  '10) صفقة نشطة واحدة في السوق — لا جديد حتى إغلاقها.',
  '11) حظر الاستاكنج والتبريد والهيدج تماماً.',
  '12) الالتزام الكامل بوقف الخسارة المحسوب — لا توسيع ولا تحريك ضد الاتجاه، والحد الأقصى لمسافة الوقف 15 دولاراً من سعر الدخول: أي وقف أوسع يُشدّ إلى 15$ لحظة التنفيذ (قرار المالك 2026-11-12).',
  '13) النسب المئوية تُحسب على رصيد ثابت 1000 دولار لا على الرصيد المتحرك.',
  '14) حظر التداول قبل الخبر القوي بـ15 دقيقة وبعده بـ60 دقيقة.',
  '15) حظر أول 30 دقيقة من افتتاح سوق الذهب اليومي.',
  '16) حظر آخر 60 دقيقة قبل إغلاق سوق الذهب اليومي.',
  '17) سبريد ثابت 30 سنتاً (3 بيبز) في كل الباك تيست والاختبارات الحية.',
  '18) هامش انزلاق ±1 دولار (10 بيبز): ضمنه تُقبل الصفقة، وفوقه تُلغى.',
  '19) الفرصة الفائتة: اقتراب ≤50 بيب دون لمس ثم انعطاف ≥100 بيب بالاتجاه → إبطال وحذف.',
  '20) التأمين: أُلغي كلياً بقرار المالك (2026-11-12) — لا سحب للوقف عند الدخول ولا حجز ربح؛ الوقف يبقى بمكانه الفني من لحظة الدخول حتى الخروج أو الستوب أو السقف الزمني.',
  '21) التسلسل الهرمي: القواعد العليا ← سلم الأولويات ← شروط الاستراتيجية — بلا استثناء.',
  // ---------- صمامات المخاطر المعتمدة (خطة السلة على أساس 1000$) ----------
  '22) صمام السلة اليومي 3% من الأساس: لا دخول جديد داخل السلة الظلية عند تجاوزه.',
  '23) صمام السلة الأسبوعي 6% من الأساس: لا دخول جديد لبقية الأسبوع.',
  '24) حاجز كارثة السلة: لا دخول جديد عند هبوط الإيكويتي دون 50% من الأساس.',
  '25) سقف الصفقات المتزامنة الكلية 4 — عائلة TAMSA صفقة نشطة واحدة، والسلة توازي مكوناتها.',
  // ---------- بوابة خطة تحويل الفشل إلى نجاح (تقرير التشريح، الفصل السادس) ----------
  '26) بوابة الاتجاه اليومي: لا إشارة عكس موجة TSMOM اليومي (30 شمعة) للعائلة العكسية A/B/C/F/G/H/J/N/O/P.',
  '27) بوابة الكفاءة: العكسية المقيّدة C/G/H/O تعمل في السوق الهادئ فقط ER(20) < 0.30.',
  '28) بوابة السبريد: الهامش المتحقق لكل صفقة دون السبريد × معامل الأمان → لا تبرر للتفعيل (تنفيذ المدير الآلي).',
  '29) عينة الحكم: لا تعطيل آلي ولا حكم نهائي قبل 30 صفقة على الأقل — الأصغر «تحت المراقبة».',
  '30) سلّم الترقية والتراجع: محاكاة ← ظل 0.01 ← مراقبة 2–4 أسابيع ← لوت كامل؛ والتراجع فوري عند اختلال المقاييس — لا مارتينجيل ولا مضاعفات ولا شبكات ولا استراتيجيات جديدة دون تحقق مزدوج.',
];

export const CONSTITUTION_PREAMBLE =
  'أنت وكيل تنفيذ قواعد نظام TAMSA حرفياً من ملف XAU-TAMSA7.pdf على XAUUSD. دورك تطبيق القواعد المكتوبة بالحرف (18 استراتيجية A–R + 21 قاعدة عليا + سلم أولويات الجلسات)، لا تحليل حر ولا اجتهاد شخصي. إذا تعارض أي شيء تفعله أو تظنه مع الدليل، الدليل ينتصر.';

/** الأرقام الحرفية الافتراضية من الدليل (كلها قابلة للتعديل من الواجهة بالأسهم) */
export const FROZEN_NUMBERS = {
  minHoldMin: 4,        // القاعدة 3
  maxHoldHours: 72,     // القاعدة 4 — سقف المالك المعتمد (ثلاثة أيام) بخروج وقائي قبل التجاوز
  maxDailyTrades: 50,   // القاعدة 5
  minDailyTrades: 1,    // القاعدة 6
  dailyLoss: 50,        // القاعدة 7
  dailyProfit: 200,     // القاعدة 8
  fixedBase: 1000,      // القاعدة 13
  news: { before: 15, after: 60 }, // القاعدة 14
  marketOpen: 30,       // القاعدة 15
  marketClose: 60,      // القاعدة 16
  spreadCents: 30,      // القاعدة 17
  slippagePips: 10,     // القاعدة 18 (±1$)
  ghostApproach: 50,    // القاعدة 19
  ghostRun: 100,        // القاعدة 19
  beTrigger: 50,        // القاعدة 20 (الحالة 1)
  beTrail: 100,         // القاعدة 20 (الحالة 2)
  beLock: 50,           // القاعدة 20 (الحجز)
  lot: 0.01,            // القاعدة 2
} as const;

// ---------- سجل القرارات (صيغة الوكيل الإلزامية) ----------
// «الوقت (بتوقيت دمشق) | المستوى | البند (استراتيجية/حالة) | الشرط الذي تحقق أو فشل |
//  القرار (دخول / إلغاء / لا شيء) | الوقف والهدف بالأرقام إن وُجد دخول.»
export type DecisionKind = 'دخول' | 'إلغاء' | 'لا شيء' | 'إغلاق';

export interface DecisionEntry {
  t: number;                 // UTC ms
  syria: string;             // الوقت بتوقيت دمشق
  level: number | null;      // المستوى السعري
  setup: 'A' | 'B' | null;   // الاستراتيجية الحرفية إن وُجدت
  condition: string;         // الشرط الذي تحقق أو فشل
  decision: DecisionKind;    // القرار
  sl: number | null;         // الوقف بالأرقام
  tp: number | null;         // الهدف بالأرقام
  extra?: string;            // تفصيل إضافي (سبب الإلغاء/نتيجة الإغلاق)
  line: string;              // السطر الجاهز بصيغة المواصفة
}

export interface RefusalRecord {
  t: number;
  syria: string;
  source: string;
  attempted: string;
  reason: string;
}

export interface SessionSummary {
  publishedAt: number;
  syriaDay: string;
  signals: number;
  cancellations: number;
  cancellationsByReason: { reason: string; count: number }[];
  executedTrades: number;
  resultR: number;
  avgR: number;
  winRate: number;
  window: string;
}

export interface ConstitutionState {
  publishedAt: number | null;
  decisions: DecisionEntry[];
  refusals: RefusalRecord[];
  summary: SessionSummary | null;
}

const DECISIONS_CAP = 400;
const REFUSALS_CAP = 100;

const g = globalThis as unknown as { __constitution?: ConstitutionState };
const store = (): ConstitutionState =>
  g.__constitution ?? (g.__constitution = { publishedAt: null, decisions: [], refusals: [], summary: null });

/** الوقت بتوقيت دمشق (UTC+3 ثابت) بصيغة YYYY-MM-DD HH:mm:ss */
export function syriaStamp(t: number): string {
  return new Date(t + 3 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}

/** سطر القرار الجاهز — بصيغة المواصفة حرفياً */
export function formatDecisionLine(e: Omit<DecisionEntry, 'line' | 'syria'> & { syria?: string }): DecisionEntry {
  const syria = e.syria ?? syriaStamp(e.t);
  const cols = [
    syria,
    e.level !== null ? String(e.level) : '—',
    e.setup ? `${e.setup} (${SETUP_MAP[e.setup]})` : '—',
    e.condition,
    e.decision,
    e.decision === 'دخول' && e.sl !== null && e.tp !== null
      ? `وقف ${e.sl.toFixed(2)} / هدف ${e.tp.toFixed(2)}`
      : (e.extra ?? '—'),
  ];
  return { ...e, syria, line: cols.join(' | ') };
}

/** تسجيل رفض أي محاولة تجاوز لقاعدة من القواعد العليا */
export function pushRefusal(source: string, attempted: string, reason: string): RefusalRecord {
  const t = Date.now();
  const rec: RefusalRecord = { t, syria: syriaStamp(t), source, attempted, reason };
  const s = store();
  s.refusals.unshift(rec);
  if (s.refusals.length > REFUSALS_CAP) s.refusals.length = REFUSALS_CAP;
  return rec;
}

/** نشر سجل محرك القرارات */
export function publishEngineLog(entries: DecisionEntry[], summary: SessionSummary): void {
  const s = store();
  s.decisions = entries.slice(0, DECISIONS_CAP);
  s.summary = summary;
  s.publishedAt = Date.now();
}

export function constitutionState(): ConstitutionState {
  const s = store();
  return {
    publishedAt: s.publishedAt,
    decisions: s.decisions.slice(0, DECISIONS_CAP),
    refusals: s.refusals.slice(0, REFUSALS_CAP),
    summary: s.summary,
  };
}

// ---------- أسباب الإلغاء والانتظار (تصنيف القرار) ----------
export const CANCEL_CAUSES = new Set(['conflict', 'invalid', 'expired', 'ghost']);

export const BLOCK_REASON_LABELS: Record<string, string> = {
  session: 'خارج جلسات البند المفعلة (مؤشر توقيت الجلسات)',
  strategy_off: 'الاستراتيجية/البند معطل من واجهة الاستراتيجيات',
  maxTrades: 'حد الصفقات اليومية 50 (القاعدة 5)',
  dayStop: 'إيقاف اليوم: حد خسارة 50$ أو هدف ربح 200$ (القاعدتان 7 و8 — إغلاق قسري)',
  dayFuse: 'صمام الخسارة اليومية 3% من الأساس — لا دخول جديد لبقية اليوم (الصفقات المفتوحة تبقى)',
  weeklyStop: 'صمام الخسارة الأسبوعية 6% من الأساس — لا دخول جديد لبقية الأسبوع',
  equityFloor: 'صمام حماية الإيكويتي: تراجع ≥15% عن القمة — لا دخول جديد حتى التعافي',
  news: 'حظر الأخبار: قبل الخبر 15 دقيقة وبعده 60 دقيقة (القاعدة 14)',
  openFilter: 'حظر أول 30 دقيقة من افتتاح السوق (القاعدة 15)',
  closeFilter: 'حظر آخر 60 دقيقة قبل إغلاق السوق (القاعدة 16)',
  single: 'صفقة نشطة لنفس الاستراتيجية لم تُغلق بعد (القاعدة 10 — لكل استراتيجية)',
  concurrent: 'سقف الصفقات المتزامنة الكلية max_concurrent (عصر السلة)',
  stacking: 'حظر الاستاكنج/الهيدج (القاعدة 11)',
  conflict: 'حل التعارضات — سلم أولويات الجلسة النشطة',
  ghost: 'فرصة فائتة لعدم الوصول (القاعدة 19)',
  consumed: 'مستوى/منطقة مستهلكة بقاعدة المرة الواحدة',
  slippage: 'تجاوز هامش الانزلاق ±10 بيبز (القاعدة 18)',
  emaRange: 'منطقة عرضية تجميعية — إجبار السيناريو الثاني (مؤشر EMA)',
  expired: 'انتهت صلاحية الأمر المعلق',
  dailyTrend: 'بوابة الاتجاه اليومي (قاعدة 26): إشارة عكس موجة TSMOM اليومي — قُتلت عند التوليد',
  erQuiet: 'بوابة الكفاءة (قاعدة 27): العكسية ممنوعة في السوق الاتجاهي ER≥0.30 — قُتلت عند التوليد',
  spreadGuard: 'بوابة السبريد (قاعدة 28): هامش متدحرج دون السبريد — صفقة واحدة يومياً كحد أقصى',
  sideGuard: 'الاحتجاز الاتجاهي (قاعدة 31): طرف مزمن الخسارة PF دون العتبة — صفقة واحدة يومياً من هذا الطرف',
  decayGuard: 'بوابة الانحسار الزمني (قاعدة 32): PF آخر 90 يوماً دون 1.00 — صفقة واحدة يومياً حتى التعافي',
  freqCap: 'حصر التردد اليومي للاستراتيجية (خطة التحويل)',
};

// ---------- حارس الإعدادات (وفق الدليل: كل الأرقام قابلة للتعديل بالأسهم) ----------
// لا حقول مجمّدة خارج الدليل — الدليل نفسه يفرض أسهم تعديل لكل معامل (ص75-76).
export interface FrozenField { path: string; expect: unknown; reason: string }
export const FROZEN_FIELDS: FrozenField[] = [];

export function enforceFrozenSettings<T>(settings: T): T {
  return settings; // كل القيم حرة التعديل من الواجهة وفق أمر أسهم التعديل في الدليل
}

export interface FrozenGuardResult {
  payload: Record<string, unknown>;
  refused: { path: string; attempted: unknown; reason: string }[];
}

export function guardFrozenSettings(incoming: Record<string, unknown>, _current: Record<string, unknown>): FrozenGuardResult {
  return { payload: structuredClone(incoming), refused: [] };
}

export function guardFrozenPatches(patches: { op: string; path: string; value: unknown }[], _current: Record<string, unknown>): FrozenGuardResult & { allowedPatches: { op: string; path: string; value: unknown }[] } {
  return { payload: {}, refused: [], allowedPatches: [...patches] };
}
