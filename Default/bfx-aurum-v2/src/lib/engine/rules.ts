// ============================================================
// القواعد العليا (Global Rules) + سلم الأولويات + فلاتر الأخبار
// الجزء السابع + الجزء الحادي عشر + الجزء الثاني عشر من الدليل
// + محرك الحوكمة الصلبة: فلاتر ريجيم/راكدة + بوابة جودة + حجم ديناميكي
// ============================================================
import { ManualLevel, PIP, Setup, StrategyId, Trade, pips } from './types';

// ---------- الإعدادات الافتراضية ----------
export const DEFAULT_SETTINGS = {
  // حصرية القاعدة بطلب المستخدم: استراتيجية E (الأرقام المستديرة) وحدها مفعّلة —
  // «ينفذ هذه القاعدة فقط ويتجاهل أي شيء غيرها». المحرك أصلاً لا يولّد غير إشارات E.
  sessions: {
    A: { asia: false, london: false, londonNY: false, ny: false },
    B: { asia: false, london: false, londonNY: false, ny: false },
    C: { asia: false, london: false, londonNY: false, ny: false },
    D: { asia: false, london: false, londonNY: false, ny: false },
    E: { asia: true, london: true, londonNY: true, ny: true },
    F: { asia: false, london: false, londonNY: false, ny: false },
    G: { asia: false, london: false, londonNY: false, ny: false },
    H: { asia: false, london: false, londonNY: false, ny: false },
    I: { asia: false, london: false, londonNY: false, ny: false },
    J: { asia: false, london: false, londonNY: false, ny: false },
    K: { asia: false, london: false, londonNY: false, ny: false },
    L: { asia: false, london: false, londonNY: false, ny: false },
    M: { asia: false, london: false, londonNY: false, ny: false },
    N: { asia: false, london: false, londonNY: false, ny: false },
    O: { asia: false, london: false, londonNY: false, ny: false },
    // Z = المستويات اليدوية: تجاوز بوابات الجلسات في المحرك — القيم هنا للعرض فقط
    Z: { asia: false, london: false, londonNY: false, ny: false },
  } as Record<StrategyId, { asia: boolean; london: boolean; londonNY: boolean; ny: boolean }>,
  // سلم الأولويات: ترتيب بنود حل التعارضات (قابل لإعادة الترتيب)
  priority: ['counter', 'close100', 'far100'],
  globalRules: {
    symbol_lock: { enabled: true, value: 0 },            // 1. XAUUSD حصراً
    fixed_lot: { enabled: true, value: 0.01 },           // 2. لوت ثابت 0.01
    min_hold_min: { enabled: true, value: 5 },           // 3. حد أدنى للاحتفاظ 5 دقائق
    max_hold_hours: { enabled: true, value: 8 },         // 4. حد أقصى 8 ساعات
    max_daily_trades: { enabled: true, value: 10 },      // 5. حد أقصى 10 صفقات يومية (طلب المستخدم الحالي)
    min_daily_trades_kpi: { enabled: true, value: 10 },  // 6. هدف الالتزام اليومي 10 صفقات (طلب المستخدم الحالي)
    daily_loss_stop: { enabled: true, value: 50 },       // 7. حد خسارة يومي 50$
    daily_profit_stop: { enabled: true, value: 30 },     // 8. مستهدف ربح يومي 30$
    no_martingale: { enabled: true, value: 0 },          // 9. حظر المارتنجال
    single_trade: { enabled: true, value: 0 },           // 10. الصفقة النشطة الواحدة
    no_stacking_hedge: { enabled: true, value: 0 },      // 11. حظر الاستاكنج والهيدج
    mandatory_sl: { enabled: true, value: 0 },           // 12. وقف خسارة إجباري
    sl_floor: { enabled: true, value: 10 },              // 13. حد أدنى للوقف 10$
    sl_cap: { enabled: true, value: 15 },                //     وحد أقصى 15$ (يُضيّق لا يُلغي)
    max_concurrent: { enabled: true, value: 2 },         // 13ب. حد الصفقات المفتوحة المتوازية (عند تعطيل الصفقة الواحدة)
    // 13ج/13د/13هـ/13و/13ز — أُزيلت نهائياً بأمر المالك («احذف وأزل كل ما يتعارض مع القواعد»):
    // لا بوابة ريجيم، لا بوابة راكدة، لا بوابة جودة، لا حجم ديناميكي، لا بوابة سبريد دخول.
    // كلها شروط مضافة خارج المواصفة المجمدة كانت تمنع دخولات أمرت بها المواصفة (القاعدة 1 و2).
    // المواصفة تحكم الدخول حصراً: A أو B اكتملت شروطها بالترتيب ← دخول. السبريد يدخل حساب التكلفة فقط
    // (الأكبر بين الفعلي و0.30$) ولا يمنع دخولاً، واللوت ثابت 0.01 دائماً (القاعدة 4).
    regime_filter: { enabled: false, value: 4.0 },
    chop_filter: { enabled: false, value: 60 },
    quality_gate: { enabled: false, value: 56 },
    risk_sizing: { enabled: false, value: 1.0 },
    spread_gate: { enabled: false, value: 45 },
    tp_ratio: { enabled: true, value: 2 },               // 14. الهدف 1:2 (حتى 1:3)
    scalp_type: { enabled: true, value: 0 },             // 15. نوع الصفقة سكالب
    syria_day: { enabled: true, value: 0 },              // 16. يوم التداول 00:00-00:00 سوريا
    fixed_base: { enabled: true, value: 1000 },          // 17. النسب على رصيد ثابت 1000$
    winrate_gate: { enabled: true, value: 70 },          // 18. بوابة النشر 70%
    news_filter: { enabled: true, value: 0 },            // 19. فلتر الأخبار
    news_before_min: { enabled: true, value: 20 },       //     حظر قبل الخبر 20 دقيقة
    news_after_min: { enabled: true, value: 60 },        //     حظر بعد الخبر 60 دقيقة
    news_close_min: { enabled: true, value: 15 },        //     إغلاق الصفقات قبل الخبر 15 دقيقة
    market_open_filter: { enabled: true, value: 120 },   // 20. حظر أول 120 دقيقة من الافتتاح
    market_close_filter: { enabled: true, value: 60 },   // 21. حظر آخر 60 دقيقة قبل الإغلاق
    fixed_spread: { enabled: true, value: 30 },          // 22. سبريد ثابت 30 سنت (3 بيبز)
    mtf_analysis: { enabled: true, value: 0 },           // 23. تحليل متعدد الأطر الزمنية
  } as Record<string, { enabled: boolean; value?: number }>,
  indicators: {
    sessionTiming: true,   // مؤشر توقيت الجلسات
    ema: false,            // EMA 20/90 معطل في الاختبار الأول (وفق الدليل)
    emaFast: 20,
    emaSlow: 90,
  },
  tpRatio: 2,
  // المستويات اليدوية (استراتيجية Z) — أوامر مباشرة من المستخدم
  manualLevels: { enabled: false, levels: [] as ManualLevel[] },
};

export type Settings = typeof DEFAULT_SETTINGS;

// ---------- الحوكمة الصلبة (Hard Rails) ----------
// حدود مكتوبة في الكود لا يمكن لأي إعداد تجاوزها — طبقة حماية فوق كل الإعدادات
export const HARD_RAILS = {
  maxTradesPerDay: 30,   // سقف مطلق للصفقات اليومية — صمام أمان فوق هدف المستخدم (10 صفقات/يوم)
  maxDailyLossPct: 15,   // سقف مطلق لخسارة اليوم (% من الرصيد الأساسي) — حد المستخدم (150$) هو الحاكم
  maxLot: 2.0,           // سقف مطلق للوت الواحد
  maxConcurrent: 8,      // سقف مطلق للصفقات المفتوحة المتوازية — يطابق حد المستخدم في القواعد العليا
} as const;

// ---------- بوابة جودة الإشارة (Signal Score) ----------
/**
 * درجة بنيوية عرضية (0-100) — للعرض والإحصاء فقط ولا تحجب شيئاً.
 * أُزيلت منها عقوبة «التعلم التراكبي» (wf −30) نهائياً بأمر المالك:
 * كانت تخنق استراتيجية E بعد 15 صفقة سالبة وتمنع دخولات أمرت بها المواصفة
 * (القاعدة 1: اكتملت الشروط بالترتيب ← دخول، والقاعدة 2: لا شروط مضافة).
 */
export function setupScore(
  st: Setup,
  _wf?: { avg: number; n: number } | null,
): number {
  let s = st.strategy === 'Z' ? 90
    : st.strategyRank <= 1 ? 64
    : st.strategyRank === 2 ? 60
    : st.strategyRank === 3 ? 56
    : 52;
  if (st.fibConfirmed) s += 8;
  if (st.session === 'asia') s += 5;
  if (st.expiresAt - st.createdAt >= 24 * 3600e3) s += 3;
  return Math.max(0, Math.min(100, s));
}

// ---------- تقويم الأخبار الاقتصادية الأمريكية — حقيقي فقط ----------
// لا يوجد أي تقويم تقريبي أو مولّد في الكود. الأحداث تأتي حصراً من
// تقويم ForexFactory الحقيقي (نقطة /api/news تخزنها في قاعدة البيانات
// بمفتاح newsCache وتحدّثها كل 6 ساعات). إن لم يتوفر تقويم حقيقي
// يعمل فلتر الأخبار بدون حجب — ولا تُختلع مواعيد وهمية أبداً.
export interface NewsEvent { t: number; name: string }

/** هل التداول محجوب بسبب خبر قريب؟ */
export function newsBlock(t: number, news: NewsEvent[], beforeMin: number, afterMin: number): NewsEvent | null {
  for (const e of news) {
    if (t >= e.t - beforeMin * 60e3 && t <= e.t + afterMin * 60e3) return e;
    if (e.t - afterMin * 60e3 > t) break;
  }
  return null;
}

/** هل يجب إغلاق صفقة مفتوحة الآن (قبل خبر بـ15 دقيقة)؟ */
export function newsCloseNow(t: number, news: NewsEvent[], closeMin: number): NewsEvent | null {
  for (const e of news) {
    if (t >= e.t - closeMin * 60e3 && t < e.t) return e;
    if (e.t - closeMin * 60e3 > t) break;
  }
  return null;
}

// ---------- سلم الأولويات: حل التعارضات ----------
export const PRIORITY_ITEMS: Record<string, { title: string; desc: string }> = {
  counter: {
    title: 'بروتوكول الإشارات المتعاكسة',
    desc: 'شراء وبيع في نفس اللحظة → إلغاء الاثنتين الجديدتين فوراً (أو اعتماد اتجاه EMA إن كان مفعلاً) — الأوامر المعلقة الأقدم لا تُمس وتُحل بالتنفيذ الأول ثم إبطال المعاكس (حظر الهيدج)',
  },
  close100: {
    title: 'مناطق الدخول المتقاربة (أقل من 100 بيب)',
    desc: 'تنفيذ الاستراتيجية الأعلى في السلم فقط دون دمج الوقف أو الهدف — الدمج الرقمي معطل. النطاق 100 بيب حرفياً وفق الدليل (أي توسيع سابق ضُيّق النطاق لدفع التدفق أُلغي)',
  },
  far100: {
    title: 'مناطق الدخول المتباعدة (100 بيب وأكثر)',
    desc: 'الأفضلية للسلم الزمني (D,K,F,H ← C,E,J ← A,B,G,I,O ← L,M,N) ثم المؤكدة بفيبو/كسر ثم الأقرب للسعر — مع حفظ عدد من الأوامر يعادل سعة الصفقات المتوازية بدل أمر واحد',
  },
};

/**
 * تطبيق بروتوكول حل التعارضات على مجموعة أوامر معلقة جديدة + قائمة موجودة
 * يُرجع قائمة الأوامر المسموح بقائها.
 *
 * بروتوكول المتعاكسة (counter) محسّن: يُلغي فقط التعارض اللحظي
 * (شراء وبيع وصلوا معاً في نفس الدفعة) — الأوامر المعلقة الأقدم لا تُمس،
 * فتُحل بالتنفيذ الأول ثم إبطال المعاكس عند الدخول (حظر الهيدج بالمحرك).
 *
 * perDirCap: أقصى عدد أوامر معلقة محفوظة لكل اتجاه في بند far100 —
 * يُمرَّر من سعة الصفقات المتزامنة التي حددها المستخدم (max_concurrent) بالمحرك.
 */
export function resolveConflicts(
  pending: Setup[],
  priority: string[],
  emaDir: 'up' | 'down' | null,
  newOnes: Setup[],
  perDirCap = 1
): { kept: Setup[]; dropped: { setup: Setup; why: string }[] } {
  const dropped: { setup: Setup; why: string }[] = [];
  let pool = [...pending, ...newOnes];

  for (const item of priority) {
    if (item === 'counter') {
      const buys = pool.filter(s => s.dir === 'buy');
      const sells = pool.filter(s => s.dir === 'sell');
      if (buys.length && sells.length) {
        if (emaDir) {
          // EMA مفعّل: أولوية مطلقة للاتجاه المتوافق
          const keep = emaDir === 'up' ? buys : sells;
          for (const s of pool) if (!keep.includes(s)) dropped.push({ setup: s, why: 'إشارة متعاكسة مع اتجاه EMA (بروتوكول الإشارات المتعاكسة)' });
          pool = keep;
        } else {
          // بدون EMA: نُلغي فقط التعارض اللحظي الجديد (شراء+بيع وصلوا معاً)،
          // ونحفظ الأوامر المعلقة الأقدم — أول من يلمس دخوله ينفذ ويُبطل المعاكس
          const newBuys = newOnes.filter(s => s.dir === 'buy');
          const newSells = newOnes.filter(s => s.dir === 'sell');
          if (newBuys.length && newSells.length) {
            for (const s of newOnes) dropped.push({ setup: s, why: 'شراء وبيع وصلوا في نفس اللحظة — إلغاء الاثنتين (بروتوكول الإشارات المتعاكسة)' });
            pool = pool.filter(s => !newOnes.includes(s));
          }
          // وإلا: تعارض بين قديم وجديد أو قديمين — يُحل عند التنفيذ (حظر الهيدج)
        }
        break;
      }
    } else if (item === 'close100') {
      // مجموعات متقاربة (<100 بيب) بنفس الاتجاه: الأعلى أولوية فقط — حرفياً وفق الدليل (100 بيب)
      const byDir: Record<string, Setup[]> = { buy: [], sell: [] };
      for (const s of pool) byDir[s.dir].push(s);
      const kept: Setup[] = [];
      for (const dir of ['buy', 'sell']) {
        const arr = byDir[dir].slice().sort((a, b) => a.entry - b.entry);
        const groups: Setup[][] = [];
        for (const s of arr) {
          const g = groups.find(gr => Math.abs(gr[0].entry - s.entry) / PIP < 100);
          if (g) g.push(s); else groups.push([s]);
        }
        for (const g of groups) {
          if (g.length > 1) {
            // الأعلى في السلم الزمني يبقى ثم المؤكدة فيبو ثم الأقدم
            g.sort((a, b) => a.strategyRank - b.strategyRank || Number(b.fibConfirmed ?? false) - Number(a.fibConfirmed ?? false) || a.createdAt - b.createdAt);
            for (const s of g.slice(1)) dropped.push({ setup: s, why: `دخول متقارب <100 بيب مع ${g[0].strategy} — تنفيذ الأعلى أولوية فقط (بروتوكول المناطق المتقاربة)` });
          }
          kept.push(g[0]);
        }
      }
      pool = kept;
    } else if (item === 'far100') {
      // مجموعات متباعدة (≥100 بيب) بنفس الاتجاه: سلم الأولوية الزمني —
      // تُحفظ حتى سعة الصفقات المتزامنة التي حددها المستخدم (max_concurrent) ويُسقط البقية بالسلم
      const byDir: Record<string, Setup[]> = { buy: [], sell: [] };
      for (const s of pool) byDir[s.dir].push(s);
      const kept: Setup[] = [];
      for (const dir of ['buy', 'sell']) {
        if (byDir[dir].length <= 1) { kept.push(...byDir[dir]); continue; }
        byDir[dir].sort((a, b) =>
          a.strategyRank - b.strategyRank ||
          Number(b.fibConfirmed ?? false) - Number(a.fibConfirmed ?? false) ||
          a.createdAt - b.createdAt // الأقدم المتموضع يبقى — كان الأحدث يُبقى فتُقتل الأوامر المتموضعة
        );
        for (const s of byDir[dir].slice(perDirCap)) dropped.push({ setup: s, why: `تجاوز سعة الأوامر المعلقة (${perDirCap}) لهذا الاتجاه — حُفظ الأعلى أولوية في السلم الزمني` });
        kept.push(...byDir[dir].slice(0, perDirCap));
      }
      pool = kept;
    }
  }
  return { kept: pool, dropped };
}

// ---------- أسباب الحظر (شفافية كاملة) ----------
export const BLOCK_REASONS_AR: Record<string, string> = {
  session: 'خارج جلسات الاستراتيجية المفعلة',
  stacking: 'حظر الاستاكنج/الهيدج',
  hour23: 'حظر الساعة 23:00-00:00',
  openWeek: 'فلتر افتتاح الأسبوع',
  closeDay: 'فلتر إغلاق السوق',
  maxTrades: 'حد الصفقات اليومية',
  dayStop: 'إيقاف اليوم (ربح/خسارة)',
  news: 'حظر الأخبار',
  ema: 'فلتر EMA',
  regime: 'فلتر ريجيم التقلب المرتفع',
  chop: 'فلتر السوق الراكدة (نطاق 6 ساعات ضيق)',
  quality: 'بوابة جودة الإشارة (درجة أقل من العتبة)',
  conflict: 'حل التعارضات (سلم الأولويات/المتقاربة)',
  capacity: 'الصفقات المفتوحة بلغت الحد',
  E_open: 'حظر الافتتاح 02:00-04:00 بتوقيت سوريا (قيد القاعدة المجمّدة)',
  E_single: 'صفقة E نشطة موجودة — لا صفقة ثانية مع نشطة',
  E_numDay: 'سبق تداول هذا الرقم اليوم — صفقة واحدة لكل رقم في اليوم',
  E_SL15: 'مسافة الوقف تتجاوز 15$ — إلغاء الصفقة',
  invalid: 'أغلق السعر عبر مستوى الوقف قبل الدخول — إبطال الأمر',
};

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

export type { Trade };
