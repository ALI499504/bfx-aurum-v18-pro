// ============================================================
// القواعد العليا (Global Rules) — 21 قاعدة حرفياً من ملف XAU-TAMSA7.pdf
// (ص80–83) + سلم الأولويات بأربع لوحات جلسات (ص77–79) + حل التعارضات.
// لا توجد أي قواعد إضافية خارج الدليل — حذف كل الإضافات السابقة بأمر المالك.
// ============================================================
import { PIP, Setup, StrategyId, Trade } from './types';
import { SessionKey, TamsaParams, DEFAULT_TAMSA_PARAMS, ALLOWED_SESSIONS, STRATEGY_CASES } from './tamsa-params';

// ---------- القواعد العليا الـ21 (تعداد الدليل الحرفي) ----------
export interface GlobalRuleCfg { enabled: boolean; value?: number }

export const GLOBAL_RULES_META: { key: string; n: number; title: string; desc: string; unit?: string; step?: number }[] = [
  { key: 'symbol_lock', n: 1, title: 'رمز الأصل المعتمد وحصر التداول', desc: 'الالتزام التام بالتداول على زوج XAUUSD حصراً، وتجميد ومنع العمل على أي أصول أو أزواج أخرى كلياً' },
  { key: 'fixed_lot', n: 2, title: 'حجم العقد واللوت الثابت دائماً', desc: 'الالتزام الصارم بلوت ثابت دائماً دون أي تغيير ديناميكي', unit: 'لوت', step: 0.01 },
  { key: 'min_hold_min', n: 3, title: 'الحد الأدنى لوقت الاحتفاظ بالصفقة', desc: 'منع إغلاق أي صفقة مفتوحة قبل مرور المدة كاملة لتجنب السكالبينغ العشوائي', unit: 'دقيقة', step: 1 },
  { key: 'max_hold_hours', n: 4, title: 'الحد الأقصى لوقت الاحتفاظ بالصفقة', desc: 'إغلاق الصفقة المفتوحة إجبارياً وتلقائياً فور بلوغ العلامة', unit: 'ساعة', step: 1 },
  { key: 'max_daily_trades', n: 5, title: 'الحد الأقصى لعدد الصفقات اليومية المنفذة', desc: 'التوقف التام عن فتح أي صفقات جديدة فور تنفيذ العدد الأقصى في يوم التداول الواحد', unit: 'صفقة', step: 1 },
  { key: 'min_daily_trades', n: 6, title: 'الحد الأدنى لعدد الصفقات اليومية المتوقعة', desc: 'تتبع وتيرة السوق وتنبيه النظام ومراقبته لتحقيق معدل التداول الأدنى في اليوم العادي', unit: 'صفقة', step: 1 },
  { key: 'daily_loss_stop', n: 7, title: 'حد الخسارة اليومي الصارم لحماية الحساب', desc: 'إيقاف العمل الفوري عند بلوغ خسارة يومية صافية بالقيمة المحددة', unit: 'دولار', step: 1 },
  { key: 'daily_profit_stop', n: 8, title: 'المستهدف الربحي اليومي وحظر التداول الانتقامي', desc: 'إيقاف التداول تماماً وحظر أي تداول إضافي لحماية الأرباح عند تحقيق ربح يومي صافٍ', unit: 'دولار', step: 1 },
  { key: 'no_martingale', n: 9, title: 'حظر أساليب المارتنجال والمضاعفات العشوائية', desc: 'منع برمجي قاطع لمضاعفة حجم اللوت بعد الصفقات الخاسرة، والإبقاء الإلزامي على اللوت المعتمد' },
  { key: 'single_trade', n: 10, title: 'بروتوكول الصفقة النشطة الواحدة — لكل استراتيجية', desc: 'لا تكرار لصفقة نشطة لنفس الاستراتيجية حتى إغلاقها. في عائلة TAMSA (A–R) يُطبق على العائلة كلها صفقة واحدة نشطة كما تحقق خط الأساس المتحقق، ومكوّنات السلة المعتمدة تعمل في مسارها الظلي المستقل بصفقة واحدة لكل مكوّن — خارج هذا المحرك كلياً', unit: '', step: 0 },
  { key: 'no_stacking_hedge', n: 11, title: 'حظر الاستاكنج والتبريد والهيدج تماماً', desc: 'منع كلي ومطلق لتجميع الصفقات، أو فتح عقود تعزيزية، أو التبريد، أو فتح صفقات تحوط معاكسة' },
  { key: 'mandatory_sl', n: 12, title: 'إلزامية الالتزام بأمر وقف الخسارة الفني', desc: 'الالتزام التام بقيمة الوقف كما هو محسوب داخل شروط كل استراتيجية، مع حظر توسيعه أو إلغائه أو تحريكه ضد اتجاه الصفقة (بروتوكول التأمين القاعدة 20 استثناء وحيد)' },
  { key: 'fixed_base', n: 13, title: 'حساب النسب المئوية للأداء المالي على رصيد ثابت', desc: 'حساب النسبة المئوية للربح والخسارة دورياً (يومياً/أسبوعياً/شهرياً) على رصيد مستهدف وثابت وليس على الرصيد اللحظي', unit: 'دولار', step: 1 },
  { key: 'news_filter', n: 14, title: 'فلتر الأخبار الاقتصادية القوية عالية التأثير', desc: 'حظر تفعيل أو فتح أي صفقة جديدة قبل موعد صدور الخبر بالمدة المحددة، واستمرار الحظر بعده بالمدة المحددة', unit: 'دقيقة', step: 1 },
  { key: 'market_open_filter', n: 15, title: 'فلتر افتتاح السوق العام للذهب', desc: 'منع تفعيل أو فتح أي صفقة جديدة خلال أول مدة من لحظة افتتاح سوق الذهب اليومي الرسمي', unit: 'دقيقة', step: 1 },
  { key: 'market_close_filter', n: 16, title: 'فلتر إغلاق السوق العام للذهب', desc: 'منع تفعيل أو فتح أي صفقة جديدة خلال آخر مدة قبل موعد إغلاق سوق الذهب اليومي الرسمي', unit: 'دقيقة', step: 1 },
  { key: 'fixed_spread', n: 17, title: 'احتساب رسوم السبريد الثابتة للتصفية', desc: 'إلزام البوت باحتساب تكلفة سبريد ثابتة وقاطعة في جميع عمليات الباك تيست والاختبارات الحية', unit: 'سنت', step: 1 },
  { key: 'slippage', n: 18, title: 'بروتوكول فلترة الانزلاق وعشوائية التنفيذ اللحظي', desc: 'هامش مرونة وتفاوت رقمي في دقة الدخول والخروج والستوب والهدف؛ ضمن الهامش تُقبل الصفقة، وإذا تجاوز الانزلاق الهامش يُحظر الفتح ويُلغى الأمر فوراً', unit: 'بيب', step: 1 },
  { key: 'ghost_entry', n: 19, title: 'بروتوكول إبطال الفرص الفائتة لعدم الوصول', desc: 'اقترب السعر من خط الدخول بمسافة التقارب دون لمس نقطة التنفيذ، ثم انعكس وانطلق باتجاه الصفقة متحققاً حركة اتجاهية أكبر من المحددة دون العودة للخط → تُحذف شروط الدخول والخطوط فوراً وتُمنع إعادة الدخول', unit: 'بيب', step: 5 },
  { key: 'break_even', n: 20, title: 'بروتوكول حماية وتأمين الأرباح المفتوحة', desc: 'الحالة الأولى: عند ربح صافٍ بقيمة محددة يُسحب الوقف إلى نقطة الدخول الصفرية. الحالة الثانية: عند ربح تراكمي بقيمة محددة يُوضع الوقف لحجز ربح مؤمن بالقيمة المحددة' },
  { key: 'hierarchy', n: 21, title: 'بروتوكول التسلسل الهرمي الصارم للحظر وعزل الاستهلاك', desc: 'المستوى الأول: القواعد العليا (سيادة مطلقة). المستوى الثاني: سلم أولويات الجلسة النشطة. المستوى الثالث: قواعد كل استراتيجية الداخلية — ولا تنفيذ إلا بالامتثال الكامل للتسلسل' },
  // ---------- صمامات المخاطر المعتمدة (خطة السلة على أساس 1000$) ----------
  // تعمل هذه الصمامات الثلاثة داخل وحدة السلة الظلية المستقلة (src/lib/engine/basket.ts)
  // على إيكويتي المحفظة الافتراضي — ومعطلّة افتراضياً في محرك TAMSA الرسمي
  // حفاظاً على سلوكه المتحقق (القياس الحي: كانت تحظر 33 يوماً من 90 وتخنق السلة)
  { key: 'fuse_daily_pct', n: 22, title: 'صمام السلة اليومي (3% من الأساس = 30$)', desc: 'داخل محفظة السلة الظلية: منع أي دخول جديد لبقية اليوم السوري عند خسارة يومية صافية ≥ 30$ من الأساس الثابت 1000$ — الصفقات المفتوحة تبقى محكومة بوقفها وهدفها. معطل في محرك TAMSA الرسمي (حمايته القاعدة 7: 50$)', unit: '%', step: 0.5 },
  { key: 'fuse_weekly_pct', n: 23, title: 'صمام السلة الأسبوعي (6% من الأساس = 60$)', desc: 'داخل محفظة السلة الظلية: منع أي دخول جديد لبقية الأسبوع عند خسارة أسبوعية تراكمية ≥ 60$ من الأساس الثابت — الصفقات المفتوحة تبقى محكومة بوقفها وهدفها', unit: '%', step: 0.5 },
  { key: 'fuse_equity_floor', n: 24, title: 'حاجز كارثة السلة (إيكويتي دون 50% من الأساس)', desc: 'داخل محفظة السلة الظلية: منع أي دخول جديد عندما يهبط الإيكويتي (الأساس + العائم) دون 500$ (50% من الأساس) — عتبة أبعد من أدنى إيكويتي متحقق للسلة (548$) فلا تُثار في السلوك المتحقق أبداً، مع دورة تجريبية كل 30 يوماً تمنع الجمود الدائم', unit: '%', step: 1 },
  { key: 'max_concurrent', n: 25, title: 'سقف الصفقات المتزامنة الكلية', desc: 'أقصى عدد صفقات مفتوحة في نفس اللحظة في محرك TAMSA الرسمي — عائلة TAMSA تحيل صفقة واحدة نشطة كحد أقصى، والسقف 4 هامش أمان لا مساس به من السلوك المتحقق. مكوّنات السلة المعتمدة تعمل متوازية في مسارها الظلي المستقل (توازيها هو مصدر التنويع وفق المحاكاة المعتمدة)', unit: 'صفقة', step: 1 },
];

// ---------- سلم الأولويات: لوحات الجلسات الأربع (ص77) ----------
// البند الأعلى رتبة يسود عند تداخل الخطوط، ويُقمع الأدنى (منطق السيادة الرقمية الفوقية)
export const DEFAULT_LADDER: StrategyId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'W', 'X', 'Y', 'AA', 'T', 'U', 'V'];

export function defaultLadders(): Record<SessionKey, StrategyId[]> {
  return { asia: [...DEFAULT_LADDER], london: [...DEFAULT_LADDER], londonNY: [...DEFAULT_LADDER], ny: [...DEFAULT_LADDER] };
}

// القيم الحرفية الافتراضية من الدليل (ص80–83)
export const DEFAULT_SETTINGS = {
  // القواعد العليا — 21 قاعدة بأرقام الدليل الحرفية
  globalRules: {
    symbol_lock: { enabled: true, value: 0 },          // 1. XAUUSD حصراً
    fixed_lot: { enabled: true, value: 0.01 },         // 2. لوت ثابت 0.01
    min_hold_min: { enabled: true, value: 4 },         // 3. حد أدنى للاحتفاظ 4 دقائق
    max_hold_hours: { enabled: true, value: 8 },       // 4. حد أقصى 8 ساعات
    max_daily_trades: { enabled: true, value: 50 },    // 5. حد أقصى 50 صفقة يومية
    min_daily_trades: { enabled: true, value: 1 },     // 6. حد أدنى صفقة واحدة يومياً (مراقبة)
    daily_loss_stop: { enabled: true, value: 50 },     // 7. حد خسارة يومي 50$
    daily_profit_stop: { enabled: true, value: 200 },  // 8. مستهدف ربح يومي 200$
    no_martingale: { enabled: true, value: 0 },        // 9. حظر المارتنجال
    single_trade: { enabled: true, value: 0 },         // 10. الصفقة النشطة الواحدة
    no_stacking_hedge: { enabled: true, value: 0 },    // 11. حظر الاستاكنج والهيدج
    mandatory_sl: { enabled: true, value: 0 },         // 12. وقف خسارة إجباري
    fixed_base: { enabled: true, value: 1000 },        // 13. النسب على رصيد ثابت 1000$
    news_filter: { enabled: true, value: 15 },         // 14. حظر قبل الخبر 15 دقيقة
    news_after_min: { enabled: true, value: 60 },      //     وحظر بعده 60 دقيقة
    market_open_filter: { enabled: true, value: 30 },  // 15. حظر أول 30 دقيقة من الافتتاح
    market_close_filter: { enabled: true, value: 60 }, // 16. حظر آخر 60 دقيقة قبل الإغلاق
    fixed_spread: { enabled: true, value: 30 },        // 17. سبريد ثابت 30 سنت (3 بيبز)
    slippage: { enabled: true, value: 10 },            // 18. هامش الانزلاق ±10 بيبز (1$)
    ghost_entry: { enabled: true, value: 50 },         // 19. اقتراب فائت 50 بيب + انطلاق 100 بيب
    ghost_run_pips: { enabled: true, value: 100 },     //     الحركة الاتجاهية المؤكدة 100 بيب
    break_even: { enabled: true, value: 50 },          // 20. التأمين الصفري عند +50 بيب
    be_case1: { enabled: true, value: 50 },            //     الحالة الأولى: وقف عند الدخول
    be_case2: { enabled: true, value: 100 },           //     الحالة الثانية: تنشيط عند +100
    be_lock_pips: { enabled: true, value: 50 },        //     وحجز ربح 50 بيب
    hierarchy: { enabled: true, value: 0 },            // 21. التسلسل الهرمي (مفعّل دائماً)
    // ---------- صمامات المخاطر المعتمدة (خطة السلة) ----------
    // مبنية داخل وحدة السلة الظلية (basket.ts) — معطلة هنا في محرك TAMSA الرسمي
    // حفاظاً على سلوكه المتحقق (كانت تحظر 33 يوماً من 90 في القياس الحي)
    fuse_daily_pct: { enabled: false, value: 3 },      // صمام يومي 3% من الأساس (داخل السلة)
    fuse_weekly_pct: { enabled: false, value: 6 },     // صمام أسبوعي 6% من الأساس (داخل السلة)
    fuse_equity_floor: { enabled: false, value: 50 },  // حاجز كارثة: إيكويتي دون 50% من الأساس (داخل السلة)
    max_concurrent: { enabled: true, value: 4 },       // سقف التزامن العام (هامش أمان)
  } as Record<string, GlobalRuleCfg>,

  // معاملات الاستراتيجيات A–R (أرقام الدليل الحرفية — قابلة للتعديل بالأسهم)
  strategyParams: structuredClone(DEFAULT_TAMSA_PARAMS) as unknown as TamsaParams,

  // بوابات الجلسات لكل استراتيجية × بند × سيناريو (المسموح حرفياً من الدليل مفعّل)
  scenarioSessions: buildScenarioSessions(),

  // سلم الأولويات: أربع لوحات جلسات (ص77) — الافتراضي ترتيب الدليل A→R
  priorityLadder: defaultLadders(),

  // مؤشرات: الجلسات + EMA 20/90 على 4H واليومي فقط
  indicators: {
    sessionTiming: true,   // مؤشر توقيت الجلسات (يعمل دائماً — شرط تفعيل الاستراتيجيات)
    ema: true,             // EMA 20/90 — موجّه السيناريوهات (متوافق→س1، عكسي→س2، تشابك→س2 إجبارياً)
    emaFast: 20,
    emaSlow: 90,
  },

  // المستويات اليدوية (استراتيجية Z) — أوامر مباشرة من المستخدم
  manualLevels: { enabled: false, levels: [] as { id: string; price: number; dir: 'buy' | 'sell'; slDollars: number; note?: string; createdAt: number }[] },
};

export type Settings = {
  globalRules: Record<string, GlobalRuleCfg>;
  strategyParams: TamsaParams;
  indicators: { sessionTiming: boolean; ema: boolean; emaFast: number; emaSlow: number };
  manualLevels: { enabled: boolean; levels: { id: string; price: number; dir: 'buy' | 'sell'; slDollars: number; note?: string; createdAt: number }[] };
  scenarioSessions: Record<string, Record<string, Record<string, { enabled?: boolean; asia: boolean; london: boolean; londonNY: boolean; ny: boolean }>>>;
  priorityLadder: Record<SessionKey, StrategyId[]>;
};

/** بناء بوابات الجلسات الافتراضية: الجلسات المسموحة حرفياً لكل استراتيجية مفعّلة وبقية الجلسات مقفلة */
export function buildScenarioSessions(): Settings['scenarioSessions'] {
  const out: Settings['scenarioSessions'] = {};
  for (const st of Object.keys(STRATEGY_CASES) as (keyof typeof STRATEGY_CASES)[]) {
    out[st] = {};
    const allowed = ALLOWED_SESSIONS[st];
    for (const cs of STRATEGY_CASES[st]) {
      out[st][cs] = { s1: sessFor(allowed), s2: sessFor(allowed) };
    }
  }
  return out;
}
/** عقدة سيناريو واحدة: مفتاح تفعيل السيناريو + أزرار الجلسات الأربعة (ص76 حرفياً) */
function sessFor(allowed: SessionKey[]) {
  return {
    enabled: true,
    asia: allowed.includes('asia'),
    london: allowed.includes('london'),
    londonNY: allowed.includes('londonNY'),
    ny: allowed.includes('ny'),
  };
}

// ---------- تقويم الأخبار الاقتصادية الأمريكية — حقيقي فقط ----------
// الأحداث تأتي حصراً من تقويم ForexFactory الحقيقي (نقطة /api/news) — لا مواعيد وهمية أبداً.
export interface NewsEvent { t: number; name: string }

/** هل التداول محجوب بسبب خبر قريب؟ (قاعدة 14: قبل X دقيقة وبعد Y دقيقة) */
export function newsBlock(t: number, news: NewsEvent[], beforeMin: number, afterMin: number): NewsEvent | null {
  for (const e of news) {
    if (t >= e.t - beforeMin * 60e3 && t <= e.t + afterMin * 60e3) return e;
    if (e.t - afterMin * 60e3 > t) break;
  }
  return null;
}

// ---------- حساب نتائج الصفقة ----------
export const SPREAD_COST_PER_LOT = (spreadPips: number, lot: number) =>
  spreadPips * PIP * (lot / 0.01) * 10; // 3 بيبز × 0.1 × مضاعف اللوت

/**
 * الربح بالدولار لصفقة ذهب (0.01 لوت = 1 أونصة → 1$ حركة = 1$ ربح)
 * pnl = حركة السعر بالدولار × (lot/0.01) − السبريد
 */
export function tradePnl(dir: 'buy' | 'sell', entry: number, exit: number, lot: number, spreadCents: number): number {
  const move = dir === 'buy' ? exit - entry : entry - exit;
  const gross = move * (lot / 0.01);
  const spreadCost = (spreadCents / 100) * (lot / 0.01);
  return gross - spreadCost;
}

export function riskDollars(sl: number, entry: number, lot: number): number {
  return Math.abs(entry - sl) * (lot / 0.01);
}

// ---------- حل التعارضات (ص78–79) — بروتوكولات البنود الثلاثة ----------
/**
 * البند الأول: استراتيجيتان بنفس الاتجاه والمسافة أقل من 100 بيب
 *   → دمج في منطقة اهتمام واحدة: صفقة واحدة عند خط الاستراتيجية الأقرب للسعر،
 *     والوقف خلف مستوى الاستراتيجية الأبعد بـ50 بيب (قابل للتعديل)، والهدف من الاستراتيجية المنفذة.
 * البند الثاني: نفس الاتجاه والمسافة ≥100 بيب
 *   → سيادة الرتبة الأعلى في سلم الجلسة النشطة: تُنفذ الأعلى وتُحذف الأدنى لليوم.
 * البند الثالث: اتجاهان متعاكسان في نفس المنطقة
 *   → سيادة الرتبة الأعلى: تُنفذ فوراً ويُقمع المعاكس كلياً.
 */
export function resolveConflictsPdf(
  signals: (Setup & { rank: number })[],
  nearPips = 100,
  protectSlPips = 50,
  oppositePips = 30,
): { kept: (Setup & { rank: number })[]; dropped: { setup: Setup; why: string }[] } {
  const dropped: { setup: Setup; why: string }[] = [];
  const kept: (Setup & { rank: number })[] = [];
  const used = new Set<number>();

  // ترتيب تنازلي بالرتبة (رتبة 1 = القمة)
  const byRank = [...signals].sort((a, b) => a.rank - b.rank);

  for (let i = 0; i < byRank.length; i++) {
    const a = byRank[i];
    if (used.has(a.id)) continue;

    // ابحث عن أقرب إشارة متضادة أو متداخلة — البروتوكول بين استراتيجيتين مختلفتين حصراً
    // (إشارات نفس الاستراتيجية مستويات مستقلة لكل منها قاعدة مرة الواحدة الخاصة بها)
    let mergedWith: (Setup & { rank: number }) | null = null;
    for (let j = i + 1; j < byRank.length; j++) {
      const b = byRank[j];
      if (used.has(b.id)) continue;
      if (b.strategy === a.strategy) continue;
      const distPips = Math.abs(a.entry - b.entry) / PIP;

      // البند الثالث: اتجاهان متعاكسان في نفس المنطقة السعرية تماماً (نفس السعر تقريباً).
      // حرفياً من الدليل: «في نفس المنطقة السعرية تماماً» و«عند نفس السعر» — نطبّق عتبة
      // ضيقة جداً (افتراضياً 30 بيب ≈ 3$ على الذهب) بدلاً من 100 بيب المخصصة للبند الأول.
      if (a.dir !== b.dir) {
        if (distPips < oppositePips) {
          used.add(b.id);
          dropped.push({ setup: b, why: `إشارة معاكسة (بيع/شراء) في نفس المنطقة تماماً (<${oppositePips} بيب) — سيادة الرتبة الأعلى (${a.strategy}) وقمع المعاكسة (${b.strategy})` });
          continue;
        }
        continue; // متعاكسة ومتباعدة: كلاهما يبقى (لا هيدج لأن اتجاهات مختلفة ولا تداخل منطقة)
      }

      // نفس الاتجاه:
      if (distPips < nearPips) {
        // البند الأول: دمج في منطقة اهتمام موحدة
        used.add(b.id);
        mergedWith = b;
        dropped.push({ setup: b, why: `دمج مع ${a.strategy} في منطقة اهتمام موحدة (<${nearPips} بيب) — تنفيذ خط الأقرب للسعر` });
      }
      // البند الثاني (متباعدة ≥100 بيب بنفس الاتجاه): لا يُطبّق عند توليد الإشارة.
      // حرفياً من الدليل: «يمُنع نظام بروتوكول الصفقة النشطة الواحدة (القاعدة 10) فتح
      // الصفقات المتباعدة معاً وتشتيت الحساب» — أي أن القاعدة 10 نفسها تمنع فتح الصفقتين
      // المتزامنتين، فلا حاجة لحذف الإشارة الأدنى رتبة عند التوليد. كلتاهما تبقى معلّقة،
      // وعند ملامسة سعر أحدهما يُنفَّذ وفق ترتيب السلم، بينما يبقى الآخر معلقاً لحين
      // ملامسة سعره لاحقاً (أو انتهاء صلاحيته).
    }

    // تطبيق معادلة الوقف المحمي عند الدمج
    if (mergedWith) {
      const farther = Math.abs(a.entry - mergedWith.entry) / PIP >= 0
        ? (a.dir === 'buy' ? Math.min(a.entry, mergedWith.entry) : Math.max(a.entry, mergedWith.entry))
        : a.entry;
      const fartherLevel = a.dir === 'buy' ? Math.min(a.sl, mergedWith.sl) : Math.max(a.sl, mergedWith.sl);
      const dist = Math.abs(a.entry - fartherLevel) / PIP;
      const slPips = Math.max(dist + protectSlPips, a.slPips);
      const sl = a.dir === 'buy' ? a.entry - slPips * PIP : a.entry + slPips * PIP;
      kept.push({ ...a, sl, slPips, reason: `${a.reason} | دمج مع ${mergedWith.strategy}: وقف محمي خلف المستوى الأبعد +${protectSlPips} بيب` });
    } else {
      kept.push(a);
    }
  }
  return { kept, dropped };
}

// ---------- أسباب الحظر (شفافية كاملة) ----------
export const BLOCK_REASONS_AR: Record<string, string> = {
  session: 'خارج جلسات البند المفعلة',
  strategy_off: 'الاستراتيجية/البند معطل من واجهة الاستراتيجيات',
  maxTrades: 'حد الصفقات اليومية (قاعدة 5)',
  dayStop: 'إيقاف اليوم (حد الربح/الخسارة — قاعدتا 7 و8)',
  news: 'حظر الأخبار الاقتصادية (قاعدة 14)',
  openFilter: 'فلتر افتتاح السوق (قاعدة 15)',
  closeFilter: 'فلتر إغلاق السوق (قاعدة 16)',
  single: 'الصفقة النشطة الواحدة (قاعدة 10)',
  stacking: 'حظر الاستاكنج/الهيدج (قاعدة 11)',
  conflict: 'حل التعارضات (سلم أولويات الجلسة)',
  ghost: 'فرصة فائتة لعدم الوصول (قاعدة 19)',
  consumed: 'مستوى مستهلك/منطقة ميتة (قاعدة الاستهلاك الذاتي)',
  slippage: 'تجاوز هامش الانزلاق (قاعدة 18)',
  emaRange: 'منطقة عرضية تجميعية — إجبار السيناريو الثاني',
};

export type { Trade, Setup };
